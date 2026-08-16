/// The rules for a project's list of boards, with no React or tRPC in them:
/// what a new board is called, what a rename is allowed to become, and which
/// board the director is left looking at once one goes away.

export const BOARD_TITLE_LIMIT = 200;
export const DEFAULT_BOARD_TITLE = "Untitled board";

/// One line, no runs of blank space, and short enough for the column it renders
/// in. Truncated rather than rejected: `rename` on the server takes at most 200
/// characters, so a paste of an essay has to be cut here or the write fails.
/// Null means "nothing to save" — an empty or whitespace-only edit is a
/// cancelled rename, not a board with no name.
export function normalizedBoardTitle(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.slice(0, BOARD_TITLE_LIMIT).trim();
}

/// A name for the next board that is not already on the list. The column shows
/// titles alone, so three boards all reading "Untitled board" are three tabs the
/// director cannot tell apart — the default has to be made unique before the
/// row is created, since the database default cannot see its siblings.
export function nextBoardTitle(boards: { title: string }[]): string {
  const taken = new Set(boards.map((board) => board.title.trim()));
  if (!taken.has(DEFAULT_BOARD_TITLE)) return DEFAULT_BOARD_TITLE;
  for (let n = 2; n <= taken.size + 2; n += 1) {
    const candidate = `${DEFAULT_BOARD_TITLE} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return DEFAULT_BOARD_TITLE;
}

/// Which board is on screen after `removedId` is gone. Deleting a board the
/// director is not looking at must not move them, and deleting the one they are
/// looking at lands on the next board along — falling back to the previous one
/// when the deleted board was last, and to null when it was the only one.
export function boardAfterRemoval<T extends { id: string }>(
  boards: T[],
  removedId: string,
  activeId: string | null,
): string | null {
  if (activeId !== removedId) {
    return boards.some((board) => board.id === activeId) ? activeId : null;
  }
  const index = boards.findIndex((board) => board.id === removedId);
  if (index < 0) return activeId === removedId ? null : activeId;
  const remaining = boards.filter((board) => board.id !== removedId);
  return remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
}

/// The board the panel shows given what the director last clicked. A chosen id
/// the list no longer answers to — deleted here, or in another tab — falls back
/// to the first board rather than rendering nothing.
export function activeBoardId<T extends { id: string }>(
  boards: T[] | undefined,
  chosenId: string | null,
): string | null {
  if (!boards?.length) return null;
  return boards.some((board) => board.id === chosenId) ? chosenId : boards[0]!.id;
}

export function withBoardTitle<T extends { id: string; title: string }>(
  boards: T[],
  id: string,
  title: string,
): T[] {
  return boards.map((board) => (board.id === id ? { ...board, title } : board));
}
