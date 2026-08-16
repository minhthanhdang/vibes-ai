import type { CropRegion } from "./moodboard-crop";
import {
  cropAspectOf,
  cropAspectRatio,
  cropBoxAtAspect,
  cropBoxColumns,
  cropCoverageLabel,
  cropPlan,
  cropSizeLabel,
  cropSoftOnBoard,
  versionLabel,
  type CropAspectId,
  type CropBox,
} from "./reference-version";

/// A cut that does not exist yet, as something that can travel.
///
/// The compositor files its board and the cropper cannot: the pixels are cut in
/// the browser, on bytes read back same-origin (§II.6), so a crop asked for in
/// the chat has nowhere on the server to become a row. What crosses instead is
/// the *offer* — the same four numbers `planCrop` answers the properties panel
/// with, plus the id of the frame they are numbers of — and the browser
/// completes it through the path every other crop in this app goes through.
///
/// That turns out to be the better shape anyway. A cut nobody wanted is the
/// commonest thing agent 3 produces, and a chat that filed them would answer a
/// wrong box with a row, its bytes, its thumbnail, its analysis and the delete
/// that follows.
///
/// Pure, and no fetch: this is the arithmetic between the model's box and the
/// review the director reads, so both the tool that makes an offer and the
/// browser that takes one agree on what one is.

export type CropOffer = {
  /// The frame the cut comes out of. Not the cut's own id — there is no cut —
  /// and the row the properties panel opens on either way.
  referenceId: string;
  region: CropRegion;
  cropBox: number[];
  editIntent: string;
  editRationale: string;
  /// The shape the box was held to, or null for a cut framed around its own
  /// subject. Carried because the pixels cannot say it afterwards and a nudge
  /// about this box has to be asked at the same format.
  aspect: CropAspectId | null;
};

/// Either the offer or the sentence saying why there is none. Both are answers
/// the director is owed: "the whole frame is the shot" is the cropper reading
/// the photograph correctly, not a failure, and a model told only that something
/// went wrong will try again at the price of another vision call.
export type CropOfferResult = { offer: CropOffer } | { refused: string };

/// Why this frame cannot be cut to that shape, asked *before* the call.
///
/// A ratio is a ratio of the frame's pixels — 0-1000 is a share of each edge of
/// a picture that is not square — so a row whose size was never recorded cannot
/// be held to a format at all. Reading that first is what keeps the refusal from
/// costing a vision call to arrive at.
export function unfittableAspect(
  frame: { width?: number | null; height?: number | null },
  aspect: unknown,
): string | null {
  const held = cropAspectOf(aspect);
  if (!held) return null;
  if (frame.width && frame.height) return null;
  return `this frame's pixel size was never recorded, so a cut of it cannot be held to ${held} — ask without a shape`;
}

/// The cropper's answer as the offer it implies.
///
/// The shape is arithmetic here rather than trust in the model: it is told the
/// format so it frames *for* it, and the box it returns is then opened out about
/// its own centre until its pixels are exactly that ratio. The same order the
/// properties panel's own path takes, because a cut offered in the chat and one
/// offered in the panel have to be the same cut.
export function cropOffer({
  reference,
  box,
  intent,
  rationale = "",
  aspect,
}: {
  reference: { id: string; title: string; width?: number | null; height?: number | null };
  box: CropBox;
  intent: string;
  rationale?: string;
  aspect?: unknown;
}): CropOfferResult {
  const held = cropAspectOf(aspect);
  const unfittable = unfittableAspect(reference, held);
  if (unfittable) return { refused: unfittable };

  const ratio = cropAspectRatio(held);
  const fitted = ratio ? cropBoxAtAspect(cropBoxColumns(box), reference, ratio) : box;
  /// A refusal rather than a silent substitution: a cut filed as 16:9 that is
  /// not 16:9 is worse than no cut.
  if (!fitted) return { refused: `the cropper's box could not be held to ${held}` };

  const plan = cropPlan({ box: fitted, intent, rationale, sourceTitle: reference.title });
  if (!plan) {
    return { refused: "the whole frame is the shot — there is nothing to crop out of it" };
  }

  return {
    offer: {
      referenceId: reference.id,
      region: plan.region,
      cropBox: plan.cropBox,
      editIntent: plan.editIntent,
      editRationale: plan.editRationale,
      aspect: held,
    },
  };
}

/// What the offer is called where it is shown beside a reply — what the cut
/// keeps, which is the one thing that distinguishes it from the frame it is
/// drawn on and from every other cut of that frame.
export function cropOfferTitle(offer: CropOffer) {
  return versionLabel({ editIntent: offer.editIntent });
}

/// What the offer is, in the line under it: how much of the frame it keeps, how
/// big that is in pixels, and the format it was held to when one was asked for.
///
/// The same three readings the review card in the panel is judged on, said in
/// the chat because that is where the director first sees the offer — a box that
/// keeps 4% of a screenshot is a decision, and one they should be able to make
/// without opening anything.
export function cropOfferCaption(
  offer: CropOffer,
  frame: { width?: number | null; height?: number | null },
) {
  const said = [
    offer.aspect,
    cropCoverageLabel(offer.cropBox),
    cropSizeLabel(offer.cropBox, frame),
    cropSoftOnBoard(offer.cropBox, frame) ? "Soft on a board" : null,
  ];
  return said.filter(Boolean).join(" · ");
}
