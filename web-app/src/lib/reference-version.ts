import { CROP_MIN_TRIM, type CropRegion } from "./moodboard-crop";

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
