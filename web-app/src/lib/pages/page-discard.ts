export type DiscardedPage = {
  boardId: string;
  pageId: string;
  boardTitle: string;
  title: string;
  pictures: number;
  pagesLeft: number;
};

export function pageDiscardKey(boardId: string, pageId: string) {
  return `board:${boardId}#page:${pageId}`;
}

export function discardedPageNote(page: DiscardedPage) {
  const board = page.boardTitle.trim() || "Untitled board";
  const called = page.title.trim() ? `“${page.title.trim()}”` : "a page";
  const held = !page.pictures
    ? ""
    : page.pictures === 1
      ? " The photograph that was on it is still in the gallery."
      : ` The ${page.pictures} photographs that were on it are still in the gallery.`;
  const left = !page.pagesLeft
    ? " That board now has no page on it at all — it is still in the project, and add_page would give it one."
    : page.pagesLeft === 1
      ? " That board is down to one page."
      : ` That board has ${page.pagesLeft} pages left.`;
  return `I took ${called} (${page.pageId}) off the board “${board}” (${page.boardId}). The page and what was arranged on it are gone and that pageId no longer names anything — do not pass it to a tool. The board itself is still there and ${page.boardId} still works.${left}${held}`;
}
