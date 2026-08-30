"use client";

import { IMAGE_EXTENSIONS, type UploadContentType } from "@/lib/intake/image-types";
import { CROP_JPEG_QUALITY, cropOutputType, croppedPixels, type CropRegion } from "@/lib/canvas/moodboard-crop";
import { referenceCanvasImagePath } from "@/server/references/display";

export type Cut = { file: File; contentType: UploadContentType };

export async function cutFromOriginal(
  referenceId: string,
  region: CropRegion,
): Promise<Cut | null> {
  if (typeof OffscreenCanvas === "undefined") return null;

  const response = await fetch(referenceCanvasImagePath(referenceId));
  if (!response.ok) throw new Error(`read failed (${response.status})`);

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const box = croppedPixels(region, { width: bitmap.width, height: bitmap.height });
    const contentType = cropOutputType(blob.type);

    const canvas = new OffscreenCanvas(box.width, box.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);

    const cut = await canvas.convertToBlob({ type: contentType, quality: CROP_JPEG_QUALITY });
    return {
      file: new File([cut], `crop.${IMAGE_EXTENSIONS[contentType]}`, { type: contentType }),
      contentType,
    };
  } finally {
    bitmap.close();
  }
}
