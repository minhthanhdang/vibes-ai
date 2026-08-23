import type { Content, GeneratePart } from "@/server/google/vertex";

/// A turn's own tool traffic, read as rounds. One reader for both windows.
///
/// `tool-window.ts` and `picture-window.ts` each walked the tail of `contents`
/// themselves, and the walk is the part that must not diverge: the parity check
/// and the pair test are what stop a `functionResponse` reaching Vertex with no
/// `functionCall` above it, which is a request it refuses. Two copies of a bail
/// condition is one of them being wrong on a paid turn.
///
/// The type is imported rather than restated: a type import is erased, so naming
/// a `server-only` module here costs nothing at runtime — the property both
/// windows already depend on.

/// A model turn carrying `functionCall`s and the user turn carrying the
/// `functionResponse`s that answered them, with the index of the result content.
/// The pair is the unit because Vertex rejects a response with no call above it:
/// half a round is not a smaller request, it is a broken one.
export type ToolRound = { call: Content; result: Content; at: number };

const isCall = (part: GeneratePart) => Boolean(part.functionCall);
const isResult = (part: GeneratePart) => Boolean(part.functionResponse);
const isToolPart = (part: GeneratePart) => isCall(part) || isResult(part);

/// Where the turn's own work begins — everything before it is the conversation
/// as the loop was handed it, and none of that is a window's to touch. Found by
/// walking back rather than by counting forward, because the history's length
/// is not something either window is told.
function firstRoundAt(contents: readonly Content[]): number {
  let at = contents.length;
  while (at > 0 && contents[at - 1]!.parts.some(isToolPart)) at -= 1;
  return at;
}

/// The turn's own rounds, or null when the tail is not a clean run of pairs —
/// which both callers answer by leaving the transcript exactly as it is rather
/// than guessing at it.
///
/// `head` comes back out rather than being judged here: the two windows guard it
/// differently, and for good reason. `toolWindow` bails on `head === 0` because
/// it dereferences `contents[head - 1]` to hang its summary on; `pictureWindow`
/// has nothing to hang and needs no guard at all.
export function roundsIn(
  contents: readonly Content[],
): { head: number; rounds: ToolRound[] } | null {
  const head = firstRoundAt(contents);
  if ((contents.length - head) % 2 !== 0) return null;

  const rounds: ToolRound[] = [];
  for (let at = head; at < contents.length; at += 2) {
    const call = contents[at]!;
    const result = contents[at + 1]!;
    if (!call.parts.some(isCall) || !result.parts.some(isResult)) return null;
    rounds.push({ call, result, at: at + 1 });
  }
  return { head, rounds };
}
