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

const CONTENT_TYPES_BY_EXTENSION = Object.fromEntries(
  Object.entries(IMAGE_EXTENSIONS).map(([type, extension]) => [extension, type]),
) as Record<string, UploadContentType>;

export function contentTypeOfUri(uri: string) {
  const extension = uri.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES_BY_EXTENSION[extension] ?? null;
}
