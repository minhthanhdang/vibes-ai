/// A page the assistant has offered to take off a board, and the record of one
/// the user took.
///
/// Same rule as `board-discard.ts` and for the same reason: the arrangement on a
/// page is the thing being lost, no call in the pipeline can put it back, and an
/// irreversible act belongs to the hand that has to live with it. So the tool
/// offers and the button under the tile is what settles it.
///
/// What it is *not* is a smaller discard_board. A board going takes its pages,
/// its scene and its id; a page going leaves the board standing with one fewer
/// rectangle on it, and the id the model has been using all turn is still good.
/// That difference is the whole of what the note below has to say.

export type DiscardedPage = {
  boardId: string;
  pageId: string;
  boardTitle: string;
  /// The user's own word for the page, empty on one nobody named. Called
  /// `title` rather than `name` because that is what every record in this map
  /// calls the thing that has gone — a tile asks one question of whatever settled
  /// it, and the answer is what it was called.
  title: string;
  /// How many photographs were standing on it when it went, off the tile the
  /// offer was made with — after the write there is no page to count.
  pictures: number;
  /// How many pages the board has left. Zero is a board with no page on it at
  /// all, which is a canvas rather than a deleted board and has to be said as
  /// one.
  pagesLeft: number;
};

/// The key a discarded page's tile is drawn under. A board tile is keyed by its
/// board (`attachmentKey`), and this has to be a string nothing else produces:
/// the board is still there, so keying a gone page by its board id would put
/// every later tile of that board behind the same "discarded" mark.
export function pageDiscardKey(boardId: string, pageId: string) {
  return `board:${boardId}#page:${pageId}`;
}

/// What the conversation is told when a page goes.
///
/// It rides up as the user's turn for the reason a discarded board's does —
/// they did it with their hands, in another column — and it says the three things
/// the model would otherwise get wrong on the next message: that the pageId is
/// dead while the boardId is not, what came off the board with it, and that the
/// photographs are still in the gallery.
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
