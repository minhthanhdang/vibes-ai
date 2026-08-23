import type { Content, GeneratePart } from "@/server/google/vertex";

/// What of the turn's *own work* goes back up with the next round.
/// Windows.md §II.
///
/// The type is imported rather than restated: a type import is erased, so
/// naming a `server-only` module here costs nothing at runtime.

/// A model turn carrying `functionCall`s and the user turn carrying the
/// `functionResponse`s that answered them. The pair is the unit because Vertex
/// rejects a response with no call above it: half a round is not a smaller
/// request, it is a broken one.
export type ToolRound = { call: Content; result: Content };

/// How many rounds of the turn's own work the model can still see.
/// Windows.md §II.1.
export const TOOL_ROUND_LIMIT = 12;

/// The window's whole size, in characters. Windows.md §II.1.
export const TOOL_CHAR_BUDGET = 24_000;

/// The longest a value may be and still be read as an id in the summary below.
/// Windows.md §II.1.
const ID_LENGTH_LIMIT = 64;

const isCall = (part: GeneratePart) => Boolean(part.functionCall);
const isResult = (part: GeneratePart) => Boolean(part.functionResponse);
const isToolPart = (part: GeneratePart) => isCall(part) || isResult(part);

/// Where the turn's own work begins — everything before it is the conversation
/// as the loop was handed it, and none of that is this window's to drop. Found
/// by walking back rather than by counting forward, because the history's length
/// is not something this module is told. Windows.md §II.2.
function firstRoundAt(contents: readonly Content[]): number {
  let at = contents.length;
  while (at > 0 && contents[at - 1]!.parts.some(isToolPart)) at -= 1;
  return at;
}

function sizeOf({ call, result }: ToolRound): number {
  return JSON.stringify(call.parts).length + JSON.stringify(result.parts).length;
}

/// The ids one tool answer filed — top level only and id-shaped keys only.
/// Exported because it is also what a stored `result` degrades to past
/// `RESULT_STORE_LIMIT` (`conversation.ts`). Windows.md §II.4.
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

/// What stands where the dropped rounds were. Windows.md §II.3.
export function roundsDroppedSaid(dropped: readonly ToolRound[]): string {
  const made: string[] = [];
  for (const { result } of dropped) {
    for (const { functionResponse } of result.parts) {
      /// Named ones only — the SDK's type allows a nameless response.
      /// Windows.md §II.3.
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
/// rules in this order, and the order is the point: whole rounds only, never the
/// conversation the loop was handed, count then characters, and the newest round
/// always survives. Windows.md §II.2.
///
/// Rule 1 is the one that breaks a request rather than costing money: a
/// `functionResponse` whose `functionCall` was evicted above it is a request
/// Vertex refuses, so anything that is not a clean run of pairs is left exactly
/// as it is rather than guessed at.
export function toolWindow(contents: readonly Content[]): { contents: Content[]; dropped: number } {
  const unchanged = { contents: [...contents], dropped: 0 };

  const head = firstRoundAt(contents);
  /// Nothing of the user's above the tool traffic: there is no turn to hang the
  /// summary on, and evicting into a conversation that begins with a
  /// `functionResponse` is rule 1 broken from the other end.
  if (head === 0) return unchanged;
  if ((contents.length - head) % 2 !== 0) return unchanged;

  const rounds: ToolRound[] = [];
  for (let at = head; at < contents.length; at += 2) {
    const call = contents[at]!;
    const result = contents[at + 1]!;
    if (!call.parts.some(isCall) || !result.parts.some(isResult)) return unchanged;
    rounds.push({ call, result });
  }

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
