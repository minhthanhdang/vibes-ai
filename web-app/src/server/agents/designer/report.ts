import { boardContents } from "@/lib/boards/board-contents";
import { boardPages, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import {
  pageContents,
  pageDigests,
  picturesOffPages,
  type PageDigest,
  type PagePicture,
} from "@/lib/pages/page-contents";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type DesignReport = {
  page?: PageDigest;
  pages?: PageDigest[];
  placed: PagePicture[];
  lines: string[];
  background: string | null;
  notPlaced?: string[];
  looseOnBoard?: string[];
  made?: { generated?: readonly string[]; cropped?: readonly string[] };
};

export function designReport({
  elements,
  pageId,
  named = [],
  made,
}: {
  elements: readonly SceneElement[];
  pageId: string | null;
  named?: readonly string[];
  made?: { generated: readonly string[]; cropped: readonly string[] };
}): DesignReport {
  const pages = pagesInReadingOrder(boardPages(elements));
  const on = pageId ? pageById(pages, pageId) : null;

  const digests = pageDigests(elements);
  const scoped = on ? pageContents(elements, on) : null;

  const wide = scoped ? null : boardContents(elements);

  const placed: PagePicture[] = scoped
    ? scoped.pictures
    : wide!.pictures.map((referenceId) => ({ referenceId, clipped: false }));

  const here = new Set(placed.map(({ referenceId }) => referenceId));
  const notPlaced = named.filter((id) => id && !here.has(id));

  const loose = picturesOffPages(elements, pages);

  const generated = made?.generated ?? [];
  const cropped = made?.cropped ?? [];

  return {
    ...(on ? { page: digests.find(({ pageId: id }) => id === on.id)! } : { pages: digests }),
    placed,
    lines: scoped ? scoped.lines : wide!.lines,
    background: scoped ? scoped.background : null,
    ...(notPlaced.length && { notPlaced }),
    ...(loose.length && { looseOnBoard: loose }),
    ...((generated.length || cropped.length) && {
      made: {
        ...(generated.length && { generated }),
        ...(cropped.length && { cropped }),
      },
    }),
  };
}
