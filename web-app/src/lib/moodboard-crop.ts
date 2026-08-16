import { isUploadContentType, type UploadContentType } from "./image-types";
import { referenceIdFromFileId, type SceneElement } from "./moodboard-scene";
import { selectedElementIds } from "./moodboard-selection";

/// Keeping a crop the director made on the board.
///
/// Excalidraw crops an image by *showing a region of it*: the element keeps the
/// whole photo behind it and draws a window onto it. That is the right model for
/// a canvas — the crop is undoable and adjustable forever — and the wrong one for
/// everything the crop is actually about. "This part of this frame is the shot"
/// is the judgement a moodboard exists to record, and as an element field it is
/// invisible to the project: the gallery still shows the whole frame, agent 2
/// still reads a palette off the parts the director cut away, a deck built from
/// the board's references gets the wide shot, and the board pays for the full
/// source on every open because a window onto a tenth of a photo needs ten times
/// the resolution (see `moodboard-resolution.ts`).
///
/// So a crop can be *kept*: the region becomes a `Reference` of its own and the
/// element is repointed at it. Nothing moves on the board — the element's box is
/// exactly the box that was showing that region — and from then on the crop is a
/// modified version of that frame, filed under its properties beside agent 3's
/// cuts of the same photograph rather than in the gallery of photographs.
///
/// The element's other transforms are not part of the crop and stay on the
/// element: `angle` is where the photo sits on the board, and `scale` — the flip
/// — is written by excalidraw in *unflipped source coordinates*, so the region
/// named here is a rectangle of the true photograph either way. Keeping both on
/// the element is what makes the repoint invisible: the same box, the same
/// angle, the same flip, drawn from a file that is only the part being shown.
///
/// No canvas, no fetch and no excalidraw here: this is what a crop *is*, as
/// arithmetic on the fields an element already carries.

/// A crop's region, as fractions of the source rather than as pixels.
///
/// This is the whole reason the module exists in this shape. `crop.naturalWidth`
/// is the size of the copy the *editor* loaded, and §II.6 serves the board a
/// 640px thumbnail whenever that is enough — so a crop's pixel coordinates are
/// coordinates in whichever copy happened to be on screen. Fractions are the one
/// reading that survives being applied to the original, which is what the kept
/// crop is cut from.
export type CropRegion = { x: number; y: number; width: number; height: number };

/// How much of an edge has to be trimmed before it is a crop at all. Excalidraw
/// writes a `crop` object on every element that has ever been in crop mode,
/// including one dragged back out to its full frame, and offering to "keep" a
/// crop that is the photo would produce a second copy of it.
export const CROP_MIN_TRIM = 0.005;

/// What the kept crop is encoded as. PNG stays PNG because it may carry
/// transparency; everything else — JPEG, WebP, AVIF, and a GIF, of which a crop
/// is a still — becomes the JPEG the upload path already produces. Quality is
/// well above the thumbnail's 0.8: this is the photograph now, not a preview of
/// one.
export const CROP_JPEG_QUALITY = 0.92;

export function cropOutputType(sourceType: string): UploadContentType {
  const type = sourceType.toLowerCase().split(";")[0]?.trim() ?? "";
  return isUploadContentType(type) && type === "image/png" ? "image/png" : "image/jpeg";
}

/// The reference title limit the server enforces (`reference.add`).
export const CROP_TITLE_LIMIT = 200;

const CROP_SUFFIX = /\s*\(crop(?:\s+(\d+))?\)$/i;

/// A kept crop is named after the photo it came out of, because that is how the
/// director will look for it — and cropping a crop increments rather than stacks
/// the suffix, so "the still (crop 2)" is still recognisably the same frame. The
/// base is what gets cut to fit, never the suffix: a name that no longer says it
/// is a crop is a row the director cannot place beside the original.
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

/// What region of its source an element shows, or null when it shows all of it.
///
/// Unreadable geometry reads as no crop rather than as some crop: the safe
/// direction is leaving the element pointing at the whole photo, which is what
/// it is already drawing.
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

/// The region as whole pixels of a source of this size, clamped inside it.
///
/// `source` is the *original*'s dimensions, which is why the region crossed as
/// fractions: a crop read off a 640px thumbnail is cut out of a 5568px
/// photograph, and rounding is the only thing that happens here.
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

/// One crop the director could keep: the element showing it, and the reference
/// it is a region of.
export type CroppablePhoto = {
  elementId: string;
  referenceId: string;
  region: CropRegion;
};

/// The selected photos that are showing a crop of a project reference.
///
/// A locked element is skipped for the same reason the tidy skips one: locked
/// means "not by accident", and repointing it at a different photo is exactly
/// that. An image whose `fileId` is not a `ref:` pointer is excalidraw's own
/// bytes and is adoption's to deal with first — until it is a reference, there is
/// nothing to cut a crop out of.
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

/// Which element the editor is in crop mode on, as a value that can be compared.
///
/// A crop does not change the selection, so the offer to keep one cannot be
/// derived on the selection alone — a director who crops the photo they already
/// had selected would see nothing appear. Leaving crop mode changes this, which
/// is the moment the crop becomes final, and it is a scalar rather than a walk of
/// the scene so a drag inside crop mode still costs nothing.
export function croppingElementId(appState: unknown): string {
  const id = plainObject(appState)?.croppingElementId;
  return typeof id === "string" ? id : "";
}
