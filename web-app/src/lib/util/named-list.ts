import { collapsed } from "@/lib/util/text";

/// The two rules a project's list of named rows keeps, wherever it keeps them.
///
/// `conversation-list.ts` and `scene/moodboard-boards.ts` are deliberately the
/// same shape — naming, selection and removal for a project's list of things —
/// and two of their functions had drifted into being byte-identical, or
/// identical but for a constant. These are those two. The rest of the pair is
/// *not* here on purpose: the selection functions differ behaviourally and their
/// tests say so, which is a real difference rather than a duplication.

/// One line, no runs of blank space, short enough for the row it renders in.
/// Truncated rather than rejected, because the write behind it takes at most
/// this many characters and a paste of an essay has to be cut somewhere.
///
/// Null means "nothing to save" — an empty or whitespace-only edit is a
/// cancelled rename. What *else* null means is the caller's, and the two callers
/// disagree: a board with no name is nothing, and a conversation with no name
/// goes back to deriving one.
export function normalizedTitle(raw: string, limit: number): string | null {
  const said = collapsed(raw);
  if (!said) return null;
  return said.slice(0, limit).trim();
}

/// The optimistic rename: the row the user just typed into is the one thing on
/// screen that must not flicker back to the old name for a round trip.
export function withTitle<T extends { id: string; title: string }>(
  rows: readonly T[],
  id: string,
  title: string,
): T[] {
  return rows.map((row) => (row.id === id ? { ...row, title } : row));
}
