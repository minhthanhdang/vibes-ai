import { referenceIdFromFileId, type BoardImageVariant, type SceneElement } from "@/lib/scene/moodboard-scene";
import { THUMBNAIL_MAX_EDGE } from "@/lib/intake/thumbnail";

export const BOARD_IMAGE_PIXEL_RATIO = 2;

export type BoardImage = {
  width?: unknown;
  height?: unknown;
  crop?: unknown;
  [key: string]: unknown;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const size = finite(value);
  return size !== null && size > 0 ? size : null;
}

function croppedSourceEdge(
  element: BoardImage,
  width: number,
  height: number,
  pixelRatio: number,
): number | null {
  const crop = element.crop;
  if (typeof crop !== "object" || crop === null || Array.isArray(crop)) return null;

  const { width: regionWidth, height: regionHeight, naturalWidth, naturalHeight } = crop as Record<
    string,
    unknown
  >;
  const region = { width: positive(regionWidth), height: positive(regionHeight) };
  const natural = { width: positive(naturalWidth), height: positive(naturalHeight) };
  if (!region.width || !region.height || !natural.width || !natural.height) return null;

  const scale = Math.max((width * pixelRatio) / region.width, (height * pixelRatio) / region.height);
  return Math.max(natural.width, natural.height) * scale;
}

export function boardImageSourceEdge(
  element: BoardImage,
  pixelRatio = BOARD_IMAGE_PIXEL_RATIO,
): number | null {
  const width = positive(element.width);
  const height = positive(element.height);
  if (!width || !height) return null;

  return (
    croppedSourceEdge(element, width, height, pixelRatio) ?? Math.max(width, height) * pixelRatio
  );
}

export function boardImageVariant(
  element: BoardImage,
  pixelRatio = BOARD_IMAGE_PIXEL_RATIO,
): BoardImageVariant {
  const edge = boardImageSourceEdge(element, pixelRatio);
  return edge !== null && edge <= THUMBNAIL_MAX_EDGE ? "thumb" : "full";
}

export function sceneImageVariants(
  elements: readonly SceneElement[],
  pixelRatio = BOARD_IMAGE_PIXEL_RATIO,
): Map<string, BoardImageVariant> {
  const variants = new Map<string, BoardImageVariant>();

  for (const element of elements) {
    const referenceId = referenceIdFromFileId(element.fileId);
    if (!referenceId) continue;
    if (variants.get(referenceId) === "full") continue;
    variants.set(referenceId, boardImageVariant(element, pixelRatio));
  }

  return variants;
}
