import { PAGES_PER_MESSAGE } from "@/lib/pages/page-brief";
import type { PageDigest } from "@/lib/pages/page-contents";
import type { PagePicture } from "@/lib/pages/page-picture";

export type PageChoice = {
  boardId: string;
  pageId: string;
  revision: number;
  name: string;
};

export function pageChoiceKey(choice: Pick<PageChoice, "boardId" | "pageId">) {
  return `${choice.boardId}:${choice.pageId}`;
}

export function pagesAfterPick(
  picked: readonly PageChoice[],
  choice: PageChoice,
  limit = PAGES_PER_MESSAGE,
): PageChoice[] {
  const key = pageChoiceKey(choice);
  const without = picked.filter((page) => pageChoiceKey(page) !== key);
  if (without.length < picked.length) return without;
  return [...without, choice].slice(-limit);
}

export function pagesStillOnBoard(
  picked: readonly PageChoice[],
  board: { boardId: string; revision: number; pages: readonly { pageId: string; name: string }[] },
): PageChoice[] {
  return picked.flatMap((choice) => {
    if (choice.boardId !== board.boardId) return [choice];
    const page = board.pages.find((listed) => listed.pageId === choice.pageId);
    if (!page) return [];
    return page.name === choice.name && board.revision === choice.revision
      ? [choice]
      : [{ ...choice, revision: board.revision, name: page.name }];
  });
}

export function pageChoiceNote(page: PageDigest) {
  const blocks = page.pictures + page.lines + page.shapes;
  return [
    `${page.width}×${page.height}`,
    `${blocks} ${blocks === 1 ? "block" : "blocks"}`,
    page.clipped ? `${page.clipped} over the edge` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function attachedPageInput(
  picked: readonly PageChoice[],
  pictures: readonly PagePicture[] = [],
) {
  const taken = new Map(pictures.map((picture) => [pageChoiceKey(picture), picture]));
  return picked.map(({ boardId, pageId, revision }) => {
    const picture = taken.get(pageChoiceKey({ boardId, pageId }));
    return picture
      ? { boardId, pageId, revision: picture.revision, renderUri: picture.renderUri }
      : { boardId, pageId, revision };
  });
}
