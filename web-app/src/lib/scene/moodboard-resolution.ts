import { referenceIdFromFileId, type BoardImageVariant, type SceneElement } from "@/lib/scene/moodboard-scene";
import { THUMBNAIL_MAX_EDGE } from "@/lib/intake/thumbnail";

/// Which copy of a reference the board needs — the original in the bucket, or
/// the grid-sized one the upload already made.
///
/// A reference is a photograph: 5568×3712 is an ordinary one, and a board draws
/// it at 320 units. Loading the original to fill that is six megabytes to paint
/// sixty kilobytes of pixels, and a board of twenty photos opens by pulling a
/// hundred megabytes through the app's own streaming route (§II.6 made the
/// board's images same-origin so the export canvas is readable, which means
/// every one of those bytes is paid for twice — bucket to function, function to
/// browser). None of it shows on screen; it is the same shape of defect as the
/// tainted export, in the other direction.
///
/// So the size the board draws an image at decides which copy it asks for. No
/// canvas, no DB and no excalidraw here — this is arithmetic on the geometry an
/// element already carries.

/// A scene unit is a CSS pixel at zoom 1, and the displays a moodboard is
/// judged on have two device pixels to each. Two is therefore the factor at
/// which a served copy is *exactly* enough at 100% zoom, and it is also the
/// highest scale excalidraw's export dialog offers below 3×.
export const BOARD_IMAGE_PIXEL_RATIO = 2;

/// Everything the rule reads. Narrower than a `SceneElement` on purpose: the
/// drop asks the same question of an image it is about to create, which has no
/// id yet.
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

/// Excalidraw crops an image by *displaying a region of it*: the element still
/// draws at `width`×`height`, but those pixels come from `crop.width`×
/// `crop.height` of a `naturalWidth`×`naturalHeight` source. A photo cropped to
/// a tenth of its frame therefore needs ten times the source resolution of an
/// uncropped one at the same size on the board — which is exactly the case
/// where serving a thumbnail would be visible.
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

/// The longest edge a served copy must have for this element to draw without
/// being upscaled. Null when the geometry cannot be read at all — which is not
/// "small", so it resolves to the original.
///
/// `pixelRatio` is how many output pixels one scene unit becomes. On the board
/// that is the display's, and it is the default. An *export* is the same
/// question asked of a different output: a 3× PNG draws each unit as three
/// pixels, so the copy that is exactly enough on screen is a third of what the
/// file needs — see `moodboard-export.ts`.
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

/// Which copy each reference on the board needs, first appearance first.
///
/// The *coarsest* requirement wins: one element showing a photo at 320 and
/// another showing the same photo full-bleed is one file entry, and it has to
/// satisfy the second. There is no way to hold two resolutions of one reference
/// at once — excalidraw keys its files map and its decoded-image cache on the
/// `fileId`, and both are add-only, so a file entry is decided once per mount.
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
