/// The gallery renders ~220px tiles, so serving originals means a 20-photo
/// project downloads ~100MB to draw a grid. The browser already decodes every
/// file it uploads (to read its pixel size), so the downscale is one extra
/// draw on bytes that are in memory anyway — no server-side image pipeline.
export const THUMBNAIL_MAX_EDGE = 640;
export const THUMBNAIL_CONTENT_TYPE = "image/jpeg";

/// Fits the longest edge into `max` without ever upscaling: a source already
/// inside the box needs no thumbnail at all, and `isNeeded` is what says so.
export function thumbnailBox(width: number, height: number, max = THUMBNAIL_MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    isNeeded: scale < 1,
  };
}

async function renderThumbnail(bitmap: ImageBitmap) {
  const box = thumbnailBox(bitmap.width, bitmap.height);
  if (!box.isNeeded || typeof OffscreenCanvas === "undefined") return null;

  const canvas = new OffscreenCanvas(box.width, box.height);
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(bitmap, 0, 0, box.width, box.height);
  return canvas
    .convertToBlob({ type: THUMBNAIL_CONTENT_TYPE, quality: 0.8 })
    .catch(() => null);
}

/// One decode per file gives both things the upload needs: the real pixel
/// dimensions and the grid-sized copy. A file the browser cannot decode still
/// uploads — it just arrives without either.
export async function readImageForUpload(file: File) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return {};
  }

  try {
    return {
      width: bitmap.width,
      height: bitmap.height,
      thumbnail: await renderThumbnail(bitmap),
    };
  } finally {
    bitmap.close();
  }
}
