import {
  boardPages,
  pageElements,
  pagesInReadingOrder,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { isPageBackground } from "@/lib/pages/page-background";
import type { VibesBrief } from "@/lib/vibes/vibes-brief";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type VibesRunPage = {
  pageId: string;
  index: number;
  designed: boolean;
};

function pageIsBlank(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  page: BoardPage,
): boolean {
  return pageElements(elements, pages, page).every((element) => isPageBackground(element));
}

export function vibesPageDesigned({
  elements,
  pageId,
}: {
  elements: readonly SceneElement[];
  pageId: string;
}): boolean {
  const pages = pagesInReadingOrder(boardPages(elements));
  const page = pages.find((candidate) => candidate.id === pageId);

  return page ? !pageIsBlank(elements, pages, page) : false;
}

export function vibesRun({
  elements,
  brief,
}: {
  elements: readonly SceneElement[];
  brief: VibesBrief;
}): VibesRunPage[] {
  const pages = pagesInReadingOrder(boardPages(elements));

  return pages.slice(0, brief.pages).map((page, index) => ({
    pageId: page.id,
    index,
    designed: !pageIsBlank(elements, pages, page),
  }));
}

export function vibesPending(run: readonly VibesRunPage[]): VibesRunPage[] {
  return run.filter((page) => !page.designed);
}

export type VibesResumeOffer = {
  total: number;
  designed: number;
  remaining: number;
  label: string;
  action: string;
};

export function vibesResumeOffer(run: readonly VibesRunPage[]): VibesResumeOffer | null {
  const remaining = vibesPending(run).length;
  if (remaining === 0) return null;

  const designed = run.length - remaining;
  return {
    total: run.length,
    designed,
    remaining,
    label: `${designed} of ${run.length} ${run.length === 1 ? "page" : "pages"} designed`,
    action: remaining === 1 ? "Design the last page" : `Design ${remaining} pages`,
  };
}
