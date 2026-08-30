import { boardItems, readingOrder, type BoardItem } from "@/lib/boards/board-contents";
import {
  boardPages,
  itemsOnPage,
  pageBackground,
  pageHolding,
  pageItems,
  pagesInReadingOrder,
  type BoardPage,
  type PageSizeLabel,
} from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type PagePicture = {
  referenceId: string;
  clipped: boolean;
};

export type PageContents = {
  pictures: PagePicture[];
  background: string | null;
  lines: string[];
  shapes: number;
  unnamedImages: number;
};

export type PageDigest = {
  pageId: string;
  name: string;
  position: number;
  of: number;
  width: number;
  height: number;
  preset: PageSizeLabel;
  pictures: number;
  lines: number;
  shapes: number;
  clipped: number;
};

export function pageContents(elements: readonly SceneElement[], page: BoardPage): PageContents {
  return pageContentsOf(boardItems(elements, { shapes: true }), boardPages(elements), page);
}

function pageContentsOf(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  page: BoardPage,
): PageContents {
  const on = pageItems(itemsOnPage(items, pages, page), page);
  const behind = pageBackground(on, page);

  const pictures: PagePicture[] = [];
  const at = new Map<string, number>();
  for (const item of on) {
    if (item === behind) continue;
    if (item.kind !== "image" || !item.referenceId) continue;
    const seen = at.get(item.referenceId);
    if (seen === undefined) {
      at.set(item.referenceId, pictures.length);
      pictures.push({ referenceId: item.referenceId, clipped: item.clipped });
      continue;
    }
    pictures[seen]!.clipped ||= item.clipped;
  }

  return {
    pictures,
    background: behind?.referenceId ?? null,
    shapes: on.filter((item) => item.kind === "shape").length,
    lines: on
      .filter((item) => item.kind === "text")
      .map((item) => (item.text ?? "").trim())
      .filter(Boolean),
    unnamedImages: on.filter(
      (item) => item !== behind && item.kind === "image" && !item.referenceId,
    ).length,
  };
}

export function pageDigests(elements: readonly SceneElement[]): PageDigest[] {
  const pages = pagesInReadingOrder(boardPages(elements));
  const items = boardItems(elements, { shapes: true });

  return pages.map((page, index) => {
    const { pictures, lines, shapes } = pageContentsOf(items, pages, page);
    return {
      pageId: page.id,
      name: page.name,
      position: index + 1,
      of: pages.length,
      width: page.width,
      height: page.height,
      preset: page.preset,
      pictures: pictures.length,
      lines: lines.length,
      shapes,
      clipped: pictures.filter((picture) => picture.clipped).length,
    };
  });
}

export function picturesOffPages(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
): string[] {
  if (pages.length === 0) return [];

  const loose: string[] = [];
  const seen = new Set<string>();
  for (const item of readingOrder(boardItems(elements))) {
    if (item.kind !== "image" || !item.referenceId) continue;
    if (seen.has(item.referenceId) || pageHolding(pages, item)) continue;
    seen.add(item.referenceId);
    loose.push(item.referenceId);
  }
  return loose;
}
