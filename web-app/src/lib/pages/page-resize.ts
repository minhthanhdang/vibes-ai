import type { Rect } from "@/lib/boards/board-contents";
import {
  boardPages,
  elementBox,
  isPageElement,
  pageById,
  pageChildOrder,
  pageElements,
  pageReadingOrder,
  type BoardPage,
  type PageSizeLabel,
} from "@/lib/pages/board-pages";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

/// A page's rectangle changed, and nothing else laid out again (tech-spec §V.1).
///
/// "Resizing a page is allowed and changes nothing else" is the entity's own
/// sentence, and until now it was true of the director alone: they drag a frame
/// handle, the label goes to `Custom`, every read follows the rectangle. The model
/// had no way to say it. What it had instead was `compose_moodboard` naming a
/// template of another shape — which does resize the page, and lays it out again
/// on the way past, so "make that one portrait" came back as a page rearranged by
/// agent 4. The two requests are not the same request, and one of them was
/// answered with the other.
///
/// So this is the whole of the act: one frame's `width`/`height`. The pictures on
/// the page keep the places the director or the compositor put them in, which is
/// what makes it the cheap answer to "turn it on its side" — and what makes it a
/// change with consequences worth reporting, because a page is the only rectangle
/// in this app that decides what is on it:
///
/// - a page made smaller leaves pictures beside it. Nothing is deleted and
///   nothing moves: they are still on the board, at the same coordinates, and they
///   are no longer that page's, so no page read, no page render and no
///   page-scoped compose describes them any more;
/// - a page made larger takes in whatever it now covers, the same way a page
///   drawn around a hand-made board does (§V.2's adoption) — and it may reach
///   over the page beside it, where §V.3's topmost rule then decides which of the
///   two holds a photograph.
///
/// Both of those are said in the answer rather than left for the director to find.
///
/// The anchor is the page's top-left corner, which is the handle excalidraw's own
/// resize keeps and §V.2's top-alignment of a spread: a page growing from its
/// centre would reach backwards over the page before it, and a spread whose second
/// page is a different height would stop reading as a row.
///
/// The marker is left exactly as it is. `customData.page.preset` is "the size it
/// was created at" and stays the honest answer to that after a drag or after this;
/// the size label the model and the director are shown is derived from the
/// rectangle every time it is read, so a resize to a preset shape is what turns a
/// `Custom` page back into a `LANDSCAPE_HD` one with nothing stored about it.
///
/// No canvas, no React, no DOM.

/// What was on the page, or is now, said as the model names it: pictures by id,
/// lines by their words. Both in the reading order of the rectangle they are being
/// reported against, so "the first one" means the same thing here as in a page read.
export type PageResizeContents = {
  pictures: string[];
  lines: string[];
};

export type PageResize = {
  /// The board's scene afterwards, in the array's own order but for the children a
  /// change of hands gathered.
  elements: SceneElement[];
  /// The page as it now stands, with the derived label its new rectangle earns.
  page: BoardPage;
  was: { width: number; height: number; preset: PageSizeLabel };
  /// On the page before and not on it now. Still on the board and still where they
  /// were — a resize moves nothing — so this is what the page stopped describing
  /// rather than what the director lost.
  fellOff: PageResizeContents;
  /// On the page now and not before: what a page made larger reached over.
  joined: PageResizeContents;
  /// Pictures on the page now that cross its edge, so the render draws them cut
  /// off there. The commonest outcome of a shrink, and the one the model has to
  /// read as an overflow rather than as a crop.
  clipped: string[];
  /// Other pages of the board this rectangle now overlaps. §V.3 hands a
  /// photograph in the overlap to the topmost of them, so a spread whose pages
  /// have run into each other is a board where a page is a query rather than a
  /// unit — reported, because it is invisible in every page read taken on its own.
  overlaps: BoardPage[];
  /// Which elements changed hands, for a caller that has to hand excalidraw the
  /// elements it is already holding rather than write an array.
  adoptedIds: string[];
  releasedIds: string[];
};

type Boxed = Rect & { element: SceneElement };

function boxed(elements: readonly SceneElement[]): Boxed[] {
  const placed: Boxed[] = [];
  for (const element of elements) {
    const box = elementBox(element);
    if (box) placed.push({ ...box, element });
  }
  return placed;
}

/// The pictures and lines of a set of elements, in the reading order of one
/// rectangle. A reference standing on the page twice is named once: the model acts
/// on it by id, and an id said twice reads as two photographs.
function contentsSaid(elements: readonly SceneElement[], rect: Rect): PageResizeContents {
  const pictures: string[] = [];
  const lines: string[] = [];

  for (const { element } of pageReadingOrder(boxed(elements), rect)) {
    if (element.type === "image") {
      const referenceId = referenceIdFromFileId(element.fileId);
      if (referenceId && !pictures.includes(referenceId)) pictures.push(referenceId);
      continue;
    }
    if (element.type !== "text") continue;
    const text = typeof element.text === "string" ? element.text.trim() : "";
    if (text) lines.push(text);
  }

  return { pictures, lines };
}

function crossesEdge(box: Rect, page: Rect) {
  return (
    box.x < page.x ||
    box.y < page.y ||
    box.x + box.width > page.x + page.width ||
    box.y + box.height > page.y + page.height
  );
}

function intersects(one: Rect, other: Rect) {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  );
}

/// The page at its new size. `null` for an id the board does not carry — the
/// caller refuses it in its own answer, which is a round cheaper than a throw.
export function resizePage({
  elements,
  pageId,
  size,
}: {
  elements: readonly SceneElement[];
  pageId: unknown;
  size: { width: number; height: number };
}): PageResize | null {
  const pages = boardPages(elements);
  const page = pageById(pages, pageId);
  if (!page || !(size.width > 0) || !(size.height > 0)) return null;

  const wider = elements.map((element) =>
    element.id === page.id && isPageElement(element)
      ? { ...element, width: size.width, height: size.height }
      : element,
  );

  const after = boardPages(wider);
  const now = pageById(after, page.id)!;

  /// The page's own elements before and after, by §V.3 and by the same function
  /// every other act on a page asks — so what this reports as having left the page
  /// is exactly what a page read taken afterwards will leave out, and a section the
  /// page was drawn over is neither taken nor given up.
  const before = pageElements(elements, pages, page);
  const kept = pageElements(wider, after, now);
  const keptIds = new Set(kept.map((element) => element.id));
  const beforeIds = new Set(before.map((element) => element.id));

  /// Ownership follows the rectangle, in the same edit. Excalidraw's drag reads
  /// `frameId` where every read here reads geometry, and the two disagreeing is
  /// worse after a resize than anywhere else: a child left naming a page that no
  /// longer covers it is drawn clipped to a rectangle it is outside of, which is
  /// not drawn at all.
  const adoptedIds: string[] = [];
  const releasedIds: string[] = [];
  const rehung = wider.map((element) => {
    if (keptIds.has(element.id) && element.frameId !== page.id) {
      adoptedIds.push(element.id);
      return { ...element, frameId: page.id };
    }
    if (!keptIds.has(element.id) && element.frameId === page.id) {
      releasedIds.push(element.id);
      return { ...element, frameId: null };
    }
    return element;
  });

  return {
    /// Gathered only when something changed hands, on `tidyBoard`'s own rule: the
    /// reorder is a z-order change, and a resize that took nothing in has no
    /// business restacking a spread the director built.
    elements: adoptedIds.length ? pageChildOrder(rehung) : rehung,
    page: now,
    was: { width: page.width, height: page.height, preset: page.preset },
    fellOff: contentsSaid(
      before.filter((element) => !keptIds.has(element.id)),
      page,
    ),
    joined: contentsSaid(
      kept.filter((element) => !beforeIds.has(element.id)),
      now,
    ),
    clipped: contentsSaid(
      kept.filter((element) => {
        const box = elementBox(element);
        return box ? crossesEdge(box, now) : false;
      }),
      now,
    ).pictures,
    overlaps: after.filter((other) => other.id !== now.id && intersects(now, other)),
    adoptedIds,
    releasedIds,
  };
}
