import { roundsIn, type ToolRound } from "@/lib/agent/shared/tool-rounds";
import type { Content } from "@/server/google/vertex";

/// What of the turn's *own work* goes back up with the next round.
///
/// The type is imported rather than restated: a type import is erased, so
/// naming a `server-only` module here costs nothing at runtime.

/// How many rounds of the turn's own work the model can still see.
export const TOOL_ROUND_LIMIT = 12;

/// The window's whole size, in characters.
export const TOOL_CHAR_BUDGET = 24_000;

/// The longest a value may be and still be read as an id in the summary below.
const ID_LENGTH_LIMIT = 64;

function sizeOf({ call, result }: ToolRound): number {
  return JSON.stringify(call.parts).length + JSON.stringify(result.parts).length;
}

/// The ids one tool answer filed — top level only and id-shaped keys only.
/// Exported because it is also what a stored `result` degrades to past
/// `RESULT_STORE_LIMIT` (`conversation.ts`).
export function idsIn(response: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const [key, value] of Object.entries(response)) {
    if (typeof value === "string" && /^id$|Id$/.test(key) && value.length <= ID_LENGTH_LIMIT) {
      found.push(value);
    } else if (Array.isArray(value) && /Ids$/.test(key)) {
      for (const each of value) {
        if (typeof each === "string" && each.length <= ID_LENGTH_LIMIT) found.push(each);
      }
    }
  }
  return [...new Set(found)];
}

/// What stands where the dropped rounds were.
export function roundsDroppedSaid(dropped: readonly { result: Content }[]): string {
  const made: string[] = [];
  for (const { result } of dropped) {
    for (const { functionResponse } of result.parts) {
      /// Named ones only — the SDK's type allows a nameless response.
      if (!functionResponse?.name) continue;
      const ids = idsIn(functionResponse.response ?? {});
      made.push(
        ids.length ? `${functionResponse.name} → ${ids.join(" ")}` : functionResponse.name,
      );
    }
  }

  const count = `${dropped.length} earlier ${dropped.length === 1 ? "round" : "rounds"}`;
  return `[${count} of this same turn ${dropped.length === 1 ? "is" : "are"} no longer shown, so this request does not grow without bound. ${made.length ? `They were made and what they filed is real: ${made.join("; ")}. Do not make them again.` : "They were made; do not make them again."}]`;
}

/// The tail of the turn's own work that fits, oldest rounds dropped first. Four
/// rules in this order, and the order is the point: whole rounds only, never
/// the conversation the loop was handed, count then characters, and the newest
/// round always survives.
///
/// Rule 1 is the one that breaks a request rather than costing money: a
/// `functionResponse` whose `functionCall` was evicted above it is a request
/// Vertex refuses, so anything that is not a clean run of pairs is left exactly
/// as it is rather than guessed at.
export function toolWindow(contents: readonly Content[]): { contents: Content[]; dropped: number } {
  const unchanged = { contents: [...contents], dropped: 0 };

  const parsed = roundsIn(contents);
  if (!parsed) return unchanged;
  const { head, rounds } = parsed;
  /// Nothing of the user's above the tool traffic: there is no turn to hang the
  /// summary on, and evicting into a conversation that begins with a
  /// `functionResponse` is rule 1 broken from the other end. `roundsIn` leaves
  /// this guard to its callers because the picture window does not need it.
  if (head === 0) return unchanged;

  const recent = rounds.slice(-TOOL_ROUND_LIMIT);
  let spent = recent.reduce((total, round) => total + sizeOf(round), 0);
  let start = 0;
  while (start < recent.length - 1 && spent > TOOL_CHAR_BUDGET) {
    spent -= sizeOf(recent[start]!);
    start += 1;
  }

  const dropped = [...rounds.slice(0, rounds.length - recent.length), ...recent.slice(0, start)];
  if (!dropped.length) return unchanged;

  const said = contents[head - 1]!;
  return {
    /// Appended to the user's turn rather than sent as a turn of its own. The
    /// evicted rounds stood exactly here, so this is where the gap is — and a
    /// new turn would be a second user turn in a row, which is a shape this
    /// loop has never produced and Vertex's function calling has never been
    /// asked to read.
    contents: [
      ...contents.slice(0, head - 1),
      { ...said, parts: [...said.parts, { text: roundsDroppedSaid(dropped) }] },
      ...recent.slice(start).flatMap(({ call, result }) => [call, result]),
    ],
    dropped: dropped.length,
  };
}
