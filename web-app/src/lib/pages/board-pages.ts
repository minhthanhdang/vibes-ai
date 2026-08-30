import { PAGE_GAP, PAGE_PRESETS, type PagePresetId } from "@/lib/layout/moodboard-layouts";
import { readingOrder, type BoardItem, type Rect } from "@/lib/boards/board-contents";
import {
  FRAME_TYPES,
  boardFrames,
  frameHolding,
  frameOf,
  type FrameBox,
} from "@/lib/canvas/moodboard-frames";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export const CUSTOM_PAGE_PRESET = "Custom";

export type PageSizeLabel = PagePresetId | typeof CUSTOM_PAGE_PRESET;

const PRESET_TOLERANCE = 1;

export type BoardPage = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  preset: PageSizeLabel;
  createdAs: PagePresetId | null;
};

export type PageItem = BoardItem & {
  clipped: boolean;
  z: number;
};

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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

export function pageCustomData(width: number, height: number) {
  const preset = pageSizeLabel(width, height);
  return { page: preset === CUSTOM_PAGE_PRESET ? {} : { preset } };
}

export function isPageElement(element: unknown): boolean {
  const plain = plainObject(element);
  if (!plain || plain.isDeleted === true || plain.type !== "frame") return false;
  return pageMarker(plain) !== null;
}

export function isFrameElement(element: unknown): boolean {
  const plain = plainObject(element);
  if (!plain || plain.isDeleted === true) return false;
  return typeof plain.type === "string" && (FRAME_TYPES as readonly string[]).includes(plain.type);
}

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

export function pagesInReadingOrder(pages: readonly BoardPage[]): BoardPage[] {
  return readingOrder(pages);
}

export function pageById(pages: readonly BoardPage[], id: unknown): BoardPage | null {
  if (typeof id !== "string" || !id) return null;
  return pages.find((page) => page.id === id) ?? null;
}

export function nextPageName(pages: readonly { name: string }[]): string {
  let highest = pages.length;
  for (const page of pages) {
    const match = /^page\s+(\d+)$/i.exec(page.name);
    const numbered = match ? Number(match[1]) : 0;
    if (numbered > highest) highest = numbered;
  }
  return `Page ${highest + 1}`;
}

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

export function nextPageBox({
  pages = [],
  sourcePageId,
  defaultSize,
  around = [],
}: {
  pages?: readonly BoardPage[];
  sourcePageId?: string | null;
  defaultSize: { width: number; height: number };
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

export function boxOnPage(page: Rect, box: Rect): boolean {
  return within(page, centreOf(box));
}

export function elementBox(element: SceneElement): Rect | null {
  const box = { x: element.x, y: element.y, width: element.width, height: element.height };
  const readable = Object.values(box).every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  return readable ? (box as Rect) : null;
}

export function pageHolding(pages: readonly BoardPage[], box: Rect): BoardPage | null {
  for (let index = pages.length - 1; index >= 0; index--) {
    const page = pages[index]!;
    if (boxOnPage(page, box)) return page;
  }
  return null;
}

export function pageHolds(pages: readonly BoardPage[], page: BoardPage, box: Rect): boolean {
  return pageHolding(pages, box)?.id === page.id;
}

export function itemsOnPage<T extends Rect>(
  items: readonly T[],
  pages: readonly BoardPage[],
  page: BoardPage,
): T[] {
  return items.filter((item) => pageHolds(pages, page, item));
}

export function boardSections(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
): FrameBox[] {
  const paged = new Set(pages.map((page) => page.id));
  return boardFrames(elements).filter((frame) => !paged.has(frame.id));
}

export function pageElements(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  page: BoardPage,
  sections: readonly FrameBox[] = boardSections(elements, pages),
): SceneElement[] {
  return elements.filter((element) => {
    if (element.isDeleted === true) return false;
    if (isFrameElement(element)) return false;
    if (frameOf(sections, element.frameId)) return false;
    const own = elementBox(element);
    if (!own) return false;
    return pageHolds(pages, page, own);
  });
}

export function frameJoining(
  frames: readonly FrameBox[],
  pages: readonly BoardPage[],
  box: Rect,
): string | null {
  const pageIds = new Set(pages.map((page) => page.id));
  const section = frameHolding(
    frames.filter((frame) => !pageIds.has(frame.id)),
    box,
  );
  return section ?? pageHolding(pages, box)?.id ?? null;
}

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

export const PAGE_READING_BANDS = 10;

export function pageReadingOrder<T extends Rect>(items: readonly T[], page: Rect): T[] {
  const band = page.height / PAGE_READING_BANDS;
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

export function pageItems<T extends Rect>(
  items: readonly T[],
  page: Rect,
): (T & { clipped: boolean; z: number })[] {
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

const COVER_SLACK = 0.5 / 1000;

function coversPage(item: Rect, page: Rect): boolean {
  const slackX = page.width * COVER_SLACK;
  const slackY = page.height * COVER_SLACK;
  return (
    item.x <= page.x + slackX &&
    item.y <= page.y + slackY &&
    item.x + item.width >= page.x + page.width - slackX &&
    item.y + item.height >= page.y + page.height - slackY
  );
}

export function pageBackground<T extends Rect & { kind: BoardItem["kind"]; z: number }>(
  on: readonly T[],
  page: Rect,
): T | null {
  if (on.length < 2) return null;
  const drawn = on.filter((item) => item.kind !== "shape");
  const back = drawn.length
    ? drawn.reduce((lowest, item) => (item.z < lowest.z ? item : lowest))
    : null;
  if (!back || back.kind !== "image") return null;
  return coversPage(back, page) ? back : null;
}
