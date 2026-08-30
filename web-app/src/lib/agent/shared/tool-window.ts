import { roundsIn, type ToolRound } from "@/lib/agent/shared/tool-rounds";
import type { Content } from "@/server/google/vertex";

export const TOOL_ROUND_LIMIT = 12;

export const TOOL_CHAR_BUDGET = 24_000;

const ID_LENGTH_LIMIT = 64;

function sizeOf({ call, result }: ToolRound): number {
  return JSON.stringify(call.parts).length + JSON.stringify(result.parts).length;
}

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

export function roundsDroppedSaid(dropped: readonly { result: Content }[]): string {
  const made: string[] = [];
  for (const { result } of dropped) {
    for (const { functionResponse } of result.parts) {
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

export function toolWindow(contents: readonly Content[]): { contents: Content[]; dropped: number } {
  const unchanged = { contents: [...contents], dropped: 0 };

  const parsed = roundsIn(contents);
  if (!parsed) return unchanged;
  const { head, rounds } = parsed;
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
    contents: [
      ...contents.slice(0, head - 1),
      { ...said, parts: [...said.parts, { text: roundsDroppedSaid(dropped) }] },
      ...recent.slice(start).flatMap(({ call, result }) => [call, result]),
    ],
    dropped: dropped.length,
  };
}
