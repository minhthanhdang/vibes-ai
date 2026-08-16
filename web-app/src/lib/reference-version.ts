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

/// Where a cut sits in the frame it came out of, as percentages of that frame.
///
/// The box has been on every version's row since the cut was made and read back
/// by nothing. A cut's own picture says what it kept and never where it was, and
/// under one frame's properties that is the question: every cut listed there is
/// a picture of the same photograph, so what tells them apart on sight is which
/// part of it each one is. Drawn over the frame, the box answers that.
///
/// Percentages rather than fractions, because the frame is on screen at whatever
/// width the panel is and this has to land on it at any size — the same reason
/// the box is stored 0-1000 of the frame rather than in pixels of one copy.
///
/// Null when there is no rectangle to draw: an original stores no box at all,
/// and a box keeping no width or no height is not a region of anything. The
/// frame is then shown plain rather than outlined around a guess.
export type CropOutline = { left: number; top: number; width: number; height: number };

export function cropBoxOutline(columns: unknown): CropOutline | null {
  const box = cropBoxOf(columns);
  if (!box) return null;

  const percent = (units: number) => Math.round((units / CROP_BOX_SCALE) * 10000) / 100;
  const outline = {
    left: percent(box.xmin),
    top: percent(box.ymin),
    width: percent(box.xmax - box.xmin),
    height: percent(box.ymax - box.ymin),
  };
  return outline.width > 0 && outline.height > 0 ? outline : null;
}

/// How much of the frame a box keeps, in words — said beside a box the director
/// is being shown *before* it is cut.
///
/// The outline answers where the cut is; this answers how big it is, and the two
/// are not the same question at a glance. A box drawn over a panel-width image
/// looks like a shot at any size, but one keeping 4% of a phone photo is a few
/// hundred pixels across, and a director accepting it gets a cut that falls
/// apart the moment agent 4 places it large. That is the judgement this makes
/// available while it is still free to decline.
///
/// Null when there is no rectangle to measure, so the review says nothing rather
/// than a percentage of nothing.
export function cropCoverageLabel(columns: unknown): string | null {
  const box = cropBoxOf(columns);
  if (!box) return null;

  const area =
    ((box.ymax - box.ymin) / CROP_BOX_SCALE) * ((box.xmax - box.xmin) / CROP_BOX_SCALE);
  if (area <= 0) return null;

  const percent = Math.round(area * 100);
  /// A tight detail rounds to zero, and "keeps 0% of the frame" reads as a bug
  /// rather than as the warning it is.
  return `Keeps ${percent < 1 ? "under 1" : percent}% of the frame`;
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

/// How long a rationale may be. Longer than an intent because it is a sentence
/// rather than a label — the cropper is asked for one line on why the box is the
/// box — and still bounded, because a model that starts explaining itself does
/// not stop on its own.
export const EDIT_RATIONALE_LIMIT = 400;

export function editRationale(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, EDIT_RATIONALE_LIMIT);
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

/// What the cropper said about a cut, under the label of that cut — or null when
/// there is nothing there worth a second line.
///
/// The intent is what was *asked for*; the rationale is what the model did with
/// it, and it is the only place a director reads that what they asked for was
/// not in this frame and the box is the nearest thing that is. Without it a cut
/// that answered a different question looks exactly like one that answered this
/// one.
///
/// Null for a hand-drawn crop, which nobody reasoned about in words, and for a
/// model that answered by repeating the request back: a second line that says
/// what the first line says is noise in a list whose whole job is telling cuts
/// of one photograph apart.
export function versionNote(version: {
  editIntent?: string | null;
  title?: string | null;
  editRationale?: string | null;
}) {
  const note = editRationale(version.editRationale ?? "");
  if (!note) return null;

  /// Compared on the words alone: "Just the hands." and "just the hands" are
  /// the model repeating the request back with a capital and a full stop.
  const said = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return said(note) === said(versionLabel(version)) ? null : note;
}

/// How many cuts each frame of a project has, as one read for the whole grid —
/// the same shape, and the same reason, as `analysisByProject`: a tile per photo
/// asking its own question is a round trip per photo.
export type VersionCountSource = { referenceId: string; count: number }[];
export type VersionCountIndex = ReadonlyMap<string, number>;

export function versionCountIndex(source: VersionCountSource): VersionCountIndex {
  const index = new Map<string, number>();
  for (const { referenceId, count } of source) {
    if (count > 0) index.set(referenceId, count);
  }
  return index;
}

/// What a gallery tile says about the cuts made of it, or null when there is
/// nothing to say.
///
/// A photograph with no versions says nothing at all rather than "0 crops": the
/// grid is the project's photos, and most of them have never been cropped — a
/// zero on every tile is noise that hides the tiles carrying a one.
///
/// Direct cuts only, matching the list the number leads to. A cut of a cut is
/// counted under the cut it was made from, which is where a director opens it
/// from and where `reference.versions` files it.
export function versionCountLabel(count: number | undefined) {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1) return null;
  const cuts = Math.floor(count);
  return cuts === 1 ? "1 crop" : `${cuts} crops`;
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
  editRationale: string;
  cropBox: number[];
};

/// The cropper's answer as the version it implies, or null when the answer is
/// "the frame is already the shot".
///
/// The title is the frame's own, suffixed exactly as a crop kept off the board
/// is — a director looks for the photograph, not for the agent that cut it — and
/// the intent rides beside it as the label of *which* cut of that frame this is.
/// The box is carried through in the model's own numbers so the row can still
/// say what part of the frame it names after the arithmetic is long done, and
/// the rationale beside it for the same reason: the run that holds it names no
/// version, so a plan that does not carry it hands the browser bytes nobody can
/// ever ask why about.
export function cropPlan({
  box,
  intent,
  rationale = "",
  sourceTitle,
}: {
  box: CropBox;
  intent: string;
  rationale?: string;
  sourceTitle: string;
}): CropPlan | null {
  const region = cropRegionOfBox(box);
  if (!region) return null;

  return {
    region,
    title: croppedReferenceTitle(sourceTitle),
    editIntent: editIntent(intent),
    editRationale: editRationale(rationale),
    cropBox: cropBoxColumns(box),
  };
}
