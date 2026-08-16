import { CROP_MIN_TRIM, croppedReferenceTitle, type CropRegion } from "./moodboard-crop";

/// What a *modified version* of a reference is, and what agent 3's answer has to
/// be for one to exist.
///
/// The cropper does not cut anything. `PRO` returns a normalized 0-1000 box —
/// box detection is a trained Gemini behavior — and the cut is arithmetic on it
/// (tech-spec §III.3). This module is that arithmetic's front half: it turns the
/// numbers a model wrote into the same `CropRegion` a director's own crop
/// crosses as, so from there on an agent's crop and a hand-drawn one are cut,
/// named and stored by exactly one path.
///
/// Fractions, again, are the reading that survives. A box is 0-1000 of *the
/// frame*, not of any particular copy of it, so the same box cuts the right
/// region out of the original, out of a 640px thumbnail, and out of a re-encode
/// nobody has made yet. See `moodboard-crop.ts`, which crossed the same bridge
/// from the other side.
///
/// No fetch, no canvas and no model call here: this is what a version *is*.

/// The scale Gemini's boxes come in. Not configurable — it is the model's
/// convention, and a box in any other scale is a box this app cannot read.
export const CROP_BOX_SCALE = 1000;

/// Gemini's ordering, which is not the reading order of a rectangle: y before x,
/// mins before maxes.
export type CropBox = { ymin: number; xmin: number; ymax: number; xmax: number };

/// How little of an edge a box may keep before it is read as a misfire rather
/// than as a shot. A model that answers with 8/1000 of a frame has found a
/// detail nobody asked to be alone with — and against a phone photo that is a
/// 30px cut, which is not a reference. Well under any real crop: a tight close
/// on one face in a wide is still several percent of the frame.
export const CROP_MIN_SIDE = 0.02;

function boxSide(min: unknown, max: unknown): [number, number] | null {
  if (typeof min !== "number" || typeof max !== "number") return null;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  /// Ordered rather than rejected when reversed. A swapped pair is a model that
  /// wrote the corners the other way round, and it names the same rectangle;
  /// refusing it would throw away a usable crop over the order of two numbers.
  const low = Math.round(Math.min(min, max));
  const high = Math.round(Math.max(min, max));
  if (high <= 0 || low >= CROP_BOX_SCALE) return null;

  return [Math.max(0, low), Math.min(CROP_BOX_SCALE, high)];
}

/// A box out of anything: the model's `[ymin, xmin, ymax, xmax]` array, and the
/// same four numbers read back off the row that stored them.
///
/// Null means there is no rectangle in here at all — a wrong length, a value
/// that is not a number, or an edge entirely outside the frame. Everything else
/// is clamped into the frame rather than refused, because a box that overruns by
/// a few units is the model rounding, not the model missing.
export function cropBoxOf(value: unknown): CropBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;

  const vertical = boxSide(value[0], value[2]);
  const horizontal = boxSide(value[1], value[3]);
  if (!vertical || !horizontal) return null;

  const [ymin, ymax] = vertical;
  const [xmin, xmax] = horizontal;
  return { ymin, xmin, ymax, xmax };
}

/// The column form: the model's own array, which is what the row stores.
export function cropBoxColumns(box: CropBox): number[] {
  return [box.ymin, box.xmin, box.ymax, box.xmax];
}

/// The box as the region a cut is made from, or null when cutting it would not
/// produce a version worth having.
///
/// Two ways to be worthless, and they are opposite ends of the same judgement.
/// A box that trims nothing is the frame the project already holds — cutting it
/// buys a second copy of a photograph and calls it a crop. A box thinner than
/// `CROP_MIN_SIDE` is a misread. Between them is every real answer.
export function cropRegionOfBox(box: CropBox): CropRegion | null {
  const region = {
    x: box.xmin / CROP_BOX_SCALE,
    y: box.ymin / CROP_BOX_SCALE,
    width: (box.xmax - box.xmin) / CROP_BOX_SCALE,
    height: (box.ymax - box.ymin) / CROP_BOX_SCALE,
  };

  if (region.width < CROP_MIN_SIDE || region.height < CROP_MIN_SIDE) return null;

  /// The same threshold a crop made by hand is held to, so "this is not a crop"
  /// means one thing in this app rather than two.
  const trimmed = region.width < 1 - CROP_MIN_TRIM || region.height < 1 - CROP_MIN_TRIM;
  return trimmed ? region : null;
}

/// The same crossing from the other side: a region the director drew, in the
/// numbers the column stores.
///
/// A crop kept off the board is a version of the frame it was drawn on, exactly
/// as agent 3's is, and a version's row says which part of the frame it names.
/// Nobody wrote a box for a hand-drawn crop, so it is derived from the region —
/// the same fractions, at the model's scale — and the two crop paths become one
/// row shape rather than two.
///
/// Not held to `CROP_MIN_SIDE`: that threshold reads a *model's* answer for a
/// misfire, and a director who drew a sliver drew the sliver they wanted. Only a
/// region that is not a rectangle is refused, and a side that rounds away is
/// kept at one unit so the row never records a box of nothing.
export function cropBoxOfRegion(region: CropRegion): CropBox | null {
  const edges = [region.x, region.y, region.width, region.height];
  if (edges.some((edge) => typeof edge !== "number" || !Number.isFinite(edge))) return null;
  if (region.width <= 0 || region.height <= 0) return null;

  const side = (start: number, length: number): [number, number] => {
    const min = Math.min(Math.max(0, Math.round(start * CROP_BOX_SCALE)), CROP_BOX_SCALE - 1);
    const max = Math.round((start + length) * CROP_BOX_SCALE);
    return [min, Math.min(CROP_BOX_SCALE, Math.max(min + 1, max))];
  };

  const [ymin, ymax] = side(region.y, region.height);
  const [xmin, xmax] = side(region.x, region.width);
  return { ymin, xmin, ymax, xmax };
}

/// How long an intent may be. It is a prompt the director wrote, kept for the
/// panel to show under the frame's properties; anything past a line of it is
/// their reasoning, not the label of a cut. The title itself is the frame's,
/// suffixed by `croppedReferenceTitle` exactly as a hand-made crop is — a
/// director looks for the photo, not for the agent that cut it — so the intent
/// is carried beside it rather than folded in.
export const EDIT_INTENT_LIMIT = 200;

export function editIntent(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, EDIT_INTENT_LIMIT);
}

/// What a cut made on the board was asked for, when nobody asked in words.
///
/// A version is labelled by its intent because every cut of one frame carries
/// the same title, and a crop the director drew has no prompt behind it — so it
/// says where it was made, which is what tells it apart from the cropper's cuts
/// of the same frame in the list they now share.
export const BOARD_CROP_INTENT = "Cropped on the board";

/// What a version is called where it is shown — under the properties of the
/// frame it came out of, in a list of the other cuts of that same frame.
///
/// The intent, not the title: every version of one frame is "<the frame>
/// (crop N)", so a column of titles is a column of the same words. What tells
/// the director which cut is which is what it was asked for. The title is the
/// fallback for a version made some other way, and something is always shown —
/// a row with neither is still a picture that has to be clickable.
export function versionLabel(version: { editIntent?: string | null; title?: string | null }) {
  return editIntent(version.editIntent ?? "") || (version.title ?? "").trim() || "Crop";
}

/// What a reference is, said where the frame it came out of is not on screen —
/// the board, where a cut sits among photographs with nothing around it to say
/// it is one.
///
/// Null for a photograph: a reference the director brought in came from outside
/// the app, and "cropped from" is the only thing worth saying here. For a cut it
/// is the frame first and the asking second, because on a board the question is
/// which photograph this is a piece of; `versionLabel` answers the other
/// question, in the one place where the frame is already known.
export function versionCredit(reference: {
  editIntent?: string | null;
  source?: { title?: string | null } | null;
}) {
  if (!reference.source) return null;

  const frame = (reference.source.title ?? "").trim();
  const asked = editIntent(reference.editIntent ?? "");
  /// A frame with no title still exists and is still what this was cut from, so
  /// the credit is said without naming it rather than not said.
  const from = `Cropped from ${frame ? `“${frame}”` : "the original"}`;
  return asked ? `${from} — ${asked}` : from;
}

/// A version that does not exist yet, as everything needed to make one: the
/// region to cut, and the three columns that say the row is a cut rather than a
/// photograph.
export type CropPlan = {
  region: CropRegion;
  title: string;
  editIntent: string;
  cropBox: number[];
};

/// The cropper's answer as the version it implies, or null when the answer is
/// "the frame is already the shot".
///
/// The title is the frame's own, suffixed exactly as a crop kept off the board
/// is — a director looks for the photograph, not for the agent that cut it — and
/// the intent rides beside it as the label of *which* cut of that frame this is.
/// The box is carried through in the model's own numbers so the row can still
/// say what part of the frame it names after the arithmetic is long done.
export function cropPlan({
  box,
  intent,
  sourceTitle,
}: {
  box: CropBox;
  intent: string;
  sourceTitle: string;
}): CropPlan | null {
  const region = cropRegionOfBox(box);
  if (!region) return null;

  return {
    region,
    title: croppedReferenceTitle(sourceTitle),
    editIntent: editIntent(intent),
    cropBox: cropBoxColumns(box),
  };
}
