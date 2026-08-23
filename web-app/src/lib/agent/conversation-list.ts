import { z } from "zod";
import { spoken, storedPartSchema } from "@/lib/agent/conversation";

/// The rules for a project's list of conversations, with no React and no tRPC in
/// them. Conversation.md §VII; orchestrator-tool-reference §VII.

/// The cut, for a switcher row 280px wide. Conversation.md §VII.1.
export const CONVERSATION_TITLE_LIMIT = 60;

/// The switcher lists the 50 most recently updated threads — a ceiling on a
/// *read* and not on the project (§VII.7). Conversation.md §VII.1.
export const CONVERSATIONS_PER_PROJECT = 50;

/// What a thread nobody has spoken in reads as. Never stored (§VII.3).
/// Conversation.md §VII.2.
export const NEW_CHAT_TITLE = "New chat";

/// A thread's name, out of the first line of its own first user message
/// (§VII.4). Empty in, empty out. Conversation.md §VII.2.
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
/// The parse is here rather than in the router — Conversation.md §VII.2.
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
/// `null` means "nothing to save", and on this door it has a second meaning
/// `normalizedBoardTitle`'s does not. Conversation.md §VII.2.
export function normalizedConversationTitle(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.slice(0, CONVERSATION_TITLE_LIMIT).trim();
}

/// Which thread the column is showing, given what the user last chose. `session`
/// carries the ids this browser minted and may not have spoken in yet (§VII.3);
/// `fresh` is minted by the caller, because a pure function cannot mint.
/// Conversation.md §VII.3.
export function openConversationId(
  list: readonly { id: string }[] | undefined,
  chosen: string | null,
  session: ReadonlySet<string>,
  fresh: string,
): string {
  if (chosen && (list?.some((row) => row.id === chosen) || session.has(chosen))) return chosen;
  return list?.[0]?.id ?? fresh;
}

/// Which thread is open once `removedId` is gone. An `activeId` the list has
/// never heard of is kept, which is where this parts company with
/// `boardAfterRemoval`. Conversation.md §VII.4.
export function conversationAfterRemoval<T extends { id: string }>(
  list: readonly T[],
  removedId: string,
  activeId: string | null,
): string | null {
  if (activeId !== removedId) return activeId;
  return list.find((row) => row.id !== removedId)?.id ?? null;
}

/// The optimistic rename, mirroring `withBoardTitle`. Conversation.md §VII.4.
export function withConversationTitle<T extends { id: string; title: string }>(
  list: readonly T[],
  id: string,
  title: string,
): T[] {
  return list.map((row) => (row.id === id ? { ...row, title } : row));
}
