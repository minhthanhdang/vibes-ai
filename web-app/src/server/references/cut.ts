import "server-only";
import sharp, { type Sharp } from "sharp";
import {
  CROP_JPEG_QUALITY,
  cropOutputType,
  croppedPixels,
  type CropRegion,
} from "@/lib/canvas/moodboard-crop";
import {
  THUMBNAIL_CONTENT_TYPE,
  THUMBNAIL_JPEG_QUALITY,
  thumbnailBox,
} from "@/lib/intake/thumbnail";
import type { UploadContentType } from "@/lib/intake/image-types";
import { readObject } from "@/server/google/storage";

/// Cutting a region out of a reference, on the server.
///
/// The browser's `cut-reference.ts` is the same three steps against a canvas,
/// and was for a long time the only place in this app that could cut pixels at
/// all — which is why a crop the assistant made could only be *offered* to a
/// user who then made it. A codec here retires that: a tool can cut and file in
/// the turn it was asked in.
///
/// Only the decode and the encode are new. The arithmetic is the browser's, the
/// same modules verbatim: `croppedPixels` turns the region's fractions into the
/// pixels of the copy being cut, `cropOutputType` picks the encoding,
/// `CROP_JPEG_QUALITY` is the quality. Two doors onto one photograph that
/// rounded a box differently would file two cuts of the same ask that do not
/// match.
///
/// The bytes read are the *original*, never a thumbnail — a crop of a 640px copy
/// is a crop that threw away the resolution it was made to keep, and the region
/// crosses as fractions for exactly that reason.

/// Sharp's quality is 0-100 where a canvas takes 0-1, so both numbers are the
/// browser's own, multiplied. Neither is written out here: the cut's is part of
/// what `hashBytes` digests, so a door encoding at a number of its own files a
/// second row of a cut the project already holds, and the thumbnail's is the
/// weight of every tile ever drawn from it.
const JPEG_QUALITY = Math.round(CROP_JPEG_QUALITY * 100);
const THUMBNAIL_QUALITY = Math.round(THUMBNAIL_JPEG_QUALITY * 100);

/// The grid-sized copy, made in the same pass. A picture the image model draws
/// leaves its row owing one to `useDerivedReferenceCopies`, because nothing on
/// the server could downscale it; a codec that can cut can also resize, so a cut
/// lands complete rather than streaming its full-resolution self into every tile
/// until some tab finishes the job.
export type CutThumbnail = { bytes: Uint8Array; contentType: UploadContentType };

export type Cut = {
  bytes: Uint8Array;
  contentType: UploadContentType;
  width: number;
  height: number;
  /// Null when the cut is already inside the thumbnail box — the same answer
  /// `thumbnailBox` gives an upload that needs no copy.
  thumbnail: CutThumbnail | null;
};

async function encode(image: Sharp, contentType: UploadContentType) {
  const bytes =
    contentType === "image/png"
      ? await image.png().toBuffer()
      : await image.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  return new Uint8Array(bytes);
}

/// The cut of bytes already in hand.
///
/// `autoOrient` is what makes the region mean the same thing here as it does in
/// the browser: `createImageBitmap` applies a photo's EXIF orientation, so the
/// frame every other part of this app measured its fractions against is the
/// upright one. Cutting the stored pixel grid instead would take the wrong
/// quarter of every photo shot in portrait.
export async function cutBytes(source: Uint8Array, region: CropRegion): Promise<Cut> {
  const image = sharp(source, { autoOrient: true });
  const metadata = await image.metadata();
  /// The upright size, which is the one `metadata.width` is not: sharp reports
  /// the stored grid there and the rotated one here.
  const frame = metadata.autoOrient;
  if (!frame?.width || !frame.height) throw new Error("the image could not be decoded");

  const box = croppedPixels(region, frame);
  const contentType = cropOutputType(`image/${metadata.format}`);
  const bytes = await encode(
    image.extract({ left: box.x, top: box.y, width: box.width, height: box.height }),
    contentType,
  );

  /// Downscaled from the cut rather than from the frame, exactly as the browser
  /// does it: the thumbnail is a copy of what was filed, not of what it came
  /// out of.
  const thumb = thumbnailBox(box.width, box.height);
  return {
    bytes,
    contentType,
    width: box.width,
    height: box.height,
    thumbnail: thumb.isNeeded
      ? {
          bytes: new Uint8Array(
            await sharp(bytes)
              .resize(thumb.width, thumb.height)
              .jpeg({ quality: THUMBNAIL_QUALITY })
              .toBuffer(),
          ),
          contentType: THUMBNAIL_CONTENT_TYPE,
        }
      : null,
  };
}

/// How large an original may be to be cut here.
///
/// This is the only place in the app that reads an upload back into a function,
/// and nothing on the way in bounds what an upload weighs — the browser PUTs it
/// straight to GCS against a signed URL (infra §VII), so the first thing that
/// ever holds those bytes is this. Measured, a 108 MP stitched panorama — larger
/// than any camera makes one — weighs 67 MB; past this ceiling a "photograph" is
/// a scan or an assembly of them, and the tool says so and says not to ask again
/// rather than taking the whole turn down with the function.
///
/// Pixels are bounded separately and already: sharp refuses an input past
/// 268402689 of them (16383²) unless told otherwise, which is the number the
/// decode's memory follows.
export const CUT_SOURCE_BYTE_LIMIT = 100_000_000;

export async function cutFromOriginal(gcsUri: string, region: CropRegion): Promise<Cut> {
  return cutBytes(await readObject(gcsUri, CUT_SOURCE_BYTE_LIMIT), region);
}
