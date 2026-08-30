export const THUMBNAIL_MAX_EDGE = 640;
export const THUMBNAIL_CONTENT_TYPE = "image/jpeg";
export const THUMBNAIL_JPEG_QUALITY = 0.8;

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
    .convertToBlob({ type: THUMBNAIL_CONTENT_TYPE, quality: THUMBNAIL_JPEG_QUALITY })
    .catch(() => null);
}

export async function readImageForUpload(file: Blob) {
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
