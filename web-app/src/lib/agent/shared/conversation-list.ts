import { z } from "zod";
import { spoken, storedPartSchema } from "@/lib/agent/shared/conversation";
import { normalizedTitle, withTitle } from "@/lib/util/named-list";
import { clampWords, collapsed } from "@/lib/util/text";

export const CONVERSATION_TITLE_LIMIT = 60;

export const CONVERSATIONS_PER_PROJECT = 50;

export const NEW_CHAT_TITLE = "New chat";

export function derivedConversationTitle(said: string): string {
  const line = said.split("\n").find((candidate) => candidate.trim()) ?? "";
  const one = collapsed(line);
  if (one.length <= CONVERSATION_TITLE_LIMIT) return one;
  return `${clampWords(one, CONVERSATION_TITLE_LIMIT - 1).text}…`;
}

const storedParts = z.array(storedPartSchema);

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

export function normalizedConversationTitle(raw: string): string | null {
  return normalizedTitle(raw, CONVERSATION_TITLE_LIMIT);
}

export function openConversationId(
  list: readonly { id: string }[] | undefined,
  chosen: string | null,
  session: ReadonlySet<string>,
  fresh: string,
): string {
  if (chosen && (list?.some((row) => row.id === chosen) || session.has(chosen))) return chosen;
  return list?.[0]?.id ?? fresh;
}

export function conversationAfterRemoval<T extends { id: string }>(
  list: readonly T[],
  removedId: string,
  activeId: string | null,
): string | null {
  if (activeId !== removedId) return activeId;
  return list.find((row) => row.id !== removedId)?.id ?? null;
}

export function withConversationTitle<T extends { id: string; title: string }>(
  list: readonly T[],
  id: string,
  title: string,
): T[] {
  return withTitle(list, id, title);
}
