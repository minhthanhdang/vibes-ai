import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import {
  usingPagesSaid,
  type UsingBoard,
  type UsingPage,
} from "@/lib/references/reference-usage";
import {
  cropBoxAtAspect,
  cropBoxColumns,
  cropBoxOf,
  cropCoverageLabel,
  cropPlan,
  cropShapeMeasured,
  cropShapeOf,
  cropSizeLabel,
  cropSoftOnBoard,
  looseShapeOf,
  shapeAsked,
  versionLabel,
  type CropBox,
} from "@/lib/references/reference-version";

/// The cut the cropper's four numbers imply, before anything is cut.
///
/// It used to travel: nothing on the server could decode an image, so the tool
/// answered with this and the browser cut the pixels and filed the row. The
/// codec retired that hop — `crop_reference` now cuts and files in the one
/// call — and what is left is the step in between, where the box is opened out
/// to the shape that was asked for and refused when there is no cut in it.
///
/// Pure, and no fetch: this is the arithmetic between the model's box and the
/// columns the row is filed under, so the tool that files a cut and the
/// properties panel that offers one for a look agree on what one is.

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
  ///
  /// A label rather than one of the six names: a cut asked for a board is held to
  /// the *slot* it is filling, which is whatever ratio the template made it
  /// ("3.52:1"). It reads back through `cropShapeOf` either way, so the column,
  /// the review and the nudge all still know what shape this is.
  aspect: string | null;
  /// The loose shape it was framed to, by its word, when the user asked for
  /// one — "square", "landscape". Separate from `aspect` rather than a third
  /// spelling of it, because the two are different promises: an exact shape is
  /// what the cut *is*, to two decimal places, while a loose one is what it was
  /// framed for and the pixels say how near it landed.
  loose?: string;
  /// The filed cut this offer was moved from, when the ask started at a cut
  /// rather than at the frame. The panel's own adjustment already carries this;
  /// an offer made in the chat could not, because until now the chat could only
  /// ever ask about a frame.
  ///
  /// It is what stops the review reading a nudge as a near-duplicate of the row
  /// it is a nudge *of* — the one warning that is exactly backwards on an
  /// adjustment.
  origin?: { id: string; cropBox: number[]; editIntent: string; editAspect?: string };
};

/// A cut the user wants changed, as the nudge that means.
///
/// Cropping a cut is the wrong shape of answer twice over. A box inside a box can
/// only ever take *less* of the photograph than the cut already has, so "a little
/// wider" is unanswerable by it; and the version it would file is a cut of a cut,
/// which the gallery has no way into — the properties panel opens on a frame, and
/// a version of a version sits under a row that has no panel of its own. The
/// panel's own answer to this is `adjust`: ask the *frame* again with the cut's
/// box attached, so what comes back is another version of the frame, beside the
/// one it improves on rather than under it.
///
/// Null for a row with no readable box — a cut whose region was never recorded is
/// one there is nothing to move.
export function cropNudge(cut: {
  id: string;
  cropBox?: unknown;
  editIntent?: string | null;
  editAspect?: string | null;
}) {
  const box = cropBoxOf(cut.cropBox);
  if (!box) return null;

  const columns = cropBoxColumns(box);
  const editIntent = cut.editIntent?.trim() ?? "";
  /// The shape the row was cut at, in whichever vocabulary it was asked in. It
  /// is the *default* rather than the answer: a nudge about a scope crop is about
  /// where the edges of scope sit, and a user who names a new shape is asking
  /// for a different cut of the same subject.
  const asked = shapeAsked(cut.editAspect);
  return {
    previous: { cropBox: columns, editIntent },
    asked: asked ? (asked.shape?.label ?? asked.loose?.id ?? null) : null,
    origin: {
      id: cut.id,
      cropBox: columns,
      editIntent,
      ...(asked && { editAspect: asked.shape?.label ?? asked.loose?.id }),
    },
  };
}

/// How many boards the answer names one by one. Two, because the id is what the
/// model would pass and a third is a list nobody can act on inside a sentence —
/// past that the count is the fact, on the same judgement `usageSummary` makes
/// for the removal warning.
export const STANDING_ON_LIMIT = 2;

export type BoardStandingOn = { id: string; title: string; takeOff: string; pages?: UsingPage[] };

/// The boards left standing on the picture this cut would take the place of.
///
/// `crop_reference` makes the swap only when it was *given* a board. Without one
/// it files a row and changes nothing on the canvas — so a board holding the
/// frame, or holding the very cut being nudged, keeps the picture the user has
/// just asked to be different, and nothing else says so. The model's two wrong
/// moves from that silence are both cheap to make: report the board as sorted,
/// or leave the old picture standing under a reply about the new one.
///
/// The cut before the frame, which is the order the `boardId` path resolves
/// `takeOff` in: a board standing on a cut loses that cut, and naming the frame
/// would point the model at a picture that board does not hold.
export function boardsStandingOn(
  usage: ReadonlyMap<string, readonly UsingBoard[]>,
  { cut, frame }: { cut?: string | null; frame: string },
): BoardStandingOn[] {
  const standing = new Map<string, BoardStandingOn>();
  for (const id of [cut, frame]) {
    if (!id) continue;
    for (const board of usage.get(id) ?? []) {
      if (standing.has(board.id)) continue;
      standing.set(board.id, {
        id: board.id,
        title: board.title,
        takeOff: id,
        /// Carried through rather than re-read: which page of a spread still
        /// shows the picture the user asked to be different is where they
        /// would go to look, and the usage read has already worked it out.
        ...(board.pages && { pages: board.pages }),
      });
    }
  }
  return [...standing.values()];
}

/// What the model is told about them: the consequence, the routing that avoids
/// it, and the sentence it must not write.
///
/// A report rather than a binding. Holding the cut to a board the user did not
/// name would change a board they did not mention *and* cut a different shape
/// from the one they asked for — the slot's, not theirs. So the board is named
/// and the decision stays where every other board change in this layer leaves
/// it.
export function standingOnNote(
  boards: readonly BoardStandingOn[],
  limit = STANDING_ON_LIMIT,
): string | null {
  if (!boards.length) return null;
  const named = boards.slice(0, Math.max(1, limit));
  const rest = boards.length - named.length;
  const list = named
    .map(
      (board) =>
        `“${board.title.trim() || "Untitled board"}” (${board.id}), which is standing on ${board.takeOff}${usingPagesSaid(board)}`,
    )
    .join("; ");
  const more = rest ? `, and ${rest} other board${rest === 1 ? "" : "s"}` : "";
  return `this cut is filed and no board was changed. ${list}${more} — so do not say any board has been updated. If the user wants it there, call swap_on_board with the cut's id, naming the page when one is given above, since a spread can hold the old picture twice in two differently shaped openings. If the cut is meant to *fill* that opening rather than sit loosely in it, crop again with that boardId — and that pageId — so it is held to the slot's own shape and swapped in by the same call.`;
}

/// Either the offer or the sentence saying why there is none. Both are answers
/// the user is owed: "the whole frame is the shot" is the cropper reading
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
  const held = cropShapeOf(aspect);
  if (!held) return null;
  if (frame.width && frame.height) return null;
  return `this frame's pixel size was never recorded, so a cut of it cannot be held to ${held.label} — ask without a shape`;
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
  loose,
}: {
  reference: { id: string; title: string; width?: number | null; height?: number | null };
  box: CropBox;
  intent: string;
  rationale?: string;
  aspect?: unknown;
  /// The loose shape the cropper framed for, by its word. No arithmetic follows
  /// it — that is what makes it loose — so it is carried rather than applied.
  loose?: string;
}): CropOfferResult {
  const held = cropShapeOf(aspect);
  const unfittable = unfittableAspect(reference, held?.label);
  if (unfittable) return { refused: unfittable };
  /// An exact shape wins if both arrive: it is the one with arithmetic behind
  /// it, so a cut carrying both words would be labelled with the shape it is not.
  const framed = held ? null : looseShapeOf(loose);

  const fitted = held ? cropBoxAtAspect(cropBoxColumns(box), reference, held.ratio) : box;
  /// A refusal rather than a silent substitution: a cut filed as 16:9 that is
  /// not 16:9 is worse than no cut.
  if (!fitted) return { refused: `the cropper's box could not be held to ${held?.label}` };

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
      aspect: held?.label ?? null,
      ...(framed && { loose: framed.id }),
    },
  };
}

/// The shape the cut actually came out, measured off its pixels.
///
/// Only interesting for a loose cut: an exact one is the ratio it was held to,
/// by construction. Null when the frame's size was never recorded, which is the
/// same case that leaves a loose ask unchecked.
export function cropOfferShape(
  offer: CropOffer,
  frame: { width?: number | null; height?: number | null },
): string | null {
  return cropShapeMeasured(offer.cropBox, frame);
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
/// the chat because that is where the user first sees the offer — a box that
/// keeps 4% of a screenshot is a decision, and one they should be able to make
/// without opening anything.
export function cropOfferCaption(
  offer: CropOffer,
  frame: { width?: number | null; height?: number | null },
) {
  /// A loose cut says both halves of what it is: the shape it was framed for and
  /// the shape it came out. One without the other is either a promise with no
  /// evidence or a number nobody asked for.
  const framed = looseShapeOf(offer.loose);
  const shape = framed
    ? [framed.label, cropOfferShape(offer, frame)].filter(Boolean).join(" · ")
    : offer.aspect;

  const said = [
    shape,
    cropCoverageLabel(offer.cropBox),
    cropSizeLabel(offer.cropBox, frame),
    cropSoftOnBoard(offer.cropBox, frame) ? "Soft on a board" : null,
  ];
  return said.filter(Boolean).join(" · ");
}
