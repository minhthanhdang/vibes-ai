import { roundsIn } from "@/lib/agent/tool-rounds";
import type { Content, GeneratePart } from "@/server/google/vertex";

/// What of the pictures agent 8's own tools returned is still in front of it.
/// Windows.md §I and §III; the loop it exists for is compositor-v2.md §III.1.

/// How many rounds an image part survives (§III.1 and §VII's table). It was 2,
/// and the dedupe pass below is what made 5 affordable — Windows.md §III.1.
export const PICTURE_WINDOW = 5;

/// A part that costs image tokens rather than text tokens. `inlineData` is here
/// even though every picture in this system reaches a model as a `fileData` uri
/// (§III), because it is the spelling that costs the most to leave in a
/// transcript. Windows.md §III.2.
export const isPicture = (part: GeneratePart): boolean => Boolean(part.fileData || part.inlineData);

/// What makes two picture parts the same picture: the uri, which in this system
/// is an object name in the bucket and therefore identity — the same page at the
/// same revision is the same object, and a page that changed is a different one.
/// Windows.md §III.2.
const keyOf = (part: GeneratePart): string | undefined => {
  if (part.fileData?.fileUri) return `uri:${part.fileData.fileUri}`;
  if (part.inlineData?.data) return `inline:${part.inlineData.data}`;
  return undefined;
};

/// The longest an argument object may be and still be quoted back in the line
/// below. Windows.md §III.2.
const ARGS_LENGTH_LIMIT = 200;

/// Which call returned this picture, by position.
///
/// The loop writes a round's answers in call order and puts each picture
/// directly *before* the `functionResponse` it belongs to, so the owner of an
/// image part is the nearest `functionResponse` below it. Below rather than
/// above because Vertex will not read a response turn whose trailing part is
/// not itself a response — the reason is written out where the loop builds the
/// round. A picture with nothing below it — a shape this loop does not build,
/// but one the type allows — falls to the last response in the round, because
/// naming the wrong call of two is still a call that returns a picture, and
/// naming none leaves the model with a gap and no way to close it.
///
/// Windows.md §III.3 has why the note names a call at all.
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

/// The arguments that call was made with. Windows.md §III.3.
function argsOf(call: Content | undefined, name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const part of call?.parts ?? []) {
    if (part.functionCall?.name !== name) continue;
    const args = JSON.stringify(part.functionCall.args ?? {});
    return args.length <= ARGS_LENGTH_LIMIT ? args : undefined;
  }
  return undefined;
}

/// What stands where the picture was: that there was a picture, which call
/// returned it, and that the same call brings it back. Windows.md §III.3.
export function pictureDroppedSaid(name: string | undefined, args: string | undefined): string {
  const which = name ? `${name}${args ? ` ${args}` : ""}` : "an earlier tool call";
  const again = name
    ? `Call ${name}${args ? " with the same arguments" : " again"} to see it as it now stands.`
    : "Make that call again to see it as it now stands.";
  return `[The picture ${which} returned is no longer shown — pictures are dropped after ${PICTURE_WINDOW} rounds so this turn's request does not grow without bound. ${again}]`;
}

/// What stands where a second copy of a picture was — a different sentence from
/// `pictureDroppedSaid`, because nothing has been aged out and calling again
/// would return the same bytes. Windows.md §III.3.
export function pictureRepeatedSaid(name: string | undefined, args: string | undefined): string {
  const which = name ? `${name}${args ? ` ${args}` : ""}` : "an earlier tool call";
  return `[The picture ${which} returned is the same picture as one already in this request, so it is shown once rather than once per call. Read it where it is shown — calling again would return the same picture.]`;
}

/// The transcript with every picture older than the window replaced by the line
/// that says so. Three rules — the note stands exactly where the picture stood,
/// rounds are read as pairs and anything that is not a clean run of them is
/// returned untouched, and the last `PICTURE_WINDOW` rounds keep their pictures.
/// Windows.md §III.4.
///
/// Applied after `toolWindow` and not before, for the reason in Windows.md §IV.
export function pictureWindow(contents: readonly Content[]): {
  contents: Content[];
  dropped: number;
} {
  const unchanged = { contents: [...contents], dropped: 0 };

  const parsed = roundsIn(contents);
  if (!parsed) return unchanged;
  const { head, rounds } = parsed;

  const aged = rounds.slice(0, Math.max(0, rounds.length - PICTURE_WINDOW));
  let dropped = 0;
  const kept = [...contents];

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

  /// The second pass, over what the first left standing: newest first, seeded
  /// with whatever stands above the first round, which is priming and not this
  /// window's to touch (`firstRoundAt`). Windows.md §III.4.
  const seen = new Set<string>();
  for (let at = 0; at < head; at += 1) {
    for (const part of contents[at]!.parts) {
      const key = keyOf(part);
      if (key) seen.add(key);
    }
  }

  const live = rounds.slice(aged.length);
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

  return dropped ? { contents: kept, dropped } : unchanged;
}
