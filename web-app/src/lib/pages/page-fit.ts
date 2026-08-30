import type { BoardItem } from "@/lib/boards/board-contents";
import type { MoodboardLayout, Placement } from "@/lib/layout/moodboard-layouts";
import type { CropShape } from "@/lib/references/reference-version";
import {
  looseFits,
  scenePlacements,
  slotShapeFor,
  standsAsComposed,
  type LooseFit,
} from "@/lib/layout/slot-fit";
import { itemsOnPage, pagesInReadingOrder, type BoardPage } from "@/lib/pages/board-pages";
import { layoutForPage, pageLocalItems } from "@/lib/pages/page-compose";

export type PagedLooseFit = LooseFit & { pageId?: string; page?: string };

export function pagedLooseFits(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  layout: MoodboardLayout,
): PagedLooseFit[] {
  const ordered = pagesInReadingOrder(pages);
  if (ordered.length === 0) return looseFits(scenePlacements(items, layout));

  const named = ordered.length > 1;
  const loose = ordered.flatMap((page) => {
    const on = scenePlacements(
      pageLocalItems(itemsOnPage(items, ordered, page), page),
      layoutForPage(layout, page),
    );
    return looseFits(on).map((fit) => ({
      ...fit,
      ...(named && { pageId: page.id, page: page.name }),
    }));
  });
  return loose.sort((a, b) => a.fills - b.fills);
}

export function pagedSlotShape(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  layout: MoodboardLayout,
  referenceId: string,
  onPage?: BoardPage | null,
): { slotId: string; shape: CropShape } | null {
  const ordered = pagesInReadingOrder(pages);
  if (ordered.length === 0) return slotShapeFor(items, layout, referenceId);

  for (const page of onPage ? [onPage] : ordered) {
    const on = pageLocalItems(itemsOnPage(items, ordered, page), page);
    const opening = slotShapeFor(on, layoutForPage(layout, page), referenceId);
    if (opening) return opening;
  }
  return null;
}

export function pagedPlacements(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  layout: MoodboardLayout,
): Placement[] {
  const ordered = pagesInReadingOrder(pages);
  if (ordered.length === 0) return scenePlacements(items, layout);

  return ordered.flatMap((page) =>
    scenePlacements(
      pageLocalItems(itemsOnPage(items, ordered, page), page),
      layoutForPage(layout, page),
    ).map(
      ({ slot, block }) => ({
        slot: { ...slot, x: slot.x + page.x, y: slot.y + page.y },
        block,
      }),
    ),
  );
}

export function pagedStandsAsComposed(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  layout: MoodboardLayout | null,
): boolean {
  if (!layout) return false;
  if (pages.length === 0) return standsAsComposed(items, layout);

  const pictures = items.filter(
    (item) => item.kind === "image" && typeof item.referenceId === "string" && item.referenceId,
  );
  if (!pictures.length) return false;

  return pagedPlacements(items, pages, layout).length === pictures.length;
}

export function pageStandsAsComposed(
  items: readonly BoardItem[],
  pages: readonly BoardPage[],
  page: BoardPage,
  layout: MoodboardLayout | null,
): boolean {
  return pagedStandsAsComposed(itemsOnPage(items, pages, page), [page], layout);
}
