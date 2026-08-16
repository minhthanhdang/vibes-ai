import { attachmentOf, type ReferenceAttachment } from "./agent-tools";
import type { CropAspectId } from "./reference-version";

/// The cut the assistant offered, once the director has taken it.
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
/// turn, the attachment is what the director sees now.
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
  /// The shape it was held to, when the ask named one.
  aspect: CropAspectId | null;
  thumbUrl: string;
  /// The box that was cut, in the frame's 0-1000 units. Carried to recognise the
  /// *offer* this came from: the chat is still showing that offer as a decision
  /// waiting to be made, and a click on it would hand the panel a box the
  /// director has already taken.
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
export function takenCutNote({ referenceId, frameId, title, keeps, aspect }: TakenCut) {
  const named = title.trim() || "the cut";
  const kept = keeps.trim();
  const what = [kept && `keeps “${kept}”`, aspect && `at ${aspect}`].filter(Boolean).join(", ");

  return [
    what ? `Took the cut you offered: “${named}” — ${what}.` : `Took the cut you offered: “${named}”.`,
    `It is filed as ${referenceId}, a cut of ${frameId} —`,
    "pass that id to a tool like any other reference.",
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
