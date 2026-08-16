/// Shared by the upload form and the signed-URL mutation, so the `accept`
/// attribute and the server's allowlist can never drift apart. HEIC is absent
/// on purpose: phones offer it, no browser renders it, and the gallery has no
/// transcode step.
export const IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
} as const;

export type UploadContentType = keyof typeof IMAGE_EXTENSIONS;

export const UPLOAD_CONTENT_TYPES = Object.keys(IMAGE_EXTENSIONS) as [
  UploadContentType,
  ...UploadContentType[],
];

export function isUploadContentType(type: string): type is UploadContentType {
  return type in IMAGE_EXTENSIONS;
}
