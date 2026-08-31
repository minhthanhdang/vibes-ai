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
import type { EditOp } from "@/lib/edit/edit-ops";
import { readObject } from "@/server/google/storage";
import { applyEdits } from "@/server/references/edits";

const JPEG_QUALITY = Math.round(CROP_JPEG_QUALITY * 100);
const THUMBNAIL_QUALITY = Math.round(THUMBNAIL_JPEG_QUALITY * 100);

export type CutThumbnail = { bytes: Uint8Array; contentType: UploadContentType };

export type Cut = {
  bytes: Uint8Array;
  contentType: UploadContentType;
  width: number;
  height: number;
  thumbnail: CutThumbnail | null;
};

async function encode(image: Sharp, contentType: UploadContentType) {
  const bytes =
    contentType === "image/png"
      ? await image.png().toBuffer()
      : await image.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  return new Uint8Array(bytes);
}

async function decodedSize(image: Sharp) {
  const frame = (await image.metadata()).autoOrient;
  if (!frame?.width || !frame.height) throw new Error("the image could not be decoded");
  return { width: frame.width, height: frame.height };
}

export async function thumbnailOf(
  bytes: Uint8Array,
  size?: { width: number; height: number },
): Promise<{ thumbnail: CutThumbnail | null; width: number; height: number }> {
  const image = sharp(bytes, { autoOrient: true });
  const { width, height } = size ?? (await decodedSize(image));

  const box = thumbnailBox(width, height);
  if (!box.isNeeded) return { thumbnail: null, width, height };

  const scaled = await image
    .resize(box.width, box.height)
    .jpeg({ quality: THUMBNAIL_QUALITY })
    .toBuffer();
  return {
    thumbnail: { bytes: new Uint8Array(scaled), contentType: THUMBNAIL_CONTENT_TYPE },
    width,
    height,
  };
}

export async function cutBytes(
  source: Uint8Array,
  region: CropRegion,
  ops: readonly EditOp[] = [],
): Promise<Cut> {
  const image = sharp(source, { autoOrient: true });
  const metadata = await image.metadata();
  const frame = metadata.autoOrient;
  if (!frame?.width || !frame.height) throw new Error("the image could not be decoded");

  const box = croppedPixels(region, frame);
  const contentType = cropOutputType(`image/${metadata.format}`);
  const bytes = await encode(
    applyEdits(
      image.extract({ left: box.x, top: box.y, width: box.width, height: box.height }),
      ops,
    ),
    contentType,
  );

  const { thumbnail, width, height } = await thumbnailOf(bytes);
  return { bytes, contentType, width, height, thumbnail };
}

export const CUT_SOURCE_BYTE_LIMIT = 100_000_000;

export async function cutFromOriginal(
  gcsUri: string,
  region: CropRegion,
  ops: readonly EditOp[] = [],
): Promise<Cut> {
  return cutBytes(await readObject(gcsUri, CUT_SOURCE_BYTE_LIMIT), region, ops);
}
