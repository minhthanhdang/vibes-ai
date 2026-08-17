import { attachmentOf, type BoardAttachment, type ReferenceAttachment } from "@/lib/agent/agent-tools";
import { looseShapeOf } from "@/lib/references/reference-version";

/// The cut the assistant offered, once the user has taken it.
///
/// `crop_reference` ends at an offer (§V) — the pixels are cut in the browser,
/// so the tool cannot file a row and the turn it was asked in ends with nothing
/// in the project. What happens next happens in the properties panel, out of the
/// conversation's sight, and until now that is where the workflow stopped: the
/// cut existed, the chat did not know it did, and the loop the compose answer
/// itself asks for — take the cut, then put it on the board in place of the
/// frame — needed an id nobody had said out loud.
///
/// So a taken cut goes back into the conversation. Two readers again, and the
/// same split as a tool's answer: the note is what the model reads on the next
/// turn, the attachment is what the user sees now.
export type TakenCut = {
  /// The row that now exists — the id the model passes to a tool.
  referenceId: string;
  /// The frame it was cut out of, which is the other half of a swap: a board
  /// holding the frame wants this on and that off.
  frameId: string;
  /// What the cut is called, as filed. Derived from the frame by `addVersion`,
  /// so it already names the photograph this is a piece of.
  title: string;
  /// What the cut keeps, in the words the box was asked for in.
  keeps: string;
  /// The shape it was held to, when the ask named one — one of the six names, or
  /// the exact ratio of the slot a cut made for a board was held to.
  aspect: string | null;
  /// The loose shape it was framed as, by its word, when that is how the shape
  /// was said. Apart from `aspect` because the two are different promises and the
  /// note has to read as one or the other: a cut is *at* a ratio and *framed* as
  /// a word, and a cut framed square is not at anything.
  framed?: string | null;
  thumbUrl: string;
  /// The board the cut landed on, when the assistant asked for it to fill a slot
  /// there — the swap happens as part of the taking, so the board has already
  /// changed by the time this is read. Carried as the attachment rather than as
  /// an id because the chat has to *show* it: the arrangement is the answer to
  /// "did that fix it", and the scene it is drawn from is one the browser never
  /// saw.
  board?: BoardAttachment;
  /// The box that was cut, in the frame's 0-1000 units. Carried to recognise the
  /// *offer* this came from: the chat is still showing that offer as a decision
  /// waiting to be made, and a click on it would hand the panel a box the
  /// user has already taken.
  cropBox: number[];
};

/// The offer a taken cut settles, by the key the chat holds its attachments
/// under. Same frame, same box — a nudged offer is deliberately a different key,
/// because the box on the tile is then not the box that was filed and the tile is
/// still an honest offer of it.
export function takenOfferKey({ frameId, cropBox }: Pick<TakenCut, "frameId" | "cropBox">) {
  return `crop:${frameId}:${cropBox.join(",")}`;
}

/// The event, in one sentence, for the conversation to carry.
///
/// It says the three things the next turn needs and nothing else: that the offer
/// was taken (so it is not offered again), what the cut is (so it can be talked
/// about), and the two ids — the cut's and the frame's — since the only reason
/// this note exists is that a model which cannot name the new row has to buy a
/// `list_references` round to find it, and would still be guessing which of the
/// cuts under that frame is the one that just appeared.
///
/// The permission is spelled out because the instruction's own rule is that the
/// primed list is the project and every id in it may be passed to a tool. This id
/// is not in that list — it was filed a moment ago — so a sentence naming it
/// without saying so is an id the model may read as off-limits.
export function takenCutNote({
  referenceId,
  frameId,
  title,
  keeps,
  aspect,
  framed,
  board,
}: TakenCut) {
  const named = title.trim() || "the cut";
  const kept = keeps.trim();
  /// One clause, whichever way the shape was said — the exact one first, since it
  /// is the one with arithmetic behind it and a cut cannot have been both.
  const shape = aspect
    ? `at ${aspect}`
    : looseShapeOf(framed)
      ? `framed ${looseShapeOf(framed)?.label.toLowerCase()}`
      : "";
  const what = [kept && `keeps “${kept}”`, shape].filter(Boolean).join(", ");

  return [
    what ? `Took the cut you offered: “${named}” — ${what}.` : `Took the cut you offered: “${named}”.`,
    `It is filed as ${referenceId}, a cut of ${frameId} —`,
    "pass that id to a tool like any other reference.",
    /// The swap the offer carried, already made. Said in the same breath as the
    /// filing because the model's next move otherwise is the call that would do
    /// it again — and a second swap of a picture that is already on the board is
    /// answered with a refusal it then has to explain.
    ...(board
      ? [
          `It is already on “${board.title}” (${board.boardId}) in the place ${frameId} had, and nothing else on that board moved —`,
          "so there is no swap left to make.",
        ]
      : []),
  ].join(" ");
}

/// The cut itself in the chat, under the note. A reference attachment rather
/// than a crop one: this is a picture the project holds now, so it has a row, a
/// thumbnail of its own bytes and a click that opens the frame *at* it — which
/// is exactly what `attachmentOf` already builds for a cut named by
/// `show_references`.
export function takenCutAttachment({
  referenceId,
  frameId,
  title,
  keeps,
  thumbUrl,
}: TakenCut): ReferenceAttachment {
  return attachmentOf({
    id: referenceId,
    title,
    editIntent: keeps,
    thumbUrl,
    /// The frame's title is not carried: the cut's own title is that title with
    /// "(crop 2)" after it, so naming the photograph twice buys nothing and the
    /// panel this opens is the frame's anyway. What the caption needs from the
    /// source is that there *is* one.
    source: { id: frameId, title: "" },
  });
}
