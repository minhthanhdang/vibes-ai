import type { BoardItem, Rect } from "@/lib/boards/board-contents";
import { PAGE_GAP, layoutOnPage, type MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import {
  CUSTOM_PAGE_PRESET,
  elementBox,
  isPageElement,
  itemsOnPage,
  pageBackground,
  pageById,
  pageHolds,
  pageItems,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { boardItems } from "@/lib/boards/board-contents";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

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

export function layoutForPage<T extends MoodboardLayout | null>(
  layout: T,
  page: BoardPage | null,
): T {
  if (!layout || !page || page.preset !== CUSTOM_PAGE_PRESET) return layout;
  return layoutOnPage(layout, page) as T;
}

export function newPageBox({
  pages = [],
  sourcePageId,
  size,
  occupied = [],
}: {
  pages?: readonly BoardPage[];
  sourcePageId?: string | null;
  size: { width: number; height: number };
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

export function sceneOffPage(
  elements: readonly SceneElement[],
  page: BoardPage,
  pages: readonly BoardPage[],
): SceneElement[] {
  return elements.filter((element) => {
    if (element.id === page.id) return false;
    if (isPageElement(element)) return true;
    const box = elementBox(element);
    return !box || !pageHolds(pages, page, box);
  });
}

export function pageBackgroundElement(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  page: BoardPage,
): SceneElement | null {
  const paired = elements.flatMap((element) => {
    const [item] = boardItems([element]);
    return item ? [{ ...item, element }] : [];
  });

  const behind = pageBackground(pageItems(itemsOnPage(paired, pages, page), page), page);
  return behind?.element ?? null;
}

export function pageCarriesShapes(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  page: BoardPage | null,
): boolean {
  const items = boardItems(elements, { shapes: true });
  const on = page ? pageItems(itemsOnPage(items, pages, page), page) : items;
  return on.some((item) => item.kind === "shape");
}
