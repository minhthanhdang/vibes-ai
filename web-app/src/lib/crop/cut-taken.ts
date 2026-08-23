import { attachmentOf, type ReferenceAttachment } from "@/lib/agent/shared/attachments";
import { looseShapeOf } from "@/lib/references/reference-version";

/// A cut the user framed by hand, once they have kept it.
///
/// `crop_reference` files its own cuts, so the conversation already knows about
/// those. The properties panel is the other door, and it is out of the
/// conversation's sight: a user who crops a frame there leaves the chat holding
/// a project it can no longer describe, and the next thing they ask about the
/// cut — put it on the board, show it beside the frame — needs an id nobody has
/// said out loud.
///
/// So a kept cut goes back into the conversation. Two readers again, and the
/// same split as a tool's answer: the note is what the model reads on the next
/// turn, the attachment is what the user sees now.
export type TakenCut = {
  /// The row that now exists — the id the model passes to a tool.
  referenceId: string;
  /// The frame it was cut out of, which is the other half of a swap: a board
  /// holding the frame wants this on and that off.
  frameId: string;
  /// What the cut is called, as filed. Derived from the frame by `fileVersion`,
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
};

/// The event, in one sentence, for the conversation to carry.
///
/// It says the three things the next turn needs and nothing else: that a cut was
/// made (so the model does not offer to make it), what the cut is (so it can be
/// talked about), and the two ids — the cut's and the frame's — since the only
/// reason this note exists is that a model which cannot name the new row has to
/// buy a `list_references` round to find it, and would still be guessing which of
/// the cuts under that frame is the one that just appeared.
///
/// The permission is spelled out because the instruction's own rule is that the
/// primed list is the project and every id in it may be passed to a tool. This id
/// is not in that list — it was filed a moment ago — so a sentence naming it
/// without saying so is an id the model may read as off-limits.
export function takenCutNote({ referenceId, frameId, title, keeps, aspect, framed }: TakenCut) {
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
    what ? `I cropped this myself: “${named}” — ${what}.` : `I cropped this myself: “${named}”.`,
    `It is filed as ${referenceId}, a cut of ${frameId} —`,
    "pass that id to a tool like any other reference.",
  ].join(" ");
}

/// The cut itself in the chat, under the note. A picture the project holds, so
/// it has a row, a thumbnail of its own bytes and a click that opens the frame
/// *at* it — which is exactly what `attachmentOf` already builds for a cut named
/// by `show_references`.
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
