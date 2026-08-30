import { isUploadContentType, type UploadContentType } from "@/lib/intake/image-types";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";
import { selectedElementIds } from "@/lib/canvas/moodboard-selection";

export type CropRegion = { x: number; y: number; width: number; height: number };

export const CROP_MIN_TRIM = 0.005;

export const CROP_JPEG_QUALITY = 0.92;

export function cropOutputType(sourceType: string): UploadContentType {
  const type = sourceType.toLowerCase().split(";")[0]?.trim() ?? "";
  return isUploadContentType(type) && type === "image/png" ? "image/png" : "image/jpeg";
}

export const CROP_TITLE_LIMIT = 200;

const CROP_SUFFIX = /\s*\(crop(?:\s+(\d+))?\)$/i;

export function croppedReferenceTitle(sourceTitle: string): string {
  const title = sourceTitle.trim();
  const previous = CROP_SUFFIX.exec(title);
  const base = title.replace(CROP_SUFFIX, "").trim() || "Reference";
  const next = previous ? Math.max(2, Number(previous[1] ?? 1) + 1) : 1;
  const suffix = next === 1 ? " (crop)" : ` (crop ${next})`;

  return `${base.slice(0, CROP_TITLE_LIMIT - suffix.length).trim()}${suffix}`;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const size = finite(value);
  return size !== null && size > 0 ? size : null;
}

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function cropRegion(element: unknown): CropRegion | null {
  const crop = plainObject(plainObject(element)?.crop);
  if (!crop) return null;

  const natural = { width: positive(crop.naturalWidth), height: positive(crop.naturalHeight) };
  const region = { width: positive(crop.width), height: positive(crop.height) };
  const origin = { x: finite(crop.x), y: finite(crop.y) };
  if (!natural.width || !natural.height || !region.width || !region.height) return null;
  if (origin.x === null || origin.y === null) return null;

  const fraction = {
    x: origin.x / natural.width,
    y: origin.y / natural.height,
    width: region.width / natural.width,
    height: region.height / natural.height,
  };
  const trimmed = fraction.width < 1 - CROP_MIN_TRIM || fraction.height < 1 - CROP_MIN_TRIM;
  return trimmed ? fraction : null;
}

export function croppedPixels(region: CropRegion, source: { width: number; height: number }) {
  const width = Math.max(1, Math.round(source.width));
  const height = Math.max(1, Math.round(source.height));

  const x = Math.min(Math.max(0, Math.round(region.x * width)), width - 1);
  const y = Math.min(Math.max(0, Math.round(region.y * height)), height - 1);

  return {
    x,
    y,
    width: Math.min(Math.max(1, Math.round(region.width * width)), width - x),
    height: Math.min(Math.max(1, Math.round(region.height * height)), height - y),
  };
}

export type CroppablePhoto = {
  elementId: string;
  referenceId: string;
  region: CropRegion;
};

export function croppablePhotos(elements: unknown, appState: unknown): CroppablePhoto[] {
  const selected = new Set(selectedElementIds(appState));
  if (selected.size === 0 || !Array.isArray(elements)) return [];

  const photos: CroppablePhoto[] = [];
  for (const entry of elements) {
    const element = plainObject(entry) as SceneElement | null;
    if (!element || element.isDeleted === true || element.locked === true) continue;
    if (element.type !== "image" || typeof element.id !== "string") continue;
    if (!selected.has(element.id)) continue;

    const referenceId = referenceIdFromFileId(element.fileId);
    const region = cropRegion(element);
    if (!referenceId || !region) continue;

    photos.push({ elementId: element.id, referenceId, region });
  }

  return photos;
}

export function croppingElementId(appState: unknown): string {
  const id = plainObject(appState)?.croppingElementId;
  return typeof id === "string" ? id : "";
}
