import { clipped } from "@/lib/util/text";

export type ChatTurn = { role: "user" | "model"; text: string };

export const HISTORY_TURN_LIMIT = 16;

export const HISTORY_CHAR_BUDGET = 6000;

export const HISTORY_TEXT_LIMIT = 1000;

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
