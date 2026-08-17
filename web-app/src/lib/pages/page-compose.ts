import type { BoardItem, Rect } from "@/lib/boards/board-contents";
import { isPageElement, pageHolding, pageItems, type BoardPage } from "@/lib/pages/board-pages";
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
