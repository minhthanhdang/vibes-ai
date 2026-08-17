"use client";

import { IMAGE_EXTENSIONS, type UploadContentType } from "@/lib/intake/image-types";
import { CROP_JPEG_QUALITY, cropOutputType, croppedPixels, type CropRegion } from "@/lib/canvas/moodboard-crop";
import { referenceCanvasImagePath } from "@/server/references/display";

/// Cutting a region out of a reference, in the browser.
///
/// There is no server-side image pipeline in this app (§II.6), so this is where
/// every crop is made — the one the user drew on the board, and the one
/// agent 3 answered with. Both arrive as fractions of the frame, which is the
/// only reading that survives not knowing which copy of it was on screen.
///
/// The bytes are read from the *original*, through this app's own image route.
/// Same-origin, which is why the canvas that drew them can be read back at all,
/// and the original rather than whatever copy is showing, because a crop of a
/// 640px thumbnail is a crop that threw away the resolution it was made to keep.

export type Cut = { file: File; contentType: UploadContentType };

/// Null rather than a throw for the two cases that are not failures of this
/// app: a browser with no `OffscreenCanvas`, and a file it cannot decode. The
/// caller has to say so — nothing on screen would otherwise report that no
/// crop was made.
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
    /// The region crossed as fractions precisely so it could be applied here:
    /// these are the pixels of the copy it is being cut out of.
    const box = croppedPixels(region, { width: bitmap.width, height: bitmap.height });
    const contentType = cropOutputType(blob.type);

    const canvas = new OffscreenCanvas(box.width, box.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);

    const cut = await canvas.convertToBlob({ type: contentType, quality: CROP_JPEG_QUALITY });
    return {
      /// Named for the type, like every other upload here: the signed URL is for
      /// a content type and a crop has no filename of its own.
      file: new File([cut], `crop.${IMAGE_EXTENSIONS[contentType]}`, { type: contentType }),
      contentType,
    };
  } finally {
    bitmap.close();
  }
}
