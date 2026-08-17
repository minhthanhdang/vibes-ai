import { boardItems, type Rect } from "@/lib/boards/board-contents";
import {
  boardPages,
  boardSections,
  elementBox,
  isFrameElement,
  nextPageBox,
  nextPageName,
  pageFrame,
  pageHolding,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { frameOf, type FrameBox } from "@/lib/canvas/moodboard-frames";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// A page added to a board, with nothing laid out (tech-spec §V.2).
///
/// Every page on a board today arrives from a compose: agent 4 draws one under
/// the arrangement it decided, and `newPage` draws a second one beside it. That
/// leaves the two boards §V.2 is written for with no page at all —
///
/// - the board the user arranged by hand, which has never been composed and
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
/// would be a rectangle the user drags out from under their own board.
///
/// No canvas, no React, no DOM.

export type AddedPage = {
  elements: SceneElement[];
  page: BoardPage;
  /// What the page was drawn around and now owns. Zero for a page added beside a
  /// spread, which lands on empty canvas; the whole of a hand-made board for its
  /// first one.
  adopted: number;
  /// Which ones those are. The server writes the array above as it stands; a
  /// canvas has to hand excalidraw the elements it is already holding, and this
  /// is what says which of them changed hands.
  adoptedIds: string[];
  /// How many sections the page landed over and did not take (§V.1). Zero on
  /// every board composed by agent 4 — a section is a rectangle the user drew
  /// themselves — and the reason a hand-made board's first page can be drawn
  /// around everything and still own less than everything.
  sections: number;
};

/// Which elements a page arriving is drawn over, in the array's own order.
///
/// Only what is on no page already: a page cannot contain a page, and a picture
/// sitting on another page of the board is that page's whatever a new rectangle
/// overlaps. §V.2 never places a page over another one, so this is a guard rather
/// than a rule the user meets.
///
/// And only what no *section* owns. A hand-made board is exactly the board that
/// may be organized in sections already, and its first page is drawn around the
/// whole of it — so this is the one place a page and a section meet. Neither the
/// section frame nor a photo inside it is taken: §V.1 says a board uses one or
/// the other because excalidraw does not nest frames, and taking a section's
/// photos would empty the user's own grouping — the section would drag as a
/// bare rectangle and its photos would stay behind. They are still *on* the page
/// by geometry, which is what every page read and the render both say; what they
/// are not is the page's to move.
function drawnOver(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  sections: readonly FrameBox[],
  box: Rect,
): SceneElement[] {
  return elements.filter((element) => {
    /// A tombstone excalidraw keeps for undo is not on the board. The editor
    /// hands its whole array over, deleted ones included, and a page that
    /// adopted them would file what the user erased under itself.
    if (element.isDeleted === true) return false;
    if (isFrameElement(element)) return false;
    if (frameOf(sections, element.frameId)) return false;
    const own = elementBox(element);
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
  box,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  /// The board's default page size — what §V.2 falls back to on a board holding
  /// no page, and what `Moodboard.widthPx`/`heightPx` mean now.
  defaultSize: { width: number; height: number };
  /// The page the new one takes its size and its top edge from. The board's last
  /// page when it is left out, which is what "another page" means on a spread.
  sourcePageId?: string | null;
  /// What the user called it. `Page N` when they did not, counted past the
  /// highest the board already carries so a discarded page cannot hand its name
  /// on.
  name?: string | null;
  /// An explicit rectangle for the page — `put_on_canvas`'s box, in scene
  /// pixels. The page is still drawn *around* what it lands over and adopts
  /// it, exactly as a computed one would.
  box?: Rect;
  makeId?: () => string;
}): AddedPage {
  const pages = boardPages(elements);
  const at =
    box ??
    nextPageBox({
      pages,
      sourcePageId,
      defaultSize,
      around: boardItems(elements),
    });

  const frame = pageFrame(at, { name: name?.trim() || nextPageName(pages), makeId });
  const sections = boardSections(elements, pages);
  const adopted = drawnOver(elements, pages, sections, at);
  const owned = new Set(adopted.map((element) => element.id));

  /// The adopted elements move to the end of the array, immediately before their
  /// frame: excalidraw states the invariant that a frame's children come right
  /// before it. Their order among themselves is kept, so the stack the user
  /// built on their hand-made board survives being framed.
  return {
    elements: [
      ...elements.filter((element) => !owned.has(element.id)),
      ...adopted.map((element) => ({ ...element, frameId: frame.id })),
      frame,
    ],
    page: boardPages([frame])[0]!,
    adopted: adopted.length,
    adoptedIds: adopted.map((element) => element.id),
    sections: sections.filter((section) => centreIn(at, section)).length,
  };
}
