import { ReferenceOrigin } from "@/generated/prisma/enums";
import { CAPTION_MAX_LENGTH } from "@/lib/canvas/moodboard-caption";
import {
  CROP_MIN_TRIM,
  croppedPixels,
  croppedReferenceTitle,
  type CropRegion,
} from "@/lib/canvas/moodboard-crop";
import { DROPPED_IMAGE_MAX_EDGE } from "@/lib/canvas/moodboard-drop";
import { BOARD_IMAGE_PIXEL_RATIO } from "@/lib/scene/moodboard-resolution";

export const CROP_BOX_SCALE = 1000;

export type CropBox = { ymin: number; xmin: number; ymax: number; xmax: number };

export const CROP_MIN_SIDE = 0.02;

function boxSide(min: unknown, max: unknown): [number, number] | null {
  if (typeof min !== "number" || typeof max !== "number") return null;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  const low = Math.round(Math.min(min, max));
  const high = Math.round(Math.max(min, max));
  if (high <= 0 || low >= CROP_BOX_SCALE) return null;

  return [Math.max(0, low), Math.min(CROP_BOX_SCALE, high)];
}

export function cropBoxOf(value: unknown): CropBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;

  const vertical = boxSide(value[0], value[2]);
  const horizontal = boxSide(value[1], value[3]);
  if (!vertical || !horizontal) return null;

  const [ymin, ymax] = vertical;
  const [xmin, xmax] = horizontal;
  return { ymin, xmin, ymax, xmax };
}

export function cropBoxColumns(box: CropBox): number[] {
  return [box.ymin, box.xmin, box.ymax, box.xmax];
}

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

  const trimmed = region.width < 1 - CROP_MIN_TRIM || region.height < 1 - CROP_MIN_TRIM;
  return trimmed ? region : null;
}

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

export function cropCoverageLabel(columns: unknown): string | null {
  const box = cropBoxOf(columns);
  if (!box) return null;

  const area =
    ((box.ymax - box.ymin) / CROP_BOX_SCALE) * ((box.xmax - box.xmin) / CROP_BOX_SCALE);
  if (area <= 0) return null;

  const percent = Math.round(area * 100);
  return `Keeps ${percent < 1 ? "under 1" : percent}% of the frame`;
}

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

export function cropShapeMeasured(
  columns: unknown,
  frame: { width?: unknown; height?: unknown },
): string | null {
  const cut = cropPixelSize(columns, frame);
  return cut && cut.height > 0 ? (cropShapeAt(cut.width / cut.height)?.label ?? null) : null;
}

export function cropSizeLabel(
  columns: unknown,
  frame: { width?: unknown; height?: unknown },
): string | null {
  const size = cropPixelSize(columns, frame);
  return size ? `About ${size.width} × ${size.height} px` : null;
}

export const BOARD_SOURCE_EDGE = DROPPED_IMAGE_MAX_EDGE * BOARD_IMAGE_PIXEL_RATIO;

export function cropSoftOnBoard(
  columns: unknown,
  frame: { width?: unknown; height?: unknown },
): boolean {
  const size = cropPixelSize(columns, frame);
  return !!size && Math.max(size.width, size.height) < BOARD_SOURCE_EDGE;
}

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

export function cropAspectOf(id: unknown): CropAspectId | null {
  return typeof id === "string" && id in CROP_ASPECTS ? (id as CropAspectId) : null;
}

export function cropAspectRatio(id: unknown): number | null {
  const aspect = cropAspectOf(id);
  return aspect ? CROP_ASPECTS[aspect] : null;
}

export type CropShape = { label: string; ratio: number };

export const CROP_SHAPE_TOLERANCE = 0.02;

const CROP_SHAPE_LIMIT = 20;

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

export function cropShapeOf(value: unknown): CropShape | null {
  if (typeof value !== "string") return null;
  const named = cropAspectOf(value);
  if (named) return { label: named, ratio: CROP_ASPECTS[named] };

  const said = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!said) return null;
  const height = Number(said[2]);
  return height > 0 ? cropShapeAt(Number(said[1]) / height) : null;
}

export type LooseShape = {
  id: string;
  wants: string;
  label: string;
  holds: (ratio: number) => boolean;
  missed: (ratio: number) => string;
};

export const LOOSE_SQUARE = 1.15;
export const LOOSE_OBLONG = 1.2;

function ratioSaid(ratio: number) {
  return cropShapeAt(ratio)?.label ?? `${ratio.toFixed(2)}:1`;
}

function looseShape(
  id: string,
  label: string,
  wants: string,
  holds: (ratio: number) => boolean,
): LooseShape {
  return {
    id,
    label,
    wants,
    holds,
    missed: (ratio) =>
      `that box is ${ratioSaid(ratio)}, which is not ${wants}. Answer with a box on the same subject that is.`,
  };
}

const LOOSE_SHAPES: Record<string, LooseShape> = {
  square: looseShape(
    "square",
    "Roughly square",
    "roughly square — about as wide as it is tall",
    (ratio) => ratio <= LOOSE_SQUARE && ratio >= 1 / LOOSE_SQUARE,
  ),
  landscape: looseShape(
    "landscape",
    "Landscape",
    "a landscape rectangle — clearly wider than it is tall",
    (ratio) => ratio >= LOOSE_OBLONG,
  ),
  portrait: looseShape(
    "portrait",
    "Portrait",
    "a portrait rectangle — clearly taller than it is wide",
    (ratio) => ratio <= 1 / LOOSE_OBLONG,
  ),
  rectangle: looseShape(
    "rectangle",
    "Rectangle",
    "a rectangle rather than a square — clearly longer on one edge than the other",
    (ratio) => ratio >= LOOSE_OBLONG || ratio <= 1 / LOOSE_OBLONG,
  ),
};

export const LOOSE_SHAPE_IDS = Object.keys(LOOSE_SHAPES);

export function looseShapeOf(value: unknown): LooseShape | null {
  if (typeof value !== "string") return null;
  return LOOSE_SHAPES[value.trim().toLowerCase()] ?? null;
}

export type ShapeAsked = {
  label: string;
  shape: CropShape | null;
  loose: LooseShape | null;
};

export function shapeAsked(value: unknown): ShapeAsked | null {
  const shape = cropShapeOf(value);
  if (shape) return { label: shape.label, shape, loose: null };
  const loose = looseShapeOf(value);
  return loose ? { label: loose.label, shape: null, loose } : null;
}

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

  if (fitWidth > frameWidth) {
    fitWidth = frameWidth;
    fitHeight = frameWidth / ratio;
  }
  if (fitHeight > frameHeight) {
    fitHeight = frameHeight;
    fitWidth = frameHeight * ratio;
  }

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

export function sameCut(columns: unknown, other: unknown): boolean {
  const offered = cropBoxOf(columns);
  const filed = cropBoxOf(other);
  return !!offered && !!filed && boxOverlap(offered, filed) >= SAME_CUT_OVERLAP;
}

export const EDIT_INTENT_LIMIT = 200;

export function editIntent(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, EDIT_INTENT_LIMIT);
}

export const EDIT_RATIONALE_LIMIT = 400;

export function editRationale(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, EDIT_RATIONALE_LIMIT);
}

export const BOARD_CROP_INTENT = "Cropped on the board";

export function versionLabel(version: { editIntent?: string | null; title?: string | null }) {
  return editIntent(version.editIntent ?? "") || (version.title ?? "").trim() || "Crop";
}

export function versionNote(version: {
  editIntent?: string | null;
  title?: string | null;
  editRationale?: string | null;
}) {
  const note = editRationale(version.editRationale ?? "");
  if (!note) return null;

  return said(note) === said(versionLabel(version)) ? null : note;
}

function said(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

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

  if (!kept) return own || nudge;
  if (own && said(own) !== said(kept)) return own;

  if (!nudge || said(kept) === said(nudge) || said(kept).endsWith(` ${said(nudge)}`)) return kept;
  return editIntent(`${kept} — ${nudge}`);
}

export function relabeledIntent(text: string, current: { editIntent?: string | null }) {
  const next = editIntent(text);
  if (!next || next === editIntent(current.editIntent ?? "")) return null;
  return next;
}

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

export function versionCountLabel(count: number | undefined) {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1) return null;
  const cuts = Math.floor(count);
  return cuts === 1 ? "1 crop" : `${cuts} crops`;
}

export function versionCredit(reference: {
  editIntent?: string | null;
  source?: { title?: string | null } | null;
}) {
  if (!reference.source) return null;

  const frame = (reference.source.title ?? "").trim();
  const asked = editIntent(reference.editIntent ?? "");
  const from = `Cropped from ${frame ? `“${frame}”` : "the original"}`;
  return asked ? `${from}${CREDIT_JOIN}${asked}` : from;
}

const CREDIT_JOIN = " — ";

const CAPTION_FRAME_MIN = 12;

export function referenceCaption(reference: {
  title?: string | null;
  editIntent?: string | null;
  source?: { title?: string | null } | null;
}): string {
  const title = (reference.title ?? "").trim();
  if (!reference.source) return title;

  const frame = (reference.source.title ?? "").trim();
  const asked = editIntent(reference.editIntent ?? "");
  const keeps = asked && said(asked) !== said(BOARD_CROP_INTENT) ? asked : "";

  if (!keeps) return frame || title;
  if (!frame || said(frame) === said(keeps)) return keeps;

  const room = CAPTION_MAX_LENGTH - keeps.length - CREDIT_JOIN.length;
  if (room >= frame.length) return `${frame}${CREDIT_JOIN}${keeps}`;
  return room >= CAPTION_FRAME_MIN
    ? `${frame.slice(0, room - 1).trimEnd()}…${CREDIT_JOIN}${keeps}`
    : keeps;
}

export type CropPlan = {
  region: CropRegion;
  title: string;
  editIntent: string;
  editRationale: string;
  cropBox: number[];
};

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

export function versionOrigin(source: { origin?: ReferenceOrigin | null }): ReferenceOrigin {
  return source.origin ?? ReferenceOrigin.UPLOADED;
}
