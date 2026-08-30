import { normalizedTitle, withTitle } from "@/lib/util/named-list";

export const BOARD_TITLE_LIMIT = 200;
export const DEFAULT_BOARD_TITLE = "Untitled board";

export function normalizedBoardTitle(raw: string): string | null {
  return normalizedTitle(raw, BOARD_TITLE_LIMIT);
}

export function nextBoardTitle(boards: { title: string }[]): string {
  const taken = new Set(boards.map((board) => board.title.trim()));
  if (!taken.has(DEFAULT_BOARD_TITLE)) return DEFAULT_BOARD_TITLE;
  for (let n = 2; n <= taken.size + 2; n += 1) {
    const candidate = `${DEFAULT_BOARD_TITLE} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return DEFAULT_BOARD_TITLE;
}

const COPY_SUFFIX = /\s*\(copy(?: \d+)?\)$/;

export function duplicateBoardTitle(boards: { title: string }[], sourceTitle: string): string {
  const taken = new Set(boards.map((board) => board.title.trim()));
  const base = sourceTitle.trim().replace(COPY_SUFFIX, "").trim() || DEFAULT_BOARD_TITLE;

  let candidate = "";
  for (let n = 1; n <= taken.size + 1; n += 1) {
    const suffix = n === 1 ? " (copy)" : ` (copy ${n})`;
    candidate = `${base.slice(0, BOARD_TITLE_LIMIT - suffix.length).trim()}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return candidate;
}

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
