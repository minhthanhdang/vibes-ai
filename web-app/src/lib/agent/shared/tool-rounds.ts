import type { Content, GeneratePart } from "@/server/google/vertex";

export type ToolRound = { call: Content; result: Content; at: number };

const isCall = (part: GeneratePart) => Boolean(part.functionCall);
const isResult = (part: GeneratePart) => Boolean(part.functionResponse);
const isToolPart = (part: GeneratePart) => isCall(part) || isResult(part);

function firstRoundAt(contents: readonly Content[]): number {
  let at = contents.length;
  while (at > 0 && contents[at - 1]!.parts.some(isToolPart)) at -= 1;
  return at;
}

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
