import { z } from "zod";
import { spoken, storedPartSchema } from "@/lib/agent/conversation";
import { normalizedTitle, withTitle } from "@/lib/util/named-list";
import { clampWords, collapsed } from "@/lib/util/text";

/// The rules for a project's list of conversations, with no React and no tRPC
/// in them.

/// The cut, for a switcher row 280px wide.
export const CONVERSATION_TITLE_LIMIT = 60;

/// The switcher lists the 50 most recently updated threads — a ceiling on a
/// *read* and not on the project.
export const CONVERSATIONS_PER_PROJECT = 50;

/// What a thread nobody has spoken in reads as. Never stored.
export const NEW_CHAT_TITLE = "New chat";

/// A thread's name, out of the first line of its own first user message. Empty
/// in, empty out.
export function derivedConversationTitle(said: string): string {
  const line = said.split("\n").find((candidate) => candidate.trim()) ?? "";
  const one = collapsed(line);
  /// The guard stays here rather than moving into `clampWords`: a line that is
  /// exactly the limit long is not cut, and cutting for the ellipsis one
  /// character earlier is what makes the row fit rather than overflow by one.
  if (one.length <= CONVERSATION_TITLE_LIMIT) return one;
  return `${clampWords(one, CONVERSATION_TITLE_LIMIT - 1).text}…`;
}

const storedParts = z.array(storedPartSchema);

/// What the switcher draws for one thread: the written title if there is one,
/// else the name derived from its first user message, else `NEW_CHAT_TITLE`.
/// The parse is here rather than in the router.
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
/// `normalizedBoardTitle`'s does not.
export function normalizedConversationTitle(raw: string): string | null {
  return normalizedTitle(raw, CONVERSATION_TITLE_LIMIT);
}

/// Which thread the column is showing, given what the user last chose.
/// `session` carries the ids this browser minted and may not have spoken in
/// yet; `fresh` is minted by the caller, because a pure function cannot mint.
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
/// `boardAfterRemoval`.
export function conversationAfterRemoval<T extends { id: string }>(
  list: readonly T[],
  removedId: string,
  activeId: string | null,
): string | null {
  if (activeId !== removedId) return activeId;
  return list.find((row) => row.id !== removedId)?.id ?? null;
}

/// The optimistic rename, mirroring `withBoardTitle`.
export function withConversationTitle<T extends { id: string; title: string }>(
  list: readonly T[],
  id: string,
  title: string,
): T[] {
  return withTitle(list, id, title);
}
