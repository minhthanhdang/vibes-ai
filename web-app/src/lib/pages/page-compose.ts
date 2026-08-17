import type { BoardItem, Rect } from "@/lib/boards/board-contents";
import { PAGE_GAP } from "@/lib/layout/moodboard-layouts";
import {
  isPageElement,
  pageById,
  pageHolding,
  pageItems,
  type BoardPage,
} from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// A compose scoped to one page of a board (tech-spec §V, and §III.4's `Page`
/// column).
///
/// Agent 4 used to compose a *board*: the scene it wrote was the whole of the
/// row, so a rebuild replaced everything the board held. A board is pages now and
/// the arrangement a compose decides is one page's — the page the director is
/// talking about — which leaves two facts that neither the layout constants nor
/// the page entity can answer on their own:
///
/// - a template's slots are cut against the origin, so a page anywhere else on the
///   board has to be read with its own corner as (0,0) before a picture can be
///   recognised as still sitting in a slot. Read in board coordinates, page 2
///   never stands as its template composed it, and a call naming one photograph
///   reshuffles every picture on it;
/// - what is not on the page is not the compose's to rewrite. Page 3 keeps its
///   pictures while page 2 is laid out again, and a picture the director dragged
///   off onto the canvas beside a page stays where they put it rather than being
///   deleted by a call about the page.
///
/// Membership is the entity's own rule — the centre of the box, never `frameId` —
/// so an element the compose steps over is exactly the element a page read
/// described.
///
/// No canvas, no React, no DOM.

/// What is on a page, in the page's own coordinates: the boxes a template's slot
/// geometry can be matched against.
///
/// `clipped` is dropped rather than carried. It says an element runs over the
/// page edge, which is a thing to *tell a reader*; a picture hanging over the
/// edge is not sitting in a slot either way, so the seating rules would only
/// re-derive it.
export function pageLocalItems(items: readonly BoardItem[], page: Rect): BoardItem[] {
  return pageItems(items, page).map((item) => ({
    kind: item.kind,
    referenceId: item.referenceId,
    text: item.text,
    x: item.x - page.x,
    y: item.y - page.y,
    width: item.width,
    height: item.height,
    ...(item.angle ? { angle: item.angle } : {}),
  }));
}

/// Where a page a compose is about to *draw on* goes (§V.2's rule, for new work
/// rather than for a frame around old).
///
/// `nextPageBox` is the other half of §V.2 and cannot serve here: on a board with
/// no page it lands the first one *around* the elements already there, which is
/// right for a hand-made board being given a page and wrong for a compose, which
/// would then draw its arrangement on top of the arrangement the director made.
/// This one always lands clear.
///
/// Clear of *everything* rather than of the pages alone: a picture dragged out to
/// the right of the last page is on the board, and a new page drawn over it would
/// adopt it on the director's next drag. So the right edge is the rightmost of the
/// pages and the loose elements both — which on the ordinary board, where nothing
/// sits outside a page, is the rightmost page and §V.2 exactly.
///
/// The size is the template's, not the source page's: a compose decides the page
/// it draws, the same way a rebuild takes its page size from the template it was
/// laid out at. What the source page gives is the top edge, so a spread stays a
/// row.
export function newPageBox({
  pages = [],
  sourcePageId,
  size,
  occupied = [],
}: {
  pages?: readonly BoardPage[];
  /// The page the compose named, if it named one — "another page like that one".
  sourcePageId?: string | null;
  /// The page size the template being composed is cut to.
  size: { width: number; height: number };
  /// What is already on the board, pages aside.
  occupied?: readonly Rect[];
}): Rect {
  const boxes: Rect[] = [...pages, ...occupied];
  if (boxes.length === 0) return { x: 0, y: 0, ...size };

  const source = pageById(pages, sourcePageId) ?? pages[pages.length - 1] ?? null;
  const right = Math.max(...boxes.map((box) => box.x + box.width));

  return {
    x: right + PAGE_GAP,
    y: source ? source.y : Math.min(...boxes.map((box) => box.y)),
    ...size,
  };
}

/// The board's scene with one page lifted out of it: the page frame and
/// everything sitting on it gone, everything else in the order it was in.
///
/// This is what a page-scoped compose writes its new elements after. Order is
/// kept because it is z-order, and because excalidraw wants a frame's children
/// immediately before it — untouched pages keep both by never being moved, and
/// the composed page arrives whole at the end.
///
/// The other pages' frames are kept whatever they overlap: a frame that is a page
/// is a page, and one drawn across another is a board the director can still see
/// two of.
export function sceneOffPage(
  elements: readonly SceneElement[],
  page: BoardPage,
  pages: readonly BoardPage[],
): SceneElement[] {
  return elements.filter((element) => {
    if (element.id === page.id) return false;
    if (isPageElement(element)) return true;
    const box = boxOf(element);
    return !box || pageHolding(pages, box)?.id !== page.id;
  });
}

function boxOf(element: SceneElement): Rect | null {
  const box = { x: element.x, y: element.y, width: element.width, height: element.height };
  const readable = Object.values(box).every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  return readable ? (box as Rect) : null;
}
