import { boardItems, type Rect } from "@/lib/boards/board-contents";
import {
  boardPages,
  isPageElement,
  nextPageBox,
  nextPageName,
  pageFrame,
  pageHolding,
  type BoardPage,
} from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// A page added to a board, with nothing laid out (tech-spec §V.2).
///
/// Every page on a board today arrives from a compose: agent 4 draws one under
/// the arrangement it decided, and `newPage` draws a second one beside it. That
/// leaves the two boards §V.2 is written for with no page at all —
///
/// - the board the director arranged by hand, which has never been composed and
///   which they do not want composed. Nothing on it can be named a page, so
///   nothing on it can be read a page at a time, scoped to a page, or attached to
///   a message as a page. Rebuilding it to get one is exactly the trade the page
///   entity exists to avoid;
/// - the board that wants an empty page to work on — somewhere to drag pictures
///   to — where a compose would insist on choosing what goes there.
///
/// So this is the deterministic half: a rectangle, a name and nothing else. No
/// model call, no slot, no picture chosen, and no picture moved.
///
/// The one thing it does beyond drawing the rectangle is adopt what it lands
/// over. A first page on a hand-made board is drawn *around* the elements already
/// there (§V.2), so those pictures are on it the moment it exists — geometry says
/// so, and every page read in this codebase agrees. Excalidraw's own drag reads
/// `frameId` rather than geometry, though, so a page that did not adopt them
/// would be a rectangle the director drags out from under their own board.
///
/// No canvas, no React, no DOM.

export type AddedPage = {
  elements: SceneElement[];
  page: BoardPage;
  /// What the page was drawn around and now owns. Zero for a page added beside a
  /// spread, which lands on empty canvas; the whole of a hand-made board for its
  /// first one.
  adopted: number;
};

/// Which elements a page arriving is drawn over, in the array's own order.
///
/// Only what is on no page already: a page cannot contain a page, and a picture
/// sitting on another page of the board is that page's whatever a new rectangle
/// overlaps. §V.2 never places a page over another one, so this is a guard rather
/// than a rule the director meets.
function drawnOver(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  box: Rect,
): SceneElement[] {
  return elements.filter((element) => {
    if (isPageElement(element)) return false;
    const own = boxOf(element);
    if (!own) return false;
    if (pageHolding(pages, own)) return false;
    return centreIn(box, own);
  });
}

/// The entity's membership rule (§V.3), asked about a rectangle that is not a
/// page yet: the centre of the box decides, never `frameId`, so what the page
/// adopts is exactly what a page read will describe as being on it.
function centreIn(box: Rect, item: Rect) {
  const x = item.x + item.width / 2;
  const y = item.y + item.height / 2;
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

export function addPage({
  elements,
  defaultSize,
  sourcePageId,
  name,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  /// The board's default page size — what §V.2 falls back to on a board holding
  /// no page, and what `Moodboard.widthPx`/`heightPx` mean now.
  defaultSize: { width: number; height: number };
  /// The page the new one takes its size and its top edge from. The board's last
  /// page when it is left out, which is what "another page" means on a spread.
  sourcePageId?: string | null;
  /// What the director called it. `Page N` when they did not, counted past the
  /// highest the board already carries so a discarded page cannot hand its name
  /// on.
  name?: string | null;
  makeId?: () => string;
}): AddedPage {
  const pages = boardPages(elements);
  const box = nextPageBox({
    pages,
    sourcePageId,
    defaultSize,
    around: boardItems(elements),
  });

  const frame = pageFrame(box, { name: name?.trim() || nextPageName(pages), makeId });
  const adopted = drawnOver(elements, pages, box);
  const owned = new Set(adopted.map((element) => element.id));

  /// The adopted elements move to the end of the array, immediately before their
  /// frame: excalidraw states the invariant that a frame's children come right
  /// before it. Their order among themselves is kept, so the stack the director
  /// built on their hand-made board survives being framed.
  return {
    elements: [
      ...elements.filter((element) => !owned.has(element.id)),
      ...adopted.map((element) => ({ ...element, frameId: frame.id })),
      frame,
    ],
    page: boardPages([frame])[0]!,
    adopted: adopted.length,
  };
}

function boxOf(element: SceneElement): Rect | null {
  const box = { x: element.x, y: element.y, width: element.width, height: element.height };
  const readable = Object.values(box).every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  return readable ? (box as Rect) : null;
}
