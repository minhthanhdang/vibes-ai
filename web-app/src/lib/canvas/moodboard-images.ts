import { isUploadContentType, type UploadContentType } from "@/lib/intake/image-types";
import { referenceFileId, referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

export const ADOPTED_IMAGE_TITLE = "Board image";

export type BoardImageFile = {
  fileId: string;
  dataURL: string;
  mimeType: string;
};

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function unadoptedImages(elements: unknown, files: unknown): BoardImageFile[] {
  const map = plainObject(files);
  if (!Array.isArray(elements) || !map) return [];

  const found = new Map<string, BoardImageFile>();
  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element || element.type !== "image" || element.isDeleted === true) continue;

    const fileId = element.fileId;
    if (typeof fileId !== "string" || fileId.length === 0) continue;
    if (referenceIdFromFileId(fileId)) continue;
    if (found.has(fileId)) continue;

    const file = plainObject(map[fileId]);
    const dataURL = file?.dataURL;
    if (typeof dataURL !== "string") continue;

    found.set(fileId, {
      fileId,
      dataURL,
      mimeType: typeof file?.mimeType === "string" ? file.mimeType : "",
    });
  }

  return [...found.values()];
}

export const REFERENCE_LOCATE_LIMIT = 500;

export function unresolvedReferenceIds(elements: unknown, known: ReadonlySet<string>): string[] {
  if (!Array.isArray(elements)) return [];

  const ids = new Set<string>();
  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element || element.type !== "image" || element.isDeleted === true) continue;

    const referenceId = referenceIdFromFileId(element.fileId);
    if (referenceId && !known.has(referenceId)) ids.add(referenceId);
  }
  return [...ids];
}

const DATA_URL_HEADER = /^data:([^;,]*)((?:;[^;,]*)*),/;

export function decodeDataUrl(
  dataURL: unknown,
): { contentType: string; bytes: Uint8Array<ArrayBuffer> } | null {
  if (typeof dataURL !== "string") return null;
  const header = DATA_URL_HEADER.exec(dataURL);
  if (!header) return null;
  if (!(header[2] ?? "").split(";").includes("base64")) return null;

  try {
    const binary = atob(dataURL.slice(header[0].length));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { contentType: (header[1] ?? "").toLowerCase(), bytes };
  } catch {
    return null;
  }
}

export function adoptableUpload(
  image: BoardImageFile,
): { contentType: UploadContentType; bytes: Uint8Array<ArrayBuffer> } | null {
  const decoded = decodeDataUrl(image.dataURL);
  if (!decoded) return null;

  const contentType = decoded.contentType || image.mimeType.toLowerCase();
  if (!isUploadContentType(contentType)) return null;

  return { contentType, bytes: decoded.bytes };
}

export function withAdoptedFileIds(
  elements: unknown,
  adopted: ReadonlyMap<string, string>,
): SceneElement[] {
  if (!Array.isArray(elements)) return [];

  return elements.map((entry) => {
    const element = plainObject(entry);
    if (!element) return entry as SceneElement;

    const fileId = element.fileId;
    const referenceId = typeof fileId === "string" ? adopted.get(fileId) : undefined;
    if (!referenceId) return entry as SceneElement;

    return { ...element, fileId: referenceFileId(referenceId) } as SceneElement;
  });
}
