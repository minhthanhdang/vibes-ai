import { normalizeHexColor } from "@/lib/analysis/analysis";
import type { Rect } from "@/lib/boards/board-contents";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// A page's ground, as an element on the scene (canvas.md §XI.4).
///
/// A frame carries `backgroundColor` on its row and neither renderer honours
/// it: excalidraw draws every frame in `FRAME_STYLE` whatever the row says, and
/// `rasterise.ts` matches that deliberately. Setting the field would give the
/// model a coloured page and the user a white one, which is the one bet
/// `compositor-v2.md` §III is built on never losing.
///
/// So a page's background is a real page-sized `rectangle` at the very back of
/// the page's child run, carrying `customData.pageBackground: true`. Everything
/// downstream is then free: excalidraw draws it in the editor, `moodboard-export`
/// exports it, `renderForModel` draws it, and autosave, undo, the revision guard
/// and `page-duplicate` all already know what a rectangle is.
///
/// What it costs is bookkeeping, and the bookkeeping is the build. The mark is
/// asked at every door that would otherwise treat the ground as a thing somebody
/// drew: the object read drops it, the three geometry doors refuse it by name,
/// `back` means "back, above the ground", tidy leaves it alone, and the page
/// reads count it as a colour the page is painted rather than as a block on it.
///
/// This module is deliberately a leaf — a rect, a colour and an array in, an
/// array out. `board-contents` asks `isPageBackground` and this asking
/// `board-pages` back would close a cycle over the whole page layer, so page
/// membership is the same geometric rule §V.3 states, written here in five
/// lines rather than imported.
///
/// No canvas, no React, no DOM.

/// The mark, on `customData` because that is the one bag excalidraw carries
/// through its own restore, its export and its undo without knowing what is in
/// it — the same reason a page frame is marked there rather than by name.
export type PageBackgroundMark = { pageBackground: true };

/// What `"none"` is said as at every door. A page painted no colour has its
/// rectangle dropped rather than made transparent: a transparent rectangle left
/// in the child run is a thing the next read has to wonder about, and the next
/// tidy has to be told to skip.
export const PAGE_BACKGROUND_NONE = "none";

export function isPageBackground(element: unknown): boolean {
  if (typeof element !== "object" || element === null) return false;
  const custom = (element as { customData?: unknown }).customData;
  if (typeof custom !== "object" || custom === null) return false;
  return (custom as { pageBackground?: unknown }).pageBackground === true;
}

/// A page as this module needs it: the rectangle and the frame's id. Any
/// `BoardPage` is one, so callers pass what they already hold.
export type BackedPage = Rect & { id: string };

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function centreInside(element: SceneElement, page: BackedPage): boolean {
  const x = finite(element.x);
  const y = finite(element.y);
  const width = finite(element.width);
  const height = finite(element.height);
  if (x === null || y === null || width === null || height === null) return false;
  const centreX = x + width / 2;
  const centreY = y + height / 2;
  return (
    centreX >= page.x &&
    centreX <= page.x + page.width &&
    centreY >= page.y &&
    centreY <= page.y + page.height
  );
}

/// The ground on one page, or null. Membership is §V.3's — geometric, never
/// `frameId` — so a ground carried onto a copied page by `duplicate_page`, which
/// works on the page's geometric members, is that page's ground the moment it
/// lands rather than once something re-hangs it.
export function pageBackgroundOf(
  elements: readonly SceneElement[],
  page: BackedPage,
): SceneElement | null {
  for (const element of elements) {
    if (element.isDeleted === true || !isPageBackground(element)) continue;
    if (centreInside(element, page)) return element;
  }
  return null;
}

/// The colour a page is painted, as a read says it: a hex, or null for a page
/// standing on nothing.
export function pageBackgroundColour(
  elements: readonly SceneElement[],
  page: BackedPage,
): string | null {
  const ground = pageBackgroundOf(elements, page);
  const colour = ground?.backgroundColor;
  return typeof colour === "string" && colour ? colour : null;
}

/// Where the ground goes in the array: the back of the page's child run, which
/// is immediately before the run's first member and, on a page holding nothing,
/// immediately before the frame itself.
///
/// The same index `reorder_on_canvas` computes for `back`, because it is the
/// same place — and the reason `back` had to learn to mean "above the ground".
function groundIndex(elements: readonly SceneElement[], page: BackedPage): number {
  let frameAt = elements.length;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.id === page.id) {
      frameAt = index;
      continue;
    }
    if (element.frameId === page.id && element.type !== "frame" && element.type !== "magicframe") {
      return Math.min(index, frameAt);
    }
  }
  return frameAt;
}

/// The ground rectangle itself. Flat and unstroked, on the palette swatch's own
/// reasoning: roughness would put a sketched edge and an uneven fill on the one
/// element whose whole job is to be exactly one colour, and a stroke would draw
/// a hairline around every page.
///
/// Locked, which is the one thing §XI.4 does not say and the editor makes
/// obvious the moment a page has one: a filled page-sized rectangle at the back
/// of every page is what every click on empty page lands on, so unlocked it
/// would be the first thing the user selects and the last thing they meant to.
/// The inspector control is how it is changed, which is exactly what locked
/// means everywhere else on this canvas.
function groundElement(page: BackedPage, colour: string, id: string): SceneElement {
  return {
    id,
    type: "rectangle",
    x: page.x,
    y: page.y,
    width: page.width,
    height: page.height,
    backgroundColor: colour,
    strokeColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    roundness: null,
    opacity: 100,
    angle: 0,
    locked: true,
    frameId: page.id,
    customData: { pageBackground: true } satisfies PageBackgroundMark,
  } as SceneElement;
}

export type PageBackgroundEdit = {
  /// The scene afterwards, or null when the colour asked for is the colour the
  /// page is already painted — the caller's cue to skip the write rather than
  /// spend a revision on a repaint that moved no pixel.
  elements: SceneElement[] | null;
  /// The colour the page now stands on, null for a page painted nothing.
  colour: string | null;
  was: string | null;
};

/// Paint one page, or clear it. `colour` is a hex or `"none"`; anything else is
/// null, and the caller refuses it in its own answer.
///
/// One per page, always: a second call recolours the rectangle in place rather
/// than stacking another behind it, which keeps the element's id — so the
/// editor's undo, the render's diff and any selection the user is holding all
/// survive a change of colour.
export function setPageBackground({
  elements,
  page,
  colour,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  page: BackedPage;
  colour: unknown;
  makeId?: () => string;
}): PageBackgroundEdit | null {
  const asked = typeof colour === "string" ? colour.trim() : "";
  const clearing = asked.toLowerCase() === PAGE_BACKGROUND_NONE;
  const hex = clearing ? null : normalizeHexColor(asked);
  if (!clearing && !hex) return null;

  const standing = pageBackgroundOf(elements, page);
  const was = pageBackgroundColour(elements, page);

  if (clearing) {
    if (!standing) return { elements: null, colour: null, was: null };
    return {
      elements: elements.filter((element) => element.id !== standing.id),
      colour: null,
      was,
    };
  }

  if (standing) {
    if (was && was.toLowerCase() === hex!.toLowerCase())
      return { elements: null, colour: was, was };
    return {
      elements: elements.map((element) =>
        element.id === standing.id ? { ...element, backgroundColor: hex! } : element,
      ),
      colour: hex!,
      was,
    };
  }

  const ground = groundElement(page, hex!, makeId());
  const at = groundIndex(elements, page);
  return {
    elements: [...elements.slice(0, at), ground, ...elements.slice(at)],
    colour: hex!,
    was: null,
  };
}

/// The ground follows its page's rectangle. `resize_page` writes one frame's
/// width and height and lays nothing else out again — but the ground is not a
/// thing on the page, it *is* the page, so a page made portrait with its ground
/// left landscape is a page half painted.
/// Looked up against the rectangle the page *was*, applied at the one it is
/// now: a page shrunk to a fifth leaves the old ground's centre outside the new
/// rect, so a lookup taken after the resize would find nothing and leave the
/// page painted at its old shape.
export function resizedPageBackground(
  elements: readonly SceneElement[],
  was: BackedPage,
  now: BackedPage,
): SceneElement[] {
  const ground = pageBackgroundOf(elements, was);
  if (!ground) return [...elements];
  return elements.map((element) =>
    element.id === ground.id
      ? { ...element, x: now.x, y: now.y, width: now.width, height: now.height }
      : element,
  );
}
