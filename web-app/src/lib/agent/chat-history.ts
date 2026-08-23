import { clipped } from "@/lib/util/text";

/// What of the conversation goes back up with the next message.

/// A message as it crosses the wire — what was said and who said it, and no
/// pictures.
export type ChatTurn = { role: "user" | "model"; text: string };

/// How many messages back the model can see.
export const HISTORY_TURN_LIMIT = 16;

/// The window's whole size, in characters.
export const HISTORY_CHAR_BUDGET = 6000;

/// The most one message may contribute, cut rather than dropped.
export const HISTORY_TEXT_LIMIT = 1000;

/// The tail of the conversation that fits, oldest dropped first: empty messages
/// out, then the recent end by count and then by size, then forward past any
/// leading model turn. Three rules in that order, and the order is the point.
export function historyWindow(messages: readonly ChatTurn[]): ChatTurn[] {
  const said = messages
    .map(({ role, text }) => ({ role, text: clipped(text.trim(), HISTORY_TEXT_LIMIT) }))
    .filter(({ text }) => text.length > 0);

  const recent = said.slice(-HISTORY_TURN_LIMIT);

  let spent = recent.reduce((total, { text }) => total + text.length, 0);
  let start = 0;
  while (start < recent.length && spent > HISTORY_CHAR_BUDGET) {
    spent -= recent[start]!.text.length;
    start += 1;
  }

  while (start < recent.length && recent[start]!.role === "model") start += 1;

  return recent.slice(start);
}
