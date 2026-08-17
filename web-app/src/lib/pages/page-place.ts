import type { Rect } from "@/lib/boards/board-contents";
import { placeLinesOnBoard, type LineResult } from "@/lib/boards/board-line";
import { placeOnBoard, type PlaceResult } from "@/lib/boards/board-place";
import { elementBox, isPageElement, pageHolds, type BoardPage } from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The in-place edit, scoped to one page (tech-spec §V).
///
/// `placeOnBoard` and `placeLinesOnBoard` answer "put the sunset on that board
/// too" on a board the director arranged by hand: no compositor call, nothing
/// that was already there moved. They read the board as one flat canvas, which is
/// what a board was. It is pages now, and on a board with pages that reading is
/// wrong in three separate ways at once:
///
/// - a picture goes under *everything on the board*, so on a spread it lands
///   under the widest page rather than under the page the call was about — on no
///   page at all, which is the one place nothing can be read from or composed
///   again;
/// - a picture taken off is taken off every page it sits on, so "drop the sunset
///   from act two" takes the copy on page one with it;
/// - the room a line is set across is the whole spread's, so a headline for page
///   two is drawn across three pages.
///
/// So the scene is split on the page, the flat rules run on that page's elements
/// alone, and what they decide is put back into the board's own array. Membership
/// is the entity's rule — the centre of the box, never `frameId` (§V.3) — so the
/// elements this steps over are exactly the ones a page read described.
///
/// The two things this adds beyond scoping, both of them because a page is a
/// fixed rectangle where a board is not:
///
/// - what joins is kept *inside* the page. Under-what-is-there on a page that is
///   already full would put the picture past the bottom edge and onto no page;
/// - what joins is adopted by the page frame, immediately before it in the array,
///   which is where excalidraw wants a frame's children. So the picture moves
///   when the director drags the page, the way a composed one does.
///
/// No canvas, no React, no DOM.

/// A picture joining or leaving one page of a board, with everything on the
/// board's other pages — and everything loose on its canvas — left exactly as it
/// was, and never offered as already-on or taken off by mistake.
export function placeOnPage({
  elements,
  pages,
  page,
  add = [],
  remove = [],
  sizeOf,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  /// Every page of the board, because which page holds a box is decided topmost
  /// first across all of them — a page drawn over another does not silently take
  /// its pictures into the edit.
  pages: readonly BoardPage[];
  page: BoardPage;
  add?: readonly string[];
  remove?: readonly string[];
  sizeOf: (referenceId: string) => { width?: number | null; height?: number | null } | null | undefined;
  makeId?: () => string;
}): PlaceResult {
  const held = elementsOnPage(elements, pages, page);
  const edit = placeOnBoard({ elements: held, page, add, remove, sizeOf, makeId });
  return { ...edit, elements: intoBoard({ elements, page, held, edited: edit.elements }) };
}

/// A line joining or leaving one page. Set above what is on that page rather than
/// above the board, and shifted down onto the page when there is no room above it
/// — a headline drawn off the top of a page is a headline on no page.
export function placeLinesOnPage({
  elements,
  pages,
  page,
  add = [],
  remove = [],
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  pages: readonly BoardPage[];
  page: BoardPage;
  add?: readonly string[];
  remove?: readonly string[];
  makeId?: () => string;
}): LineResult {
  const held = elementsOnPage(elements, pages, page);
  const text = placeLinesOnBoard({ elements: held, page, add, remove, makeId });
  return { ...text, elements: intoBoard({ elements, page, held, edited: text.elements }) };
}

/// What sits on the page, in the array's own order — which is z-order, and which
/// the flat rules read to decide house size and what is already carried.
///
/// Page frames themselves are never part of it: a page cannot contain a page,
/// and a frame handed to `boardItems` is not an item either way.
export function elementsOnPage(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  page: BoardPage,
): SceneElement[] {
  return elements.filter((element) => {
    if (isPageElement(element)) return false;
    const box = elementBox(element);
    return !!box && pageHolds(pages, page, box);
  });
}

/// The board's array with the page's edit folded back into it: what the edit
/// dropped gone, everything else where it was, and what joined immediately before
/// the page's frame carrying its id.
///
/// Before the frame rather than after it because excalidraw states the ordering
/// invariant — a frame's children come right before the parent — and the picture
/// is a child now: it is inside the page rect, so it has to be owned by the page
/// or the director's next drag of that page leaves it behind.
function intoBoard({
  elements,
  page,
  held,
  edited,
}: {
  elements: readonly SceneElement[];
  page: BoardPage;
  held: readonly SceneElement[];
  edited: readonly SceneElement[];
}): SceneElement[] {
  const before = new Set(held.map((element) => element.id));
  const survives = new Set(edited.map((element) => element.id));

  const joining = keptInside(
    edited.filter((element) => !before.has(element.id)),
    page,
  ).map((element) => ({ ...element, frameId: page.id }));

  const out: SceneElement[] = [];
  let adopted = false;
  for (const element of elements) {
    if (before.has(element.id) && !survives.has(element.id)) continue;
    if (element.id === page.id) {
      out.push(...joining);
      adopted = true;
    }
    out.push(element);
  }
  /// Only reachable if the page was read off a different array than the one being
  /// written; the elements still go on the board rather than being dropped.
  if (!adopted) out.push(...joining);
  return out;
}

/// The joining elements moved as one so that they sit on the page.
///
/// As one, by a single shift, because they are a row: clamping each box on its
/// own would break the midline a portrait and a landscape were placed on. Over
/// the far edge is answered first and the near edge second, so a row bigger than
/// the page hangs off the bottom (or the right) from the page's own corner —
/// visibly a full page rather than a picture the board has lost.
function keptInside(joining: readonly SceneElement[], page: Rect): SceneElement[] {
  const boxes = joining.map(elementBox).filter((box): box is Rect => box !== null);
  if (!boxes.length) return [...joining];

  const bounds = {
    left: Math.min(...boxes.map((box) => box.x)),
    top: Math.min(...boxes.map((box) => box.y)),
    right: Math.max(...boxes.map((box) => box.x + box.width)),
    bottom: Math.max(...boxes.map((box) => box.y + box.height)),
  };
  const dx = shift(bounds.left, bounds.right, page.x, page.x + page.width);
  const dy = shift(bounds.top, bounds.bottom, page.y, page.y + page.height);
  if (!dx && !dy) return [...joining];

  return joining.map((element) => {
    const box = elementBox(element);
    return box ? { ...element, x: round(box.x + dx), y: round(box.y + dy) } : element;
  });
}

function shift(low: number, high: number, min: number, max: number) {
  const off = high > max ? max - high : 0;
  return low + off < min ? min - low : off;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
