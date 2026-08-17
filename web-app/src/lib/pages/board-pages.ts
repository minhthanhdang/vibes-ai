import { PAGE_GAP, PAGE_PRESETS, type PagePresetId } from "@/lib/layout/moodboard-layouts";
import { readingOrder, type BoardItem, type Rect } from "@/lib/boards/board-contents";
import { FRAME_TYPES } from "@/lib/canvas/moodboard-frames";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The page, as the scene holds it (tech-spec §V.1–3).
///
/// A board is an unbounded excalidraw scene and a page is a fixed-size rectangle
/// on it. That rectangle is a **frame** carrying `customData.page` — not a new
/// element type and not a Prisma row:
///
/// - a frame already is a named rectangle that owns what it contains, and every
///   host-side edit is already frame-aware, so a page inherits tidy, drop-joins
///   and export-the-section for the price of a marker;
/// - geometry stays in the scene. A `Page` table with x/y/width/height would be
///   a second copy of numbers the director changes by dragging, and the copy is
///   the one that goes stale.
///
/// So there is exactly one authoritative fact stored here — that this frame is a
/// page — and everything else is read off the rectangle: its size, its name, its
/// position, and which pictures are on it.
///
/// No canvas, no React, no DOM: what goes in is elements, what comes out is
/// boxes, ids and one frame skeleton.

/// What the size label says when the frame no longer matches any preset. A
/// derived label cannot disagree with the rectangle on screen; a stored one can,
/// which is why resizing a page is allowed and changes nothing else.
export const CUSTOM_PAGE_PRESET = "Custom";

export type PageSizeLabel = PagePresetId | typeof CUSTOM_PAGE_PRESET;

/// A page dragged to a new size lands on fractional pixels, and a preset matched
/// only on exact equality would read "Custom" for a rectangle nobody touched.
const PRESET_TOLERANCE = 1;

export type BoardPage = {
  /// The frame element's own id. This is what a tool names a page by.
  id: string;
  name: string;
  x: number;
  y: number;
  /// Authoritative — the rectangle, not the preset it was created at.
  width: number;
  height: number;
  /// Derived from the size above every time it is read.
  preset: PageSizeLabel;
  /// The size it was created at, off the marker. Kept because "it was a
  /// LANDSCAPE_HD before I dragged it" is the only thing a stored preset can
  /// still honestly say, and null on a frame promoted to a page in place.
  createdAs: PagePresetId | null;
};

export type PageItem = BoardItem & {
  /// The element crosses the page's edge. Excalidraw draws a child clipped at
  /// its frame's border, so the render shows a cut-off picture and a reader has
  /// to be told that is an overflow rather than a crop.
  clipped: boolean;
  /// Where it sits in the stack among the page's own elements, 0 at the back —
  /// the scene array's order, which is excalidraw's z-order. Carried because the
  /// list below is in *reading* order, and a collage's overlap is the one thing
  /// only the array order says.
  z: number;
};

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/// The size label for a rectangle, matched back to the presets. `Custom` for
/// anything else, including a page whose preset the director has dragged it off.
export function pageSizeLabel(width: number, height: number): PageSizeLabel {
  for (const id of Object.keys(PAGE_PRESETS) as PagePresetId[]) {
    const preset = PAGE_PRESETS[id];
    if (
      Math.abs(preset.width - width) <= PRESET_TOLERANCE &&
      Math.abs(preset.height - height) <= PRESET_TOLERANCE
    ) {
      return id;
    }
  }
  return CUSTOM_PAGE_PRESET;
}

export function pagePresetSize(preset: unknown): { width: number; height: number } | null {
  if (typeof preset !== "string") return null;
  return PAGE_PRESETS[preset as PagePresetId] ?? null;
}

/// The marker, or null for a frame that is only a section — which is all frames
/// have meant until now, and still what an unmarked one means.
///
/// `true` is read as a marker as well as an object: the marker's job is to say
/// *that* this frame is a page, and a scene round-tripped through something that
/// flattened the payload should not quietly stop being one.
function pageMarker(element: Record<string, unknown>): { preset: PagePresetId | null } | null {
  const custom = plainObject(element.customData);
  if (!custom) return null;

  const marker = custom.page;
  if (marker === true) return { preset: null };

  const payload = plainObject(marker);
  if (!payload) return null;

  const preset = typeof payload.preset === "string" ? payload.preset : null;
  return { preset: preset && preset in PAGE_PRESETS ? (preset as PagePresetId) : null };
}

/// What promotes a frame to a page. Written on the frame this module creates and
/// on one the director asks to have marked — a board that already exists is not
/// stranded by pages arriving, it gets one in place.
export function pageCustomData(width: number, height: number) {
  const preset = pageSizeLabel(width, height);
  return { page: preset === CUSTOM_PAGE_PRESET ? {} : { preset } };
}

export function isPageElement(element: unknown): boolean {
  const plain = plainObject(element);
  if (!plain || plain.isDeleted === true || plain.type !== "frame") return false;
  return pageMarker(plain) !== null;
}

/// Any frame at all — a page, a section the director drew, or excalidraw's own
/// AI frame from a pasted scene.
///
/// The one thing a page may never own (§V.1): "excalidraw does not nest frames,
/// so a page cannot contain a section — a board uses one or the other". A page
/// arriving over a section is a rectangle the director drew inside a rectangle
/// the model drew, which is allowed to *look* like that and is not allowed to
/// become it — a `frameId` naming a frame is a scene excalidraw does not have a
/// rendering for. Exported because both places that hand a page ownership of
/// what geometry puts on it — the adoption when a page is added and the copy the
/// exporter draws — have to step over the same set.
export function isFrameElement(element: unknown): boolean {
  const plain = plainObject(element);
  if (!plain || plain.isDeleted === true) return false;
  return typeof plain.type === "string" && (FRAME_TYPES as readonly string[]).includes(plain.type);
}

/// The pages a scene holds, in the array's own order — which is z-order, and not
/// the order they are read in (see `pagesInReadingOrder`).
///
/// Only `frame`, deliberately not `magicframe`: a page is a rectangle this app
/// creates or the director marks, and the AI frame from excalidraw's own product
/// arriving in a pasted scene is not one of ours.
export function boardPages(elements: unknown): BoardPage[] {
  if (!Array.isArray(elements)) return [];

  const pages: BoardPage[] = [];
  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element || !isPageElement(element)) continue;

    const id = element.id;
    const x = finite(element.x);
    const y = finite(element.y);
    const width = finite(element.width);
    const height = finite(element.height);
    if (typeof id !== "string" || !id || x === null || y === null) continue;
    if (width === null || height === null || width <= 0 || height <= 0) continue;

    pages.push({
      id,
      name: typeof element.name === "string" && element.name.trim() ? element.name.trim() : "",
      x,
      y,
      width,
      height,
      preset: pageSizeLabel(width, height),
      createdAs: pageMarker(element)?.preset ?? null,
    });
  }

  return pages;
}

/// The order a director reads the board's pages in, which is the order they
/// number them in: "the second page" is about this list. Rows first, then left
/// to right — the same rule the pictures on a board are counted by, so a spread
/// laid out rightwards reads 1, 2, 3 whatever order the frames were drawn in.
export function pagesInReadingOrder(pages: readonly BoardPage[]): BoardPage[] {
  return readingOrder(pages);
}

export function pageById(pages: readonly BoardPage[], id: unknown): BoardPage | null {
  if (typeof id !== "string" || !id) return null;
  return pages.find((page) => page.id === id) ?? null;
}

/// What to call the next page.
///
/// N is one past the highest `Page N` the board already carries rather than the
/// page count: counting pages would hand a second page the name of one that was
/// discarded, and two pages called "Page 2" is a board the director cannot name
/// a page on. Dragging pages around never renames anything either way — the name
/// is a string on the element, and reading order is derived separately.
/// Takes the names rather than the pages: promoting two frames at once has to
/// number the second past the first, and the first is not a page on the board
/// yet — it is a rectangle about to become one.
export function nextPageName(pages: readonly { name: string }[]): string {
  let highest = pages.length;
  for (const page of pages) {
    const match = /^page\s+(\d+)$/i.exec(page.name);
    const numbered = match ? Number(match[1]) : 0;
    if (numbered > highest) highest = numbered;
  }
  return `Page ${highest + 1}`;
}

/// The rectangle a first page is drawn at on a board that has none.
///
/// Around the elements already there if any are, so a board the director made by
/// hand gets a page by asking for one rather than by being rebuilt. Centred on
/// what is there rather than fitted to it: the page is a fixed size, and a
/// hand-made board wider than the page keeps its arrangement with the page
/// around the middle of it.
function firstPageOrigin(items: readonly Rect[], size: { width: number; height: number }) {
  if (items.length === 0) return { x: 0, y: 0 };

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const item of items) {
    left = Math.min(left, item.x);
    top = Math.min(top, item.y);
    right = Math.max(right, item.x + item.width);
    bottom = Math.max(bottom, item.y + item.height);
  }

  return {
    x: Math.round((left + right) / 2 - size.width / 2),
    y: Math.round((top + bottom) / 2 - size.height / 2),
  };
}

/// Where another page goes (§V.2). Deterministic, no model call.
///
/// The size comes from the source page — the selected one, else the last created
/// — because a spread is pages of one size, and the board's default is only what
/// a board holding no pages falls back to. The position is to the right of the
/// *rightmost* page rather than of the source: pages are added to the end of a
/// spread, and a new page landing on top of one further right would be a page
/// the director cannot see.
export function nextPageBox({
  pages = [],
  sourcePageId,
  defaultSize,
  around = [],
}: {
  pages?: readonly BoardPage[];
  /// The page the director had selected, if any.
  sourcePageId?: string | null;
  /// The board's default page size — `Moodboard.widthPx`/`heightPx`, which stop
  /// being the board's page and become what its first one is drawn at.
  defaultSize: { width: number; height: number };
  /// What is already on the board, for the first page only.
  around?: readonly Rect[];
}): Rect {
  if (pages.length === 0) {
    const size = { width: defaultSize.width, height: defaultSize.height };
    return { ...firstPageOrigin(around, size), ...size };
  }

  const source = pageById(pages, sourcePageId) ?? pages[pages.length - 1]!;
  const rightmost = Math.max(...pages.map((page) => page.x + page.width));

  return {
    x: rightmost + PAGE_GAP,
    y: source.y,
    width: source.width,
    height: source.height,
  };
}

/// The frame element that *is* a page. Emitted the way `composedScene` emits its
/// elements: the fields that decide where it sits and what it holds, and nothing
/// invented — excalidraw's own `restore` fills seeds, versions and fractional
/// indices when the scene is opened.
export function pageFrame(
  box: Rect,
  { name, makeId = () => crypto.randomUUID() }: { name: string; makeId?: () => string },
): SceneElement {
  const id = makeId();
  return {
    id: typeof id === "string" && id ? id : crypto.randomUUID(),
    type: "frame",
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    name,
    customData: pageCustomData(box.width, box.height),
  };
}

/// A page renamed in place — the frame's `name`, and nothing else in the scene.
///
/// The name is the one thing about a page the director and the model both say out
/// loud: "put that on Act two" is addressed to a string on a frame, and where a
/// board's name is a column, a page's is part of the document a tab has open. So
/// renaming one is a scene write and the caller has to guard it on the revision,
/// where renaming a board is a column write that guards nothing.
///
/// Null when the id names no page on this board rather than a scene written back
/// unchanged: a section is a frame too, and renaming one of those would put a
/// name the director gave a page on a rectangle no page read describes.
export function renamePage(
  elements: readonly SceneElement[],
  pageId: string,
  name: string,
): SceneElement[] | null {
  let found = false;
  const renamed = elements.map((element) => {
    if (element.id !== pageId || !isPageElement(element)) return element;
    found = true;
    return { ...element, name: name.trim() };
  });
  return found ? renamed : null;
}

/// A frame the director already drew, promoted to a page in place. Its size is
/// whatever they drew it at, so a section that was never a preset becomes a
/// `Custom` page rather than being resized under them.
export function markElementAsPage(element: SceneElement): SceneElement {
  const width = finite(element.width) ?? 0;
  const height = finite(element.height) ?? 0;
  const custom = plainObject(element.customData) ?? {};
  return { ...element, customData: { ...custom, ...pageCustomData(width, height) } };
}

function centreOf(item: Rect) {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 };
}

function within(page: Rect, point: { x: number; y: number }) {
  return (
    point.x >= page.x &&
    point.x <= page.x + page.width &&
    point.y >= page.y &&
    point.y <= page.y + page.height
  );
}

/// The membership rule itself (§V.3), for a caller that already knows which page
/// it means: is the centre of this box on that page.
///
/// Exported because the rule is asked in two shapes — "which page holds this"
/// (`pageHolding`) and "is this on the page I named" — and the second one is
/// what every page-scoped *edit* asks. Written once here so a swap, a reword and
/// a read can never disagree about what is on a page.
export function boxOnPage(page: Rect, box: Rect): boolean {
  return within(page, centreOf(box));
}

/// The box a scene element occupies, or null for one that has none.
///
/// Every page-scoped read starts here, because §V.3's membership is geometric:
/// an element the scene carries without a readable rectangle — a binding, a
/// half-written entry — is on no page rather than on the first one, and a
/// caller that read `x` as 0 would file it at the origin. Exported for the same
/// reason `boxOnPage` is: four modules had their own copy of this, and a page
/// read that disagrees with a page edit about what a box is disagrees about
/// what is on the page.
export function elementBox(element: SceneElement): Rect | null {
  const box = { x: element.x, y: element.y, width: element.width, height: element.height };
  const readable = Object.values(box).every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  return readable ? (box as Rect) : null;
}

/// Which page a box sits on, topmost first, or null for one loose on the canvas.
///
/// By the centre of the box rather than by `frameId`: an element's `frameId` can
/// name a frame it no longer sits inside, and a photo can sit on a page without
/// ever having been adopted by one. The description of a page has to agree with
/// its render, and the render is geometry.
export function pageHolding(pages: readonly BoardPage[], box: Rect): BoardPage | null {
  for (let index = pages.length - 1; index >= 0; index--) {
    const page = pages[index]!;
    if (boxOnPage(page, box)) return page;
  }
  return null;
}

/// The scene rewritten so that every page's children sit immediately before it,
/// keeping the order they already had among themselves.
///
/// Excalidraw states the invariant — "children elements come right before the
/// parent frame: [el, el, child, child, frame, el]" — and every module that hands
/// a page a picture has had to satisfy it: the compositor emits the frame last,
/// `addPage` moves what it adopts to the end, `placeOnPage` splices what joins in
/// front of the frame. Each of those is building an array, so each does it inline.
/// A caller that is *changing hands on an array it already has* — the tidy, which
/// adopts what it laid out on a page — has no insertion point to write into, so
/// the rule is written once here instead of a fourth time.
///
/// Only pages are gathered, and only when their ownership is being rewritten
/// anyway: pulling a section's children together would reorder a board that has
/// never had a page on it. A frame is never a child of a page (§V.1), so one
/// naming a page as its frame is stepped over rather than nested.
export function pageChildOrder<T extends { id: string; frameId?: string | null }>(
  elements: readonly T[],
): T[] {
  const pageIds = new Set(boardPages(elements).map((page) => page.id));
  if (pageIds.size === 0) return [...elements];

  const children = new Map<string, T[]>();
  for (const element of elements) {
    const frameId = element.frameId;
    if (typeof frameId !== "string" || !pageIds.has(frameId)) continue;
    if (isFrameElement(element) || pageIds.has(element.id)) continue;
    const held = children.get(frameId);
    if (held) held.push(element);
    else children.set(frameId, [element]);
  }
  if (children.size === 0) return [...elements];

  const owned = new Set([...children.values()].flat().map((element) => element.id));

  const ordered: T[] = [];
  for (const element of elements) {
    if (owned.has(element.id)) continue;
    if (pageIds.has(element.id)) ordered.push(...(children.get(element.id) ?? []));
    ordered.push(element);
  }
  return ordered;
}

/// How many bands tall a page is read in (§V.4), so a band is a tenth of the
/// page height.
export const PAGE_READING_BANDS = 10;

/// The order a person reads a *page* in (§V.4): banded by y, a band being a tenth
/// of the page height, then left to right within a band.
///
/// The board's own `readingOrder` cannot answer this, and the reason is in its own
/// comment: it decides two things are the same row by *overlap*, so one tall
/// picture chains its neighbours into a single row. On an unbounded canvas that is
/// the least wrong answer available, because there is no page height to divide by.
/// On a page there is — and the arrangement the overlap rule gets wrong is a
/// staggered one (MASONRY), which is exactly what a composed page carries: a
/// column-height picture down the left makes every other block on the page one row
/// with it, so "the third one" walks across the page rather than down it.
///
/// The band is a width, not a grid line. It is measured from the topmost block
/// still unread rather than from the page's own tenths, because a fixed grid puts
/// two blocks a director sees as one row — tops a few pixels apart, either side of
/// a line — a band apart, and that is the commoner arrangement of the two. Bands
/// anchored to the content cannot chain either: each one is measured from the
/// block that opened it, so blocks stepping down the page a hundred pixels at a
/// time still break into bands.
///
/// By the block's *top* edge rather than its centre, so a full-bleed hero is read
/// before the caption beside its middle rather than after it, and a picture
/// hanging over the top edge is read first rather than filed by how far it hangs.
export function pageReadingOrder<T extends Rect>(items: readonly T[], page: Rect): T[] {
  const band = page.height / PAGE_READING_BANDS;
  /// A page with no height to divide by is not a page anything was read off; fall
  /// back to the board's rule rather than calling every block one row.
  if (!(band > 0)) return readingOrder(items);

  const down = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  const bands: T[][] = [];
  let opened = -Infinity;
  for (const item of down) {
    if (bands.length && item.y - opened <= band) {
      bands[bands.length - 1]!.push(item);
    } else {
      bands.push([item]);
      opened = item.y;
    }
  }

  return bands.flatMap((row) => [...row].sort((a, b) => a.x - b.x));
}

/// What is on a page (§V.3), in reading order.
///
/// Images and text both: a template's headline and captions are part of what the
/// page says, and a page described as its photographs alone is a page whose
/// title the model has to guess at.
///
/// Rotation is ignored when deciding `clipped` — the box is the element's own,
/// unrotated one. The only template that tilts anything keeps it well inside the
/// page, so the alternative is arithmetic paid on every block to change nothing.
export function pageItems(items: readonly BoardItem[], page: Rect): PageItem[] {
  /// Stacked before it is ordered: `items` arrives in the scene array's order, so
  /// z is the index here and survives the sort into reading order below.
  const on = items
    .filter((item) => boxOnPage(page, item))
    .map((item, z) => ({
      ...item,
      z,
      clipped:
        item.x < page.x ||
        item.y < page.y ||
        item.x + item.width > page.x + page.width ||
        item.y + item.height > page.y + page.height,
    }));

  return pageReadingOrder(on, page);
}
