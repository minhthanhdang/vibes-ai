/// A board the assistant has offered to throw away, and the record of one the
/// director threw.
///
/// Every other board tool in this layer writes: a swap lands, a reword lands, a
/// rebuild replaces an arrangement. Each of those is a change the director can
/// see and undo by asking for the other thing. A deletion is the one act in the
/// project that nothing can walk back — the scene, the lines and the
/// arrangement go, and no call in the pipeline can put them back — so it is the
/// one board act the assistant offers instead of making, exactly as agent 3
/// offers a cut rather than filing one.
///
/// That is not the same argument agent 3's offer rests on (there the pixels are
/// cut in the browser and the server *cannot* file them). Here the server could
/// perfectly well delete the row. It does not, because an irreversible act
/// belongs to the hand that has to live with it.
export type DiscardedBoard = {
  boardId: string;
  title: string;
  /// What was on it when it went, so the sentence in the conversation names the
  /// loss rather than an id. Read off the tile the offer was made with — after
  /// the delete there is no row to ask.
  ///
  /// Absent when the board went from the tab row instead: that list carries
  /// titles and renders, never a count of what is on a scene. The note then says
  /// the photographs are safe without saying how many, which is the whole of
  /// what the count was for.
  pictures?: number;
};

/// The key a discarded board's tile is drawn under. Pinned by test to
/// `attachmentKey` of the board attachment it settles, the same way
/// `takenOfferKey` is pinned to a crop's: the offer and the thing that settles it
/// have to agree on one string or the tile goes on offering an act that is
/// already done.
export function discardKey(boardId: string) {
  return `board:${boardId}`;
}

/// What the conversation is told when a board goes.
///
/// The director did it with their hands, in another column, so it rides up as
/// their turn — the same shape as a cut they took (`takenCutNote`). It says the
/// id is dead as well as the board, because the boards primed into the next
/// turn's instruction are a fresh read and this one will simply be absent: a
/// model that has the id in the conversation above would otherwise pass it to
/// inspect_board and be told a board it just discussed does not exist.
///
/// And it says the photographs are still there. Deleting a board deletes no
/// picture — the elements point at reference rows and nothing else — but "I
/// discarded the board" is a sentence a director can hear as having lost the
/// pictures on it, and the assistant is the one being asked next.
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
