import { normalizedTitle, withTitle } from "@/lib/util/named-list";

/// The rules for a project's list of boards, with no React or tRPC in them:
/// what a new board is called, what a rename is allowed to become, and which
/// board the user is left looking at once one goes away.

export const BOARD_TITLE_LIMIT = 200;
export const DEFAULT_BOARD_TITLE = "Untitled board";

/// One line, no runs of blank space, and short enough for the column it renders
/// in. Truncated rather than rejected: `rename` on the server takes at most 200
/// characters, so a paste of an essay has to be cut here or the write fails.
/// Null means "nothing to save" — an empty or whitespace-only edit is a
/// cancelled rename, not a board with no name.
export function normalizedBoardTitle(raw: string): string | null {
  return normalizedTitle(raw, BOARD_TITLE_LIMIT);
}

/// A name for the next board that is not already on the list. The column shows
/// titles alone, so three boards all reading "Untitled board" are three tabs the
/// user cannot tell apart — the default has to be made unique before the
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

/// A copy of a board is a *variation* of it, so the trail of copies is noise:
/// duplicating "Act two (copy)" gives "Act two (copy 2)", never
/// "Act two (copy) (copy)". The number is the first one free, so a board
/// duplicated three times reads as three numbered variants of the same name.
const COPY_SUFFIX = /\s*\(copy(?: \d+)?\)$/;

export function duplicateBoardTitle(boards: { title: string }[], sourceTitle: string): string {
  const taken = new Set(boards.map((board) => board.title.trim()));
  const base = sourceTitle.trim().replace(COPY_SUFFIX, "").trim() || DEFAULT_BOARD_TITLE;

  let candidate = "";
  for (let n = 1; n <= taken.size + 1; n += 1) {
    const suffix = n === 1 ? " (copy)" : ` (copy ${n})`;
    /// The base is what gets cut, not the suffix: a truncated name that no
    /// longer says it is a copy is a board the user cannot place.
    candidate = `${base.slice(0, BOARD_TITLE_LIMIT - suffix.length).trim()}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return candidate;
}

/// Which board is on screen after `removedId` is gone. Deleting a board the
/// user is not looking at must not move them, and deleting the one they are
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

/// The board the panel shows given what the user last clicked. A chosen id
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
  return withTitle(boards, id, title);
}
