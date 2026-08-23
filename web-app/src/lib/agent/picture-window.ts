import type { Content, GeneratePart } from "@/server/google/vertex";

/// What of the pictures agent 8's own tools returned is still in front of it.
///
/// `tool-window.ts` beside this one drops whole rounds against a character
/// budget, and for text that is the whole of the cost. Pictures are not text: a
/// `fileData` part is a uri on the wire — a few dozen characters, invisible to
/// that budget — and hundreds or thousands of tokens once Google has fetched
/// and tiled it. A window measured in characters therefore cannot see the one
/// part that dominates agent 8's bill, which is why there are two windows and
/// not one.
///
/// The loop this exists for is the reason (compositor-v2.md §III.1): look,
/// make, look again. Three pictures at the least, taken early, and every one of
/// them re-sent on every round after it because the transcript *is* the
/// context. A twelve-round turn that looked four times pays for those four
/// pictures around forty times between them.
///
/// So a picture does not stay. It rides on the round its tool returned it and
/// on the next one, then the part is dropped and a line stands where it stood.

/// How many rounds an image part survives (§III.1 and §VII's table).
///
/// Two was the first answer, and its argument was the shortest honest use of a
/// picture: look, place what was seen, reason about what was placed. Five is
/// the second, and its argument is the longest one — a design that reads a
/// page, cuts a picture, puts it down, looks again and then compares the two
/// looks is holding the first picture across four rounds of its own work, and
/// at two it was doing the comparison blind.
///
/// What made five affordable is `dedupe` below rather than a change of mind
/// about the cost. Most of what the old window was paying for was the same
/// picture arriving twice — a page read, worked on, then read again returns one
/// uri both times — and a window that counts rounds cannot see that, while a
/// window that counts *pictures* pays for each one once however many rounds it
/// spans.
export const PICTURE_WINDOW = 5;

/// A part that costs image tokens rather than text tokens.
///
/// `fileData` is how every picture in this system reaches a model (§III) — a
/// uri, never bytes. `inlineData` is here anyway: it is the shape that would
/// cost the most to leave in a transcript, and a window that only knew about
/// the cheap spelling of a picture would be silently wrong about the expensive
/// one.
export const isPicture = (part: GeneratePart): boolean => Boolean(part.fileData || part.inlineData);

/// What makes two picture parts the same picture.
///
/// The uri, which in this system is an object name in the bucket and therefore
/// identity: the same page at the same revision is the same object, and a page
/// that changed is a different one — which is exactly the distinction dedupe
/// has to make, since re-sending a stale render would be worse than re-sending
/// a picture. `inlineData` is keyed by its own bytes for the same reason it is
/// in `isPicture` at all: it is the spelling that costs the most to duplicate.
const keyOf = (part: GeneratePart): string | undefined => {
  if (part.fileData?.fileUri) return `uri:${part.fileData.fileUri}`;
  if (part.inlineData?.data) return `inline:${part.inlineData.data}`;
  return undefined;
};

const isCall = (part: GeneratePart) => Boolean(part.functionCall);
const isResult = (part: GeneratePart) => Boolean(part.functionResponse);

/// The longest an argument object may be and still be quoted back in the line
/// below. `tool-window.ts`'s `ID_LENGTH_LIMIT` for the same reason: the note is
/// a pointer to a call the model can make again, and a note that carried a
/// whole answer's worth of arguments would be the cost it exists to avoid.
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

/// The arguments that call was made with, so the line names a call the model
/// can repeat rather than a tool it has to guess the arguments of again — and
/// `get_page` on the wrong page is a whole round and a whole picture spent
/// finding that out.
function argsOf(call: Content | undefined, name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const part of call?.parts ?? []) {
    if (part.functionCall?.name !== name) continue;
    const args = JSON.stringify(part.functionCall.args ?? {});
    return args.length <= ARGS_LENGTH_LIMIT ? args : undefined;
  }
  return undefined;
}

/// What stands where the picture was.
///
/// This line matters as much as the drop. A picture that silently stops being
/// there is a model still answering about it — describing a page it can no
/// longer see, from memory of a description it never wrote down — and from the
/// outside that reads as ordinary bad taste rather than as a part this code
/// removed. So the note says three things: that there was a picture, which
/// call returned it, and that the same call brings it back.
export function pictureDroppedSaid(name: string | undefined, args: string | undefined): string {
  const which = name ? `${name}${args ? ` ${args}` : ""}` : "an earlier tool call";
  const again = name
    ? `Call ${name}${args ? " with the same arguments" : " again"} to see it as it now stands.`
    : "Make that call again to see it as it now stands.";
  return `[The picture ${which} returned is no longer shown — pictures are dropped after ${PICTURE_WINDOW} rounds so this turn's request does not grow without bound. ${again}]`;
}

/// What stands where a second copy of a picture was.
///
/// A different sentence from `pictureDroppedSaid` and deliberately so: nothing
/// has been aged out here and calling the tool again would return the same
/// bytes it is already looking at, so a note telling it to call again would buy
/// a round and change nothing. What it needs told is that the picture is in the
/// request, once, somewhere else.
export function pictureRepeatedSaid(name: string | undefined, args: string | undefined): string {
  const which = name ? `${name}${args ? ` ${args}` : ""}` : "an earlier tool call";
  return `[The picture ${which} returned is the same picture as one already in this request, so it is shown once rather than once per call. Read it where it is shown — calling again would return the same picture.]`;
}

/// Where the turn's own rounds begin — `tool-window.ts`'s `firstRoundAt`, and
/// the same intention: everything above is what the loop was handed, and none
/// of it is this window's to touch.
function firstRoundAt(contents: readonly Content[]): number {
  let at = contents.length;
  while (at > 0 && contents[at - 1]!.parts.some((part) => isCall(part) || isResult(part))) at -= 1;
  return at;
}

/// The transcript with every picture older than the window replaced by the line
/// that says so.
///
/// Three rules:
///
/// 1. The note stands exactly where the picture stood — same content, same
///    position, one part swapped for another. Nothing is re-roled and no turn
///    is added, so a request this has been through has the same shape as one it
///    has not.
/// 2. Rounds are read as pairs, and anything that is not a clean run of pairs
///    is returned untouched. `toolWindow`'s rule 1, for a weaker reason — this
///    window cannot break a request the way an orphaned `functionResponse`
///    does — but a transcript this module cannot read is one whose picture
///    ages it also cannot know.
/// 3. The last `PICTURE_WINDOW` rounds keep their pictures. Everything before
///    them loses them, including the round the model is answering about right
///    now if it looked three rounds ago.
///
/// Applied after `toolWindow` rather than before: a round dropped whole is
/// already accounted for by `roundsDroppedSaid`, and a picture note left behind
/// for a round that is no longer in the request would name a call the model
/// cannot see the answer to.
export function pictureWindow(contents: readonly Content[]): {
  contents: Content[];
  dropped: number;
} {
  const unchanged = { contents: [...contents], dropped: 0 };

  const head = firstRoundAt(contents);
  if (head === contents.length) return unchanged;
  if ((contents.length - head) % 2 !== 0) return unchanged;

  const rounds: { call: Content; result: Content; at: number }[] = [];
  for (let at = head; at < contents.length; at += 2) {
    const call = contents[at]!;
    const result = contents[at + 1]!;
    if (!call.parts.some(isCall) || !result.parts.some(isResult)) return unchanged;
    rounds.push({ call, result, at: at + 1 });
  }

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

  /// The second pass, over what the first left standing.
  ///
  /// Newest first, so the copy that survives is the one nearest the answer the
  /// model is about to give — a picture is read where it is, and the further up
  /// the transcript the kept copy sits, the more of the model's attention the
  /// note has to buy back.
  ///
  /// Seeded with whatever stands above the first round, which is priming and
  /// not this window's to touch (`firstRoundAt`). That copy is re-sent on every
  /// round whatever happens here, so when a tool returns the same uri the
  /// cheapest request keeps the untouchable one and notes the other — the one
  /// case where the copy that survives is not the newest.
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
