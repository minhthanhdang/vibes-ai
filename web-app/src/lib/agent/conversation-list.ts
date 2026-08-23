import { z } from "zod";
import { spoken, storedPartSchema } from "@/lib/agent/conversation";

/// The rules for a project's list of conversations, with no React and no tRPC in
/// them: what a thread is called, what a rename is allowed to become, which one
/// the column opens, and where the user is left when one goes away
/// (orchestrator-tool-reference §VII).
///
/// Deliberately the same shape as `moodboard-boards.ts` — naming, selection and
/// removal for a project's list of things — and named `conversation-list` rather
/// than `conversations` so nobody reads it as a rewrite of `conversation.ts`,
/// which is the message format.

/// The cut. A switcher row is one line in a column that is 280px at its
/// narrowest, so a title past this is a title nobody reads the end of.
export const CONVERSATION_TITLE_LIMIT = 60;

/// The switcher lists the 50 most recently updated threads. A ceiling on a
/// *read* and not on the project, exactly as `CHAT_LIST_LIMIT` is on messages
/// (§VII.7): the fifty-first is still a row, still readable by id, and simply
/// not in the list the header opens with.
export const CONVERSATIONS_PER_PROJECT = 50;

/// What a thread nobody has spoken in reads as. It is not stored — an unspoken
/// chat is not a row at all (§VII.3) — and an emptied thread does not fall back
/// to it either, because `clear` writes the name it had into the column first.
export const NEW_CHAT_TITLE = "New chat";

/// A thread's name, out of its own first user message (§VII.4).
///
/// The first line alone: a brief pasted in as six paragraphs is one line in the
/// switcher, and the line that opens it is the one that says what the thread is
/// about. Cut at a word boundary with the ellipsis inside the limit, so the row
/// is never longer than the column and never ends mid-word.
///
/// Empty in, empty out — the caller decides what an unnamed thread reads as.
export function derivedConversationTitle(said: string): string {
  const line = said.split("\n").find((candidate) => candidate.trim()) ?? "";
  const collapsed = line.replace(/\s+/g, " ").trim();
  if (collapsed.length <= CONVERSATION_TITLE_LIMIT) return collapsed;

  const kept = collapsed.slice(0, CONVERSATION_TITLE_LIMIT - 1);
  const boundary = kept.lastIndexOf(" ");
  /// A first "word" longer than the whole limit has no boundary to cut at, and
  /// a cut in the middle of it is still better than a row that overflows.
  return `${(boundary > 0 ? kept.slice(0, boundary) : kept).trimEnd()}…`;
}

const storedParts = z.array(storedPartSchema);

/// What the switcher draws for one thread: the written title if there is one,
/// else the name derived from its first user message, else `NEW_CHAT_TITLE`.
///
/// The `parts` → `spoken` parse lives here rather than in the router so the
/// router stays glue, and so a thread whose first message was written by a build
/// this one has not met is left *named* rather than unnamed — `spoken` skips a
/// part it does not know, and a row is never rejected on read.
export function conversationLabel({
  title,
  firstUserParts,
}: {
  title: string;
  firstUserParts?: unknown;
}): string {
  const written = title.trim();
  if (written) return written;

  const parsed = storedParts.safeParse(firstUserParts);
  const derived = parsed.success ? derivedConversationTitle(spoken(parsed.data)) : "";
  return derived || NEW_CHAT_TITLE;
}

/// One line, no runs of blank space, short enough for the row it renders in.
/// Mirrors `normalizedBoardTitle`: truncated rather than rejected, and `null`
/// means "nothing to save" — an empty or whitespace-only edit is a cancelled
/// rename. On this door `null` has a second meaning the board's does not have,
/// and the rename mutation owns it: clearing the field puts the thread back to
/// deriving its own name.
export function normalizedConversationTitle(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.slice(0, CONVERSATION_TITLE_LIMIT).trim();
}

/// Which thread the column is showing, given what the user last chose.
///
/// `list` is newest-spoken-in first, so its head is the most recently updated.
/// `session` is the ids this browser minted and may not have spoken in yet
/// (§VII.3): an unspoken thread is in no list, and without this the column would
/// jump off it the moment the list landed.
///
/// `fresh` is what a project with nothing to open gets — minted by the caller,
/// because a pure function cannot mint and the id has to be stable across
/// renders.
export function openConversationId(
  list: readonly { id: string }[] | undefined,
  chosen: string | null,
  session: ReadonlySet<string>,
  fresh: string,
): string {
  if (chosen && (list?.some((row) => row.id === chosen) || session.has(chosen))) return chosen;
  return list?.[0]?.id ?? fresh;
}

/// Which thread is open once `removedId` is gone. Deleting one the user is not
/// looking at must not move them — including when they are sitting in an
/// unspoken thread that is in no list — and deleting the open one lands on the
/// most recently updated of the rest, which is the head of the list because the
/// switcher's order *is* recency. `null` when there is no rest: the caller opens
/// a fresh chat.
export function conversationAfterRemoval<T extends { id: string }>(
  list: readonly T[],
  removedId: string,
  activeId: string | null,
): string | null {
  if (activeId !== removedId) return activeId;
  return list.find((row) => row.id !== removedId)?.id ?? null;
}

/// The optimistic rename, mirroring `withBoardTitle`: the row the user just
/// typed into is the one thing on screen that must not flicker back to the old
/// name for a round trip.
export function withConversationTitle<T extends { id: string; title: string }>(
  list: readonly T[],
  id: string,
  title: string,
): T[] {
  return list.map((row) => (row.id === id ? { ...row, title } : row));
}
