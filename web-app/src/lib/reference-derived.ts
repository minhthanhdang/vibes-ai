import { thumbnailBox } from "./thumbnail";

/// What a reference still owes after it exists.
///
/// A `Reference` is a row plus two objects: the bytes, and the grid-sized copy
/// beside them. The browser makes the second one — it has already decoded the
/// file to read its pixel size, so the downscale is one extra draw on bytes in
/// memory, and no server-side image pipeline had to exist. Every reference that
/// arrived through the dropzone or through the board's adoption therefore has
/// both, and its pixel size besides.
///
/// A reference imported from a web page has neither. The bytes are fetched by
/// the server (`importFromUrl`), which has no canvas to draw them on, and the
/// dimensions are measured off a *cross-origin* `<img>` — which an origin that
/// blocks hotlinking never loads. So those rows are stored with no thumbnail,
/// and sometimes with no size at all:
///
///   - no thumbnail means every surface that shows the photo streams the
///     original through the app forever. `boardImageVariant` asks for the
///     thumbnail and the route answers with the original, so a board built out
///     of images dragged off Pinterest pulls full-resolution photographs to
///     draw 320-unit tiles — the overdraw §II.6 measured at 137×, back again on
///     the one path that gathers references fastest.
///   - no size means the board lands the photo square, and the gallery has
///     nothing to tell agent 3's boxes apart with.
///
/// Both are recoverable from bytes the browser *can* read: our own copy of the
/// image is same-origin. This is the rule for which rows are worth reading back
/// and what may then be written to them. No DOM, no fetch and no DB here.

/// What the rule reads. The bucket paths never cross the wire, so `forDisplay`
/// says whether the thumbnail exists rather than where it is.
export type DerivableReference = {
  width?: number | null;
  height?: number | null;
  hasThumbnail?: boolean | null;
};

function pixelSize(reference: DerivableReference) {
  const { width, height } = reference;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/// Whether reading the reference's own bytes back would produce anything.
///
/// A row that already has a thumbnail owes nothing, whatever else is missing —
/// the thumbnail is the expensive half and a size without it buys no bytes.
/// A row with no size at all is worth decoding even when the image turns out
/// to be small: the decode is what answers both questions.
export function needsDerivedCopy(reference: DerivableReference) {
  if (reference.hasThumbnail) return false;

  const size = pixelSize(reference);
  if (!size) return true;

  /// An original already inside the box is not missing a thumbnail — it never
  /// had one to miss, and `thumbUrl` falls back to it by design.
  return thumbnailBox(size.width, size.height).isNeeded;
}

/// Whether the derivation has to *finish* before the photo can be placed on the
/// board, rather than running behind it. A missing size is the one thing the
/// placement itself depends on — a photo whose aspect ratio is unknown lands
/// square, and excalidraw's files map is add-only, so the element cannot be
/// corrected later in the session (see `boardImageVariant`). A missing
/// thumbnail costs bandwidth on the next open and nothing on this one.
export function derivationDecidesPlacement(reference: DerivableReference) {
  return needsDerivedCopy(reference) && pixelSize(reference) === null;
}

/// What the browser managed to produce, offered to the row.
export type DerivedOffer = {
  width?: number;
  height?: number;
  thumbGcsUri?: string;
};

export type DerivedWrite = {
  update: { width?: number; height?: number; thumbGcsUri?: string };
  /// Bytes in the bucket that no row will point at, so the caller can throw
  /// them away instead of paying for them forever — the same window `add` and
  /// `discardUpload` handle between a PUT landing and a row landing.
  discard: string | null;
};

/// A derivation only ever *fills in* a reference; it never rewrites one.
///
/// Two tabs can read the same thumbnail-less row back at the same moment, and
/// the analyzer or a later crop may have written a size in between. The stored
/// value is the one that other rows, boards and caches have already been
/// answered with, so the second writer yields — and hands back the object it
/// uploaded, which is now unreferenced.
export function derivedWrite(stored: DerivableReference, offered: DerivedOffer): DerivedWrite {
  const update: DerivedWrite["update"] = {};

  /// Both or neither: half a size is not a size, and a width without a height
  /// would read as a measured reference everywhere that checks one of them.
  const size = pixelSize(offered);
  if (size && !pixelSize(stored)) {
    update.width = size.width;
    update.height = size.height;
  }

  let discard: string | null = null;
  if (offered.thumbGcsUri) {
    if (stored.hasThumbnail) discard = offered.thumbGcsUri;
    else update.thumbGcsUri = offered.thumbGcsUri;
  }

  return { update, discard };
}
