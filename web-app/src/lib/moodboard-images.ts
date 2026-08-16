import { isUploadContentType, type UploadContentType } from "./image-types";
import { referenceFileId, referenceIdFromFileId, type SceneElement } from "./moodboard-scene";

/// Images that reach the board by excalidraw's own routes — a clipboard paste,
/// a file dragged off the desktop, the toolbar's image button — rather than by
/// a drag from the sidebar.
///
/// Excalidraw holds those bytes in its in-memory files map, and the board row
/// stores elements and appState only: a pasted photo renders all session and
/// comes back an empty box tomorrow. So every such image is *adopted* — it is
/// uploaded into the project as a `Reference` and its element repointed at the
/// `ref:` id, which is the one shape of image the board knows how to reload.
/// It also puts the image where a director would look for it next: in the
/// project's references, queued for analysis like any other.
///
/// No DOM and no canvas here — this is which images need adopting, whether
/// their bytes are something the project can hold, and what the scene looks
/// like once they have been.

/// A pasted image has no filename to inherit, and an untitled tile appearing in
/// the gallery reads as something having gone wrong.
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

/// Every image on the board whose bytes belong to excalidraw rather than to a
/// reference, each file once — the same photo pasted onto two elements is one
/// upload. Tombstones are skipped: an image pasted and immediately undone is
/// not something to add to the project.
export function unadoptedImages(elements: unknown, files: unknown): BoardImageFile[] {
  const map = plainObject(files);
  if (!Array.isArray(elements) || !map) return [];

  const found = new Map<string, BoardImageFile>();
  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element || element.type !== "image" || element.isDeleted === true) continue;

    const fileId = element.fileId;
    if (typeof fileId !== "string" || fileId.length === 0) continue;
    /// Already a reference: the load hydrates these from the row every time.
    if (referenceIdFromFileId(fileId)) continue;
    if (found.has(fileId)) continue;

    /// An element can name a file the map has not got — excalidraw draws it as
    /// a placeholder — and there are no bytes there to upload.
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

const DATA_URL_HEADER = /^data:([^;,]*)((?:;[^;,]*)*),/;

/// Only base64 payloads are decoded. Excalidraw writes binary image files that
/// way; a percent-encoded one is text (an SVG), and reading that back through
/// character codes would mangle every byte above 0x7f rather than fail — which
/// is worse than not supporting it.
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

/// The upload this board image would become, or null when the project cannot
/// hold it — an SVG or a HEIC, which the gallery's allowlist excludes because
/// nothing downstream of it can decode one. The dataURL's own type wins over
/// the file entry's: it is the header on the bytes we are about to send, and
/// the signed URL is issued for exactly that type.
export function adoptableUpload(
  image: BoardImageFile,
): { contentType: UploadContentType; bytes: Uint8Array<ArrayBuffer> } | null {
  const decoded = decodeDataUrl(image.dataURL);
  if (!decoded) return null;

  const contentType = decoded.contentType || image.mimeType.toLowerCase();
  if (!isUploadContentType(contentType)) return null;

  return { contentType, bytes: decoded.bytes };
}

/// The scene with adopted images repointed at their references. Elements are
/// copied rather than written into: excalidraw hands back the array it renders
/// from, and mutating that changes the scene without the editor knowing.
///
/// Tombstones are rewritten too — undoing back to a pasted image should restore
/// one that still reloads, not the copy that pointed at bytes we never stored.
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
