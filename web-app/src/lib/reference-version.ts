import { CAPTION_MAX_LENGTH } from "./moodboard-caption";
import {
  CROP_MIN_TRIM,
  croppedPixels,
  croppedReferenceTitle,
  type CropRegion,
} from "./moodboard-crop";
import { DROPPED_IMAGE_MAX_EDGE } from "./moodboard-drop";
import { BOARD_IMAGE_PIXEL_RATIO } from "./moodboard-resolution";

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
function boxRegion(box: CropBox): CropRegion {
  return {
    x: box.xmin / CROP_BOX_SCALE,
    y: box.ymin / CROP_BOX_SCALE,
    width: (box.xmax - box.xmin) / CROP_BOX_SCALE,
    height: (box.ymax - box.ymin) / CROP_BOX_SCALE,
  };
}

export function cropRegionOfBox(box: CropBox): CropRegion | null {
  const region = boxRegion(box);

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

/// How big the cut will actually be, in the pixels of the photograph it is
/// taken out of.
///
/// The coverage line says a box keeps 4% of the frame; whether that is a
/// reference or a smear depends entirely on what the frame is. 4% of a 6000px
/// photograph is a 1200px picture, and 4% of a screenshot somebody saved off a
/// contact sheet is 160px — the same percentage, the same box drawn on the same
/// panel-width image, and only one of them survives being placed. This is the
/// half of that judgement the box alone cannot make.
///
/// Null when the frame's own size is not known — a row uploaded before the
/// browser wrote its dimensions, or a box that is not a rectangle — so the
/// review says nothing rather than a measurement of nothing.
///
/// Cut by `croppedPixels`, which is the arithmetic that will actually make it:
/// the number shown before the cut is the number the file comes back at, not a
/// second estimate of it.
export type CropPixels = { width: number; height: number };

function pixelEdge(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function cropPixelSize(
  columns: unknown,
  frame: { width?: unknown; height?: unknown },
): CropPixels | null {
  const box = cropBoxOf(columns);
  const width = pixelEdge(frame.width);
  const height = pixelEdge(frame.height);
  if (!box || !width || !height) return null;

  const cut = croppedPixels(boxRegion(box), { width, height });
  return { width: cut.width, height: cut.height };
}

export function cropSizeLabel(
  columns: unknown,
  frame: { width?: unknown; height?: unknown },
): string | null {
  const size = cropPixelSize(columns, frame);
  return size ? `About ${size.width} × ${size.height} px` : null;
}

/// The source pixels an image needs on its longest edge to be drawn sharp where
/// a drop lands it: a dropped reference is scaled to `DROPPED_IMAGE_MAX_EDGE`
/// scene units, and a scene unit is `BOARD_IMAGE_PIXEL_RATIO` device pixels on
/// the displays a moodboard is judged on. Derived from the two rules rather than
/// written down again, so a board that starts dropping images larger moves this
/// threshold with it.
export const BOARD_SOURCE_EDGE = DROPPED_IMAGE_MAX_EDGE * BOARD_IMAGE_PIXEL_RATIO;

/// Whether the cut would already be soft at the size a board drops it at.
///
/// A cut is asked for because that part of the frame is the shot, which is
/// exactly why it ends up on a board — and there is no getting the pixels back
/// afterwards: the crop is cut once, from the original, and the version's bytes
/// are all any later placement has. Better read now, while declining still costs
/// nothing but the call that has already been made.
///
/// The longest edge, because that is the edge the drop scales to. False when the
/// frame's size is unknown: a warning nobody can check is worse than silence.
export function cropSoftOnBoard(
  columns: unknown,
  frame: { width?: unknown; height?: unknown },
): boolean {
  const size = cropPixelSize(columns, frame);
  return !!size && Math.max(size.width, size.height) < BOARD_SOURCE_EDGE;
}

/// The shapes a crop can be *held* to, by the names a director says them in.
///
/// A cut asked for in words comes back at whatever shape the subject happens to
/// sit in, and that is the right answer for a reference nobody is composing with.
/// A director building a moodboard is often after the other thing: this frame, as
/// the format the film is in — scope, widescreen, a square for a grid, a portrait
/// for a phone. Said in words the ask cannot deliver it, because a box is 0-1000
/// of a frame that is not itself square, so "16:9" in these numbers depends on
/// the frame's pixels, which the model is not given.
///
/// Widest first, which is the order they are chosen in.
export const CROP_ASPECTS = {
  "2.39:1": 2.39,
  "1.85:1": 1.85,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "9:16": 9 / 16,
} as const;

export type CropAspectId = keyof typeof CROP_ASPECTS;

export const CROP_ASPECT_IDS = Object.keys(CROP_ASPECTS) as [CropAspectId, ...CropAspectId[]];

/// One of the shapes, or null for anything that is not one of them — the choice
/// arrives from a form, crosses the wire and comes back out of a column, and an
/// unrecognised shape is a crop held to nothing rather than a crop held to NaN.
///
/// The empty string is the form's own "any shape" and the stored form of a cut
/// nobody asked a format of, so it answers null like any other non-shape.
export function cropAspectOf(id: unknown): CropAspectId | null {
  return typeof id === "string" && id in CROP_ASPECTS ? (id as CropAspectId) : null;
}

/// The ratio behind a name.
export function cropAspectRatio(id: unknown): number | null {
  const aspect = cropAspectOf(id);
  return aspect ? CROP_ASPECTS[aspect] : null;
}

/// A shape a cut can be held to: the words it is said in and the number it is.
///
/// The six names above are the shapes a *director* asks for, and they are the
/// whole vocabulary of the form and of the tool declaration. They are not the
/// whole vocabulary of the pipeline: a slot on a moodboard is whatever shape the
/// template made it, and the widest of those (HERO_LEFT's supporting strips, at
/// 3.52:1) is wider than anything on the list — so a cut held to the nearest
/// *name* still leaves a third of the opening showing. The spec asks for "a
/// specific ratio, or loose square/rectangle"; this is the specific ratio, and it
/// exists so the one caller that knows an exact opening (a crop asked for a
/// board) can name it.
export type CropShape = { label: string; ratio: number };

/// Close enough that a director would call it that format. A 5568×3712 photo is
/// 1.50 and nobody calls it 4:3, so this is tight rather than generous.
export const CROP_SHAPE_TOLERANCE = 0.02;

/// The widest and narrowest a shape may be. Not a rule about photography — a
/// bound on what arrives from a wire, so a label of "9999:1" is a refusal rather
/// than a box one pixel tall.
const CROP_SHAPE_LIMIT = 20;

/// A ratio as the shape it is, said by its name when it is near enough to one.
///
/// Snapping is not cosmetic: the label is what gets stored on the row and shown
/// beside the cut, and a SPLIT panel measured off its slot is 0.999:1, which a
/// director reads as a square and a `cropAspectOf` reads as nothing at all. The
/// snapped shape carries the *named* ratio too, so a cut called 1:1 is 1:1.
export function cropShapeAt(ratio: unknown): CropShape | null {
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) return null;
  if (ratio > CROP_SHAPE_LIMIT || ratio < 1 / CROP_SHAPE_LIMIT) return null;

  for (const id of CROP_ASPECT_IDS) {
    if (Math.abs(ratio - CROP_ASPECTS[id]) / CROP_ASPECTS[id] <= CROP_SHAPE_TOLERANCE) {
      return { label: id, ratio: CROP_ASPECTS[id] };
    }
  }
  return { label: `${ratio.toFixed(2)}:1`, ratio: Number(ratio.toFixed(2)) };
}

/// The shape behind whatever arrived — one of the six names, or a ratio said as
/// one ("3.52:1"). Null for anything else, which is how the empty string, an old
/// column and a made-up format all read as "held to nothing" rather than as a
/// crop held to NaN.
export function cropShapeOf(value: unknown): CropShape | null {
  if (typeof value !== "string") return null;
  const named = cropAspectOf(value);
  if (named) return { label: named, ratio: CROP_ASPECTS[named] };

  const said = /^(\d+(?:\.\d+)?):1$/.exec(value.trim());
  return said ? cropShapeAt(Number(said[1])) : null;
}

/// The model's box at the shape the cut was asked to be: the same region of the
/// same frame, opened up or closed down about its own centre until its *pixels*
/// are that ratio.
///
/// Opened up first, and closed down only when the photograph has no more to give.
/// The box is the model's answer to what has to be in the shot, so reaching a
/// wider shape by taking width from beside the subject keeps that answer, while
/// reaching it by taking height off the subject destroys it — a face fitted to
/// scope by trimming the face is not the crop anybody asked for. When the frame
/// itself runs out, the other edge gives way instead, which is the only way a
/// ratio the frame cannot hold at that size is reachable at all.
///
/// Pixels, not box units: 0-1000 is a share of each edge of a frame that is not
/// square, so equal units are not equal lengths. Which is also why this cannot be
/// left to the prompt — the frame's own dimensions are a thing the row knows and
/// the model was never told.
///
/// Null when there is nothing to fit: no rectangle in the columns, no ratio, or a
/// frame whose pixel size was never recorded. The caller then has a box that is
/// not the shape that was asked for, which is a refusal rather than a silent
/// substitution — a cut filed as 16:9 that is not 16:9 is worse than no cut.
export function cropBoxAtAspect(
  columns: unknown,
  frame: { width?: unknown; height?: unknown },
  ratio: number,
): CropBox | null {
  const box = cropBoxOf(columns);
  const frameWidth = pixelEdge(frame.width);
  const frameHeight = pixelEdge(frame.height);
  if (!box || !frameWidth || !frameHeight) return null;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;

  const unitsToPixels = (units: number, edge: number) => (units / CROP_BOX_SCALE) * edge;
  const left = unitsToPixels(box.xmin, frameWidth);
  const top = unitsToPixels(box.ymin, frameHeight);
  const width = unitsToPixels(box.xmax - box.xmin, frameWidth);
  const height = unitsToPixels(box.ymax - box.ymin, frameHeight);
  if (width <= 0 || height <= 0) return null;

  let fitWidth = width;
  let fitHeight = height;
  if (width / height < ratio) fitWidth = height * ratio;
  else fitHeight = width / ratio;

  /// The frame is the limit on both edges, and clamping one can overrun the
  /// other — a scope box grown to the full width of a tall photograph is then
  /// taller than the photograph is.
  if (fitWidth > frameWidth) {
    fitWidth = frameWidth;
    fitHeight = frameWidth / ratio;
  }
  if (fitHeight > frameHeight) {
    fitHeight = frameHeight;
    fitWidth = frameHeight * ratio;
  }

  /// About the box's own centre, then slid back inside the frame: a subject near
  /// an edge is still that subject, and a box hanging off the photograph would be
  /// clamped into a shape that is no longer the ratio.
  const inside = (start: number, length: number, edge: number) =>
    Math.min(Math.max(0, start), edge - length);
  const fitLeft = inside(left + width / 2 - fitWidth / 2, fitWidth, frameWidth);
  const fitTop = inside(top + height / 2 - fitHeight / 2, fitHeight, frameHeight);

  const toUnits = (pixels: number, edge: number) => Math.round((pixels / edge) * CROP_BOX_SCALE);
  return cropBoxOf([
    toUnits(fitTop, frameHeight),
    toUnits(fitLeft, frameWidth),
    toUnits(fitTop + fitHeight, frameHeight),
    toUnits(fitLeft + fitWidth, frameWidth),
  ]);
}

/// How much of two boxes' union has to be common to both before they are one
/// cut rather than two.
///
/// Overlap of the union, not distance between edges: two boxes ten units apart
/// are the same shot of a wide frame and two different details of a tight one,
/// and only the share they have in common says which. At 95% the pictures the
/// two boxes cut are the same photograph give or take a hair on one edge, which
/// is the point past which a director cannot tell the rows apart.
export const SAME_CUT_OVERLAP = 0.95;

function boxOverlap(a: CropBox, b: CropBox): number {
  const shared =
    Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin)) *
    Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin));
  if (shared <= 0) return 0;

  const area = (box: CropBox) => (box.ymax - box.ymin) * (box.xmax - box.xmin);
  const union = area(a) + area(b) - shared;
  return union > 0 ? shared / union : 0;
}

/// The cut of this frame that a proposed box would be a second copy of, or null
/// when it names a region none of them do.
///
/// The cropper is asked in words and answers at temperature 0.2, so "just the
/// hands" and "the hands" are one box twice over, a unit or two apart. Taken
/// both times, that is two rows of the same photograph under two spellings of
/// the same label, in the one list whose whole job is telling cuts of a frame
/// apart — and each of them costs bytes, a thumbnail, an analysis and a place on
/// the board that agent 4 has to choose between for no reason.
///
/// Said rather than refused. The box is the director's to take: they may be
/// re-cutting a version they are about to delete, or asking again because the
/// first answer was filed under a name they have stopped recognising. What the
/// review owes them is that this is not a new part of the frame.
///
/// The closest match, not the first: the cuts of a frame overlap each other all
/// the time, and the row a director is about to duplicate is the one that shares
/// the most with the offer.
///
/// `except` is the row the offer is an *adjustment of*. A box asked to move a
/// little still overlaps the box it was moved from, so without this the review
/// answers every adjustment with "already cut here", naming the very row the
/// director is holding — which says nothing, and hides the case where the offer
/// has landed on some *other* cut of the frame. Whether the adjustment moved
/// anything at all is a different question, and `sameCut` answers it in its own
/// words.
export function existingCut<Version extends { id?: string; cropBox?: unknown }>(
  columns: unknown,
  versions: readonly Version[] | undefined,
  { except }: { except?: string | null } = {},
): Version | null {
  const offered = cropBoxOf(columns);
  if (!offered || !versions) return null;

  let best: { version: Version; overlap: number } | null = null;
  for (const version of versions) {
    if (except && version.id === except) continue;
    const filed = cropBoxOf(version.cropBox);
    if (!filed) continue;

    const overlap = boxOverlap(offered, filed);
    if (overlap >= SAME_CUT_OVERLAP && (!best || overlap > best.overlap)) {
      best = { version, overlap };
    }
  }
  return best?.version ?? null;
}

/// Whether two boxes name one cut — `existingCut`'s judgement, asked of a pair
/// rather than of a list.
///
/// The adjustment that did not take. A director reads a filed cut, asks for it
/// tighter, and the model answers with the box it already has: the frame does
/// not visibly change, the card reads as a fresh offer, and taking it files a
/// second row of a photograph the frame already holds — under the same label,
/// beside the row it was copied from. This is what lets the review say so.
export function sameCut(columns: unknown, other: unknown): boolean {
  const offered = cropBoxOf(columns);
  const filed = cropBoxOf(other);
  return !!offered && !!filed && boxOverlap(offered, filed) >= SAME_CUT_OVERLAP;
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

  return said(note) === said(versionLabel(version)) ? null : note;
}

/// A line reduced to the words in it. Two labels that differ by a capital, a
/// full stop or a dash are the same thing said twice — which is what has to be
/// noticed both when the cropper repeats the request back as its rationale and
/// when an adjustment is asked for in words the label already carries.
function said(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/// The box the cropper is being asked to move, said back to it in its own
/// numbers — or null when there is no rectangle to move.
///
/// A first answer is rarely the shot. The director reads the box on the frame
/// and what is wrong with it is a nudge — tighter, more headroom, include the
/// lamp — which is a sentence about *that box*, not a fresh description of the
/// frame. Asked without it, the model reads the photograph again from nothing
/// and answers a different question; asked with it, the second call is the
/// adjustment the director actually made.
///
/// Spelled with the edge names rather than as a bare array: the model wrote
/// `[ymin, xmin, ymax, xmax]` on the way out, and naming the numbers on the way
/// back in is what keeps a re-read from transposing them.
export function priorCropNote(previous: {
  cropBox?: unknown;
  editIntent?: string | null;
}): string | null {
  const box = cropBoxOf(previous.cropBox);
  if (!box) return null;

  const edges = `ymin ${box.ymin}, xmin ${box.xmin}, ymax ${box.ymax}, xmax ${box.xmax}`;
  const asked = editIntent(previous.editIntent ?? "");
  const note = `Your previous box for this image was [${edges}] out of ${CROP_BOX_SCALE}`;
  return asked ? `${note}, which you called “${asked}”.` : `${note}.`;
}

/// What a cut is filed under after the director has adjusted it.
///
/// The model's own words first, exactly as on a first ask — but only while they
/// are words that say something the box being moved did not.
///
/// An adjustment files a *new* row and leaves the old one standing, because a
/// cut may be holding up a board. So the two are side by side in the one list
/// whose whole job is telling cuts of a frame apart, and there are two ways they
/// end up under the same words. The model answers nothing, and the label of the
/// box being moved is all that is left. Or — far likelier — it answers what it
/// is asked to answer: the cropper names *what the crop keeps*, and a cut moved
/// tighter on the same subject keeps the same thing, so "the hands" comes back a
/// second time and is filed beside "the hands".
///
/// Either way the nudge is what distinguishes them, and neither the nudge alone
/// nor the label alone can be the answer: a row called "tighter" says nothing
/// about which part of the photograph it is, and a row called "the hands" says
/// nothing about which of this frame's two hand cuts it is. So the label leads
/// and the nudge follows — "the hands — tighter" — which is the order the list
/// is read in. The nudge stands alone only on a first ask the model did not
/// name.
///
/// Not said twice. A director who asks for tighter, looks, and asks for tighter
/// again is moving one box one way, and the label already carries the word. Two
/// *different* nudges do both land — "the hands — tighter — more headroom" is
/// how that box got where it is — bounded, like every other label here, by
/// `EDIT_INTENT_LIMIT`.
export function refinedIntent({
  answered,
  previous = "",
  asked,
}: {
  answered: string;
  previous?: string;
  asked: string;
}): string {
  const own = editIntent(answered);
  const kept = editIntent(previous);
  const nudge = editIntent(asked);

  /// A first ask: the model's own words, else what the director asked for.
  if (!kept) return own || nudge;
  /// The model named a different part of the frame than the box it moved — that
  /// is an answer about this cut, and it already tells the two rows apart.
  if (own && said(own) !== said(kept)) return own;

  if (!nudge || said(kept) === said(nudge) || said(kept).endsWith(` ${said(nudge)}`)) return kept;
  return editIntent(`${kept} — ${nudge}`);
}

/// What a cut is filed under after the director has typed it themselves — or
/// null when there is nothing to file.
///
/// Every label in this list is written by something other than the director, and
/// each of the three writers gets it wrong in its own way. The cropper names what
/// it takes the crop to keep, which is a reading of a frame and is sometimes a
/// reading of the wrong thing in it. An adjusted cut composes that name with the
/// nudges that moved it, so a box walked into place over four asks is filed under
/// four clauses. And every crop drawn on the board carries the one fixed line
/// `BOARD_CROP_INTENT`, so two of them under one frame are two rows saying the
/// same thing. Telling the cuts of one photograph apart is the whole job of the
/// label — they all carry the frame's title plus "(crop N)" — and until it can be
/// typed into, the only remedy for a row that says the wrong thing is deleting a
/// cut that may be holding up a board.
///
/// Null for an empty edit: a cleared field is a cancel, not a clear. A cut with
/// no label falls back to its title, which is the words every other cut of that
/// frame carries — the thing the label exists to say something other than.
///
/// Null too for the label it already has, so a name re-typed as it stands is not
/// a write, an invalidation and a redraw of the list it was typed in. Compared on
/// the stored form rather than through `said()`, unlike the rules above: those
/// ask whether two writers said the same thing, while this is the director fixing
/// a label, and a capital or a full stop is a thing they may be fixing.
export function relabeledIntent(text: string, current: { editIntent?: string | null }) {
  const next = editIntent(text);
  if (!next || next === editIntent(current.editIntent ?? "")) return null;
  return next;
}

/// Every cut of a project and the frame it was cut from, as one read for the
/// whole grid — the same shape, and the same reason, as `analysisByProject`: a
/// tile per photo asking its own question is a round trip per photo.
///
/// The links rather than the counts, because the two questions the gallery asks
/// about the versions it does not show are asked of the same rows: how many cuts
/// a frame has, and — when that frame is about to be deleted — which rows go with
/// it. A count cannot answer the second.
export type VersionLink = { id: string; sourceReferenceId: string };
export type VersionLinkSource = VersionLink[];
export type VersionCountIndex = ReadonlyMap<string, number>;

export function versionCountIndex(source: readonly VersionLink[]): VersionCountIndex {
  const index = new Map<string, number>();
  for (const { sourceReferenceId } of source) {
    index.set(sourceReferenceId, (index.get(sourceReferenceId) ?? 0) + 1);
  }
  return index;
}

/// Every cut below a reference, however deep — what deleting it would take with
/// it. The row's cascade removes a frame's cuts, and the cuts of those, and the
/// bucket objects behind all of them; none of that is recoverable and none of it
/// is on screen where the delete is asked for.
///
/// Depth rather than the one level the tile count reads: the cascade does not
/// stop at the first generation, so neither can the list of what is at stake.
///
/// The frame itself is not in the answer — it is the thing being deleted, and
/// every caller here already holds its id. Rows that name each other cannot be
/// made by anything in this app, but this walks a graph that arrived over the
/// wire: the seen set is what keeps a bad row from hanging the tab.
export function versionDescendants(
  source: readonly VersionLink[],
  referenceId: string,
): string[] {
  const cuts = new Map<string, string[]>();
  for (const { id, sourceReferenceId } of source) {
    const made = cuts.get(sourceReferenceId);
    if (made) made.push(id);
    else cuts.set(sourceReferenceId, [id]);
  }

  const found: string[] = [];
  const seen = new Set([referenceId]);
  const walking = [referenceId];
  while (walking.length) {
    for (const cut of cuts.get(walking.shift()!) ?? []) {
      if (seen.has(cut)) continue;
      seen.add(cut);
      found.push(cut);
      walking.push(cut);
    }
  }
  return found;
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
  return asked ? `${from}${CREDIT_JOIN}${asked}` : from;
}

/// The separator the frame and the shot are joined by, in the credit and in the
/// caption below it.
const CREDIT_JOIN = " — ";

/// Below this there is no room left to name a photograph — "Hall…" is not a
/// title — so the frame gives up its place entirely rather than being cut to a
/// syllable of itself.
const CAPTION_FRAME_MIN = 12;

/// What a reference is called when it is put on the board *as* a caption.
///
/// A photograph is captioned with its title, which is what the director named
/// it. A cut's title is that title with "(crop 2)" after it, which under the
/// picture says it is a piece of something without saying which piece: every cut
/// of one frame captions identically, and the words that tell them apart — what
/// this one keeps — are sitting unused in the row. So a cut is captioned the way
/// `versionCredit` says it, minus the "Cropped from" that the caption's own
/// position under a picture already makes plain.
///
/// The frame gives way first when the pair is too long, because `captionText`
/// truncates from the end and the end is the half that says which cut this is: a
/// long title would otherwise eat the whole caption and leave exactly the
/// generic name this was written to replace.
export function referenceCaption(reference: {
  title?: string | null;
  editIntent?: string | null;
  source?: { title?: string | null } | null;
}): string {
  const title = (reference.title ?? "").trim();
  if (!reference.source) return title;

  const frame = (reference.source.title ?? "").trim();
  const asked = editIntent(reference.editIntent ?? "");
  /// A crop the director drew on the board says where it was made, which is what
  /// tells it apart in the versions list and is of no interest at all under the
  /// picture on a board — nobody said what that cut keeps, so the caption says
  /// what the frame is and stops.
  const keeps = asked && said(asked) !== said(BOARD_CROP_INTENT) ? asked : "";

  if (!keeps) return frame || title;
  /// A cut asked for in the frame's own words is that frame said twice.
  if (!frame || said(frame) === said(keeps)) return keeps;

  const room = CAPTION_MAX_LENGTH - keeps.length - CREDIT_JOIN.length;
  if (room >= frame.length) return `${frame}${CREDIT_JOIN}${keeps}`;
  return room >= CAPTION_FRAME_MIN
    ? `${frame.slice(0, room - 1).trimEnd()}…${CREDIT_JOIN}${keeps}`
    : keeps;
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
