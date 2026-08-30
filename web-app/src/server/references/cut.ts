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

export async function cutBytes(source: Uint8Array, region: CropRegion): Promise<Cut> {
  const image = sharp(source, { autoOrient: true });
  const metadata = await image.metadata();
  const frame = metadata.autoOrient;
  if (!frame?.width || !frame.height) throw new Error("the image could not be decoded");

  const box = croppedPixels(region, frame);
  const contentType = cropOutputType(`image/${metadata.format}`);
  const bytes = await encode(
    image.extract({ left: box.x, top: box.y, width: box.width, height: box.height }),
    contentType,
  );

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

export const CUT_SOURCE_BYTE_LIMIT = 100_000_000;

export async function cutFromOriginal(gcsUri: string, region: CropRegion): Promise<Cut> {
  return cutBytes(await readObject(gcsUri, CUT_SOURCE_BYTE_LIMIT), region);
}
