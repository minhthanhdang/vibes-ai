import { roundsIn, type ToolRound } from "@/lib/agent/shared/tool-rounds";
import type { Content, GeneratePart } from "@/server/google/vertex";

export const PICTURE_WINDOW = 5;

export const isPicture = (part: GeneratePart): boolean => Boolean(part.fileData || part.inlineData);

const keyOf = (part: GeneratePart): string | undefined => {
  if (part.fileData?.fileUri) return `uri:${part.fileData.fileUri}`;
  if (part.inlineData?.data) return `inline:${part.inlineData.data}`;
  return undefined;
};

const ARGS_LENGTH_LIMIT = 200;

function ownerOf(parts: readonly GeneratePart[], at: number): string | undefined {
  for (let ahead = at + 1; ahead < parts.length; ahead += 1) {
    const name = parts[ahead]!.functionResponse?.name;
    if (name) return name;
  }
  for (let back = parts.length - 1; back >= 0; back -= 1) {
    const name = parts[back]!.functionResponse?.name;
    if (name) return name;
  }
  return undefined;
}

function argsOf(call: Content | undefined, name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const part of call?.parts ?? []) {
    if (part.functionCall?.name !== name) continue;
    const args = JSON.stringify(part.functionCall.args ?? {});
    return args.length <= ARGS_LENGTH_LIMIT ? args : undefined;
  }
  return undefined;
}

export function pictureDroppedSaid(name: string | undefined, args: string | undefined): string {
  const which = name ? `${name}${args ? ` ${args}` : ""}` : "an earlier tool call";
  const again = name
    ? `Call ${name}${args ? " with the same arguments" : " again"} to see it as it now stands.`
    : "Make that call again to see it as it now stands.";
  return `[The picture ${which} returned is no longer shown — pictures are dropped after ${PICTURE_WINDOW} rounds so this turn's request does not grow without bound. ${again}]`;
}

export function pictureRepeatedSaid(name: string | undefined, args: string | undefined): string {
  const which = name ? `${name}${args ? ` ${args}` : ""}` : "an earlier tool call";
  return `[The picture ${which} returned is the same picture as one already in this request, so it is shown once rather than once per call. Read it where it is shown — calling again would return the same picture.]`;
}

function agedOut(aged: readonly ToolRound[], kept: Content[]): number {
  let dropped = 0;
  for (const { call, result, at } of aged) {
    if (!result.parts.some(isPicture)) continue;
    const parts = result.parts.map((part, index) => {
      if (!isPicture(part)) return part;
      dropped += 1;
      const name = ownerOf(result.parts, index);
      return { text: pictureDroppedSaid(name, argsOf(call, name)) };
    });
    kept[at] = { ...result, parts };
  }
  return dropped;
}

function seededFrom(contents: readonly Content[], head: number): Set<string> {
  const seen = new Set<string>();
  for (let at = 0; at < head; at += 1) {
    for (const part of contents[at]!.parts) {
      const key = keyOf(part);
      if (key) seen.add(key);
    }
  }
  return seen;
}

function deduped(live: readonly ToolRound[], kept: Content[], seen: Set<string>): number {
  let dropped = 0;
  for (let index = live.length - 1; index >= 0; index -= 1) {
    const { call, result, at } = live[index]!;
    if (!result.parts.some(isPicture)) continue;

    let repeated = false;
    const parts = result.parts.map((part, position) => {
      const key = keyOf(part);
      if (!key) return part;
      if (!seen.has(key)) {
        seen.add(key);
        return part;
      }
      repeated = true;
      dropped += 1;
      const name = ownerOf(result.parts, position);
      return { text: pictureRepeatedSaid(name, argsOf(call, name)) };
    });

    if (repeated) kept[at] = { ...result, parts };
  }
  return dropped;
}

export function pictureWindow(contents: readonly Content[]): {
  contents: Content[];
  dropped: number;
} {
  const unchanged = { contents: [...contents], dropped: 0 };

  const parsed = roundsIn(contents);
  if (!parsed) return unchanged;
  const { head, rounds } = parsed;

  const aged = rounds.slice(0, Math.max(0, rounds.length - PICTURE_WINDOW));
  const kept = [...contents];

  const agedDrops = agedOut(aged, kept);
  const repeatDrops = deduped(rounds.slice(aged.length), kept, seededFrom(contents, head));
  const dropped = agedDrops + repeatDrops;

  return dropped ? { contents: kept, dropped } : unchanged;
}
