export type DiscardedBoard = {
  boardId: string;
  title: string;
  pictures?: number;
};

export function discardKey(boardId: string) {
  return `board:${boardId}`;
}

export function discardedBoardNote(board: DiscardedBoard) {
  const title = board.title.trim() || "Untitled board";
  const held =
    board.pictures === undefined
      ? " Any photographs that were on it are still in the gallery."
      : !board.pictures
        ? ""
        : board.pictures === 1
          ? " The photograph that was on it is still in the gallery."
          : ` The ${board.pictures} photographs that were on it are still in the gallery.`;
  return `I discarded the board “${title}” (${board.boardId}). It is gone from the project, and that id no longer names anything — do not pass it to a tool.${held}`;
}
