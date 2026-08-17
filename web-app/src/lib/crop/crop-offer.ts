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
  cropBoxOutline,
  cropCoverageLabel,
  cropPixelSize,
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
  ///
  /// A label rather than one of the six names: a cut asked for a board is held to
  /// the *slot* it is filling, which is whatever ratio the template made it
  /// ("3.52:1"). It reads back through `cropShapeOf` either way, so the column,
  /// the review and the nudge all still know what shape this is.
  aspect: string | null;
  /// The loose shape it was framed to, by its word, when the director asked for
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
  /// The board this cut was asked for, when it was asked for one — a slot on it
  /// holds the frame and the cut is meant to take that place.
  ///
  /// Carried on the offer because the offer is the only thing that survives the
  /// turn: the tool cannot file the row and cannot make the swap, so the intent
  /// has to travel to the browser that does both. Taking the cut then puts it on
  /// the board in the same move, which is the difference between the loop ending
  /// in the panel and the loop ending in a third turn of the conversation.
  ///
  /// `takeOff` is the picture the cut replaces, when that is not the frame the
  /// offer is drawn on: a nudge of a cut that is *itself* on the board takes the
  /// cut's place, and swapping the frame out would take off a picture the board
  /// does not hold and leave the old cut standing.
  ///
  /// `pageId` is which page of a spread the swap lands on (§V.3). A picture can
  /// stand on two pages of one board, so a swap given only a board edits
  /// whichever copy the scene array carries first — and this offer was held to
  /// one particular slot's shape, which is a fact about one particular page. The
  /// page it was measured against is the page it belongs on.
  forBoard?: { boardId: string; title: string; takeOff?: string; pageId?: string; page?: string };
};

/// A cut the director wants changed, as the nudge that means.
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
  /// where the edges of scope sit, and a director who names a new shape is asking
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
/// `crop_reference` puts a cut on a board only when it was *given* one: the offer
/// carries `forBoard`, and the browser that files the cut swaps it in there.
/// Without a board the offer changes nothing on the canvas — so a board holding
/// the frame, or holding the very cut being nudged, keeps the picture the
/// director has just asked to be different, and until now nothing said so. The
/// model's two wrong moves from that silence are both cheap to make: report the
/// board as sorted, or swap the *old* cut on in place of an offer that does not
/// exist yet.
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
        /// shows the picture the director asked to be different is where they
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
/// A report rather than a binding. Holding the offer to a board the director did
/// not name would change a board they did not mention *and* cut a different
/// shape from the one they asked for — the slot's, not theirs. So the board is
/// named and the decision stays where every other board change in this layer
/// leaves it.
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
  return `taking this offer files a cut and changes no board. ${list}${more} — so do not say any board has been updated, and do not call swap_on_board, which would put a picture that already exists where the offer is meant to go. If this cut is for that slot, call crop_reference again with that boardId — and with the pageId beside it when the picture is named on a page above, since a spread can hold it twice in two differently shaped openings: it is then held to that slot's own shape and taking it swaps that copy in.`;
}

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
/// the chat because that is where the director first sees the offer — a box that
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

/// The cut itself, drawn out of the frame's own thumbnail.
///
/// There are no pixels of an offer — that is the whole point of it — but there is
/// no need for any: the bytes the cut would be made of are already on screen, in
/// the thumbnail of the frame, and which part of them the cut keeps is four
/// numbers. Blowing the thumbnail up until the kept region fills its box shows
/// the director the picture they are being offered rather than the picture it
/// would come out of.
///
/// Which is the difference between a decision and a description. The coverage and
/// pixel-size lines say what the box *is*; a full frame under them says nothing
/// about what the cut looks like, and a full frame is what every offer looked
/// like before this.
///
/// Percentages of the box the thumbnail sits in, so it lands at whatever width
/// the chat column happens to be — the same reason the box itself is stored as a
/// share of the frame rather than in pixels of one copy.
export type CropPreview = {
  /// The cut's own shape, so the box drawn around it is the shape of the picture
  /// rather than of the tile. Without it the two axes scale independently and the
  /// preview is the right region of a stretched photograph.
  aspectRatio: number;
  /// The thumbnail's size and offset inside that box, in percent.
  image: { width: number; height: number; left: number; top: number };
};

function twoPlaces(value: number) {
  const rounded = Math.round(value * 100) / 100;
  /// A box against the top or left edge offsets by nothing, and the sign of that
  /// nothing is negative — "-0%" in a style, and a failed comparison against 0.
  return rounded === 0 ? 0 : rounded;
}

/// Null when there is nothing to draw: a box that is not a rectangle, or a frame
/// whose pixel size was never recorded — the cut's shape is a shape of the
/// frame's pixels, and guessing it would show a stretched picture as if it were
/// the offer. The tile falls back to the frame it came out of.
export function cropPreview(
  columns: unknown,
  frame: { width?: unknown; height?: unknown },
): CropPreview | null {
  const outline = cropBoxOutline(columns);
  const cut = cropPixelSize(columns, frame);
  if (!outline || !cut) return null;

  return {
    aspectRatio: twoPlaces(cut.width / cut.height),
    image: {
      width: twoPlaces(10000 / outline.width),
      height: twoPlaces(10000 / outline.height),
      left: twoPlaces(-(outline.left * 100) / outline.width),
      top: twoPlaces(-(outline.top * 100) / outline.height),
    },
  };
}
