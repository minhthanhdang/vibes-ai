import type { Content, GeneratePart } from "@/server/google/vertex";

/// What of the turn's *own work* goes back up with the next round.
///
/// `chat-history.ts`, one level down, and its doc comment already gives the
/// reason: "The whole history rides on every round of every turn." So does
/// everything the turn has done to itself. A round is a tool result added to the
/// conversation, and the round after it re-sends every result before it — a
/// twelve-round turn does not cost twelve times a one-round turn, it costs
/// closer to seventy-eight.
///
/// At three rounds that arithmetic never had to be looked at. At a hundred it
/// does: "crop everything on this board to fit" is one sentence, twelve crops
/// and thirteen rounds, and the thirteenth would otherwise carry twelve crop
/// answers in full.
///
/// So: the recent end of the turn's own work, inside a character budget, with a
/// line saying what is missing.
///
/// The type is imported rather than restated, unlike `agent-tools.ts`'s
/// `ToolDeclaration` — that module is loaded in the browser too and cannot reach
/// a `server-only` one. This is the routing loop's own arithmetic and runs
/// nowhere else, and a type import is erased.

/// A model turn carrying `functionCall`s and the user turn carrying the
/// `functionResponse`s that answered them. The pair is the unit because Vertex
/// rejects a response with no call above it: half a round is not a smaller
/// request, it is a broken one.
export type ToolRound = { call: Content; result: Content };

/// How many rounds of the turn's own work the model can still see.
///
/// `CROP_CALL_LIMIT` and `COMPOSE_BLOCK_LIMIT`, deliberately: a turn asked to
/// crop everything on a board may spend twelve rounds doing it, and a window
/// that forgot the first crop while the twelfth was being made is a window that
/// makes the model crop the earrings twice.
export const TOOL_ROUND_LIMIT = 12;

/// The window's whole size, in characters. Roughly 6,000 tokens against an
/// instruction that primes at around 3,800, so the turn's own work is at its
/// widest a little over half the request and usually far less. Characters rather
/// than tokens for `HISTORY_CHAR_BUDGET`'s reason — an approximation that never
/// under-counts, bought without a tokenizer call.
export const TOOL_CHAR_BUDGET = 24_000;

/// The longest a value may be and still be read as an id in the summary below.
/// Several tool answers carry whole sentences at keys like `nudgeOf`; a summary
/// that quoted one back would be the thing it exists to avoid.
const ID_LENGTH_LIMIT = 64;

const isCall = (part: GeneratePart) => Boolean(part.functionCall);
const isResult = (part: GeneratePart) => Boolean(part.functionResponse);
const isToolPart = (part: GeneratePart) => isCall(part) || isResult(part);

/// Where the turn's own work begins — everything before it is the conversation
/// as the loop was handed it, the history and the user's own message, and none
/// of that is this window's to drop. Found by walking back rather than by
/// counting forward, because the history's length is not something this module
/// is told.
///
/// The user's turn is the one that matters. What they attached lives in it, so a
/// window that could reach it would make round 40 blind to the picture the whole
/// turn is about.
function firstRoundAt(contents: readonly Content[]): number {
  let at = contents.length;
  while (at > 0 && contents[at - 1]!.parts.some(isToolPart)) at -= 1;
  return at;
}

function sizeOf({ call, result }: ToolRound): number {
  return JSON.stringify(call.parts).length + JSON.stringify(result.parts).length;
}

/// The ids one tool answer filed. Top level only and id-shaped keys only: this
/// is a reminder that a row exists, not a second copy of the answer. Exported
/// because it is also what a stored `result` degrades to past
/// `RESULT_STORE_LIMIT` (`conversation.ts`) — one rule for what survives of an
/// answer too big to carry, wherever it is carried.
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
///
/// Without it round 40 cannot see that round 5 already cropped the earrings, and
/// crops them again — and a crop is a real row in the user's project, a
/// thumbnail they have to look at and a reference they have to discard. The
/// calls and the ids they filed are the whole of it: enough to know the work is
/// done and where it went, and nothing like enough to be a second copy of the
/// answer this window is dropping.
export function roundsDroppedSaid(dropped: readonly ToolRound[]): string {
  const made: string[] = [];
  for (const { result } of dropped) {
    for (const { functionResponse } of result.parts) {
      /// Named ones only. The executor writes every one of these and names all
      /// of them, but the SDK's type allows a nameless response — and a line
      /// reading "undefined → ref-3" tells the model less than no line at all.
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

/// The tail of the turn's own work that fits, oldest rounds dropped first.
///
/// Four rules, in this order, and the order is the point:
///
/// 1. Whole rounds only. `contents` grows in pairs, and a `functionResponse`
///    whose `functionCall` was evicted above it is a request Vertex refuses —
///    so anything that is not a clean run of pairs is left exactly as it is
///    rather than guessed at.
/// 2. Never the conversation the loop was handed. Rule 1 already stops at the
///    user's turn, because a turn of theirs carries no call and no response;
///    this is that stated as an intention rather than as a coincidence.
/// 3. Count, then characters — `historyWindow`'s ordering and for its reason:
///    count first so the size pass never walks a hundred rounds, size second
///    because twelve short rounds and twelve rounds carrying a catalog each are
///    not the same amount of money.
/// 4. The newest round always survives. It is the answer to the call the model
///    made a moment ago, and a request that dropped it asks the model to reason
///    about a tool it can no longer see the result of — which is the one shape
///    that reliably produces the same call again.
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
