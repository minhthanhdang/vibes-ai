import { contentTypeOfUri } from "./image-types";
import { referenceCanvasImagePath } from "@/server/references/display";

/// The moodboard is an excalidraw scene: an ordered element array plus a slice
/// of UI state. Everything here is the part of that document neither the canvas
/// nor the database has to be running for — what of a client-written scene is
/// safe to store, and how an image on the board points back at the reference it
/// was dragged from.

/// Excalidraw's canvas slows to a crawl well before this; the cap is here so a
/// looping autosave or a hand-written payload cannot grow one row without
/// bound. A board past it is refused, never truncated — silently dropping the
/// tail would delete a director's work and look like a save.
export const MOODBOARD_ELEMENT_LIMIT = 5000;

/// A freedraw stroke is a point list, so element count alone does not bound the
/// row. Two megabytes is a very large board of shapes and far under what
/// Postgres or a tRPC body will complain about.
export const MOODBOARD_SCENE_BYTE_LIMIT = 2_000_000;

/// An image element carries a `fileId` that excalidraw resolves against its
/// files map. Ours names a `Reference` instead of holding bytes: the board
/// stores the pointer and hydrates a signed URL at load, so a board of forty
/// photos is a few kilobytes of JSON rather than eighty megabytes of base64 —
/// and re-cropping or re-uploading nothing keeps the two copies in sync.
export const REFERENCE_FILE_PREFIX = "ref:";

/// Excalidraw's own zoom bounds. A scene reopened with a zero or negative zoom
/// renders nothing and offers no way back, so a stored value out of range is
/// worse than no value at all.
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

export type SceneElement = {
  id: string;
  type: string;
  isDeleted?: boolean;
  fileId?: unknown;
  [key: string]: unknown;
};

export type SceneFile = {
  id: string;
  dataURL: string;
  mimeType: string;
  created: number;
};

/// Which copy of a reference a board image is served with. The policy that
/// decides it lives in `moodboard-resolution.ts`; the name is here because it is
/// part of what a file entry is.
export type BoardImageVariant = "thumb" | "full";

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function referenceFileId(referenceId: string) {
  return `${REFERENCE_FILE_PREFIX}${referenceId}`;
}

/// Null for anything that is not one of our reference pointers — a scene
/// imported from excalidraw.com carries content-hash fileIds, and those name
/// bytes we never stored.
export function referenceIdFromFileId(fileId: unknown): string | null {
  if (typeof fileId !== "string" || !fileId.startsWith(REFERENCE_FILE_PREFIX)) return null;
  const referenceId = fileId.slice(REFERENCE_FILE_PREFIX.length).trim();
  return referenceId.length > 0 ? referenceId : null;
}

/// What of the array excalidraw hands back is worth storing.
///
/// `onChange` reports every element the editor holds, including the tombstones
/// (`isDeleted: true`) it keeps so undo has something to restore. Those are
/// session state, not document state — excalidraw's own export drops them, and
/// keeping them would grow the row forever for a director who draws and erases.
/// Array order is z-order, so it is preserved exactly.
export function persistableElements(input: unknown): SceneElement[] {
  if (!Array.isArray(input)) return [];

  const kept: SceneElement[] = [];
  const seen = new Set<string>();

  for (const entry of input) {
    const element = plainObject(entry);
    if (!element) continue;
    if (element.isDeleted === true) continue;

    const { id, type } = element;
    if (typeof id !== "string" || id.length === 0) continue;
    if (typeof type !== "string" || type.length === 0) continue;
    /// Duplicate ids are not something the editor emits, but a scene pasted
    /// together by hand can hold them and excalidraw renders only one of the
    /// pair — storing both would resurrect the loser on every reload.
    if (seen.has(id)) continue;

    seen.add(id);
    kept.push(element as SceneElement);
  }

  return kept;
}

/// Every reference the board shows, first appearance first. This is what the
/// load turns into signed URLs, so an id appearing on twenty elements is still
/// one row read and one URL.
export function sceneReferenceIds(elements: readonly SceneElement[]): string[] {
  const ids = new Set<string>();
  for (const element of elements) {
    const referenceId = referenceIdFromFileId(element.fileId);
    if (referenceId) ids.add(referenceId);
  }
  return [...ids];
}

/// The excalidraw files map for a board, built from the reference rows its
/// elements point at. `dataURL` is the app's own stable image path rather than
/// a data URI — excalidraw only ever feeds it to an `<img>`, and the path signs
/// a fresh read of the object on every request, so a board left open past a
/// signature's lifetime still renders.
///
/// The board's images are read on the streaming path rather than the redirect
/// one: excalidraw exports a board by drawing it to a canvas and reading the
/// pixels back, and a canvas holding a cross-origin image cannot be read.
///
/// A reference deleted from the gallery simply has no row here; excalidraw
/// draws that element as a placeholder rather than failing the whole load.
///
/// `variants` says which copy of each reference the board's own elements need
/// (see `sceneImageVariants`); anything missing from it gets the original, which
/// is the safe direction to be wrong in. The requested variant is in the URL
/// whether or not the row has a thumbnail — the route falls back to the original
/// for one that has none — so the *type* is read off whichever object will
/// actually be served.
export function sceneFiles(
  references: readonly {
    id: string;
    gcsUri: string;
    thumbGcsUri?: string | null;
    createdAt: Date;
  }[],
  variants?: ReadonlyMap<string, BoardImageVariant>,
): SceneFile[] {
  return references.map((reference) => {
    const wantsThumb = variants?.get(reference.id) === "thumb";
    const served = (wantsThumb ? reference.thumbGcsUri : null) ?? reference.gcsUri;
    return {
      id: referenceFileId(reference.id),
      dataURL: referenceCanvasImagePath(reference.id, wantsThumb ? "thumb" : undefined),
      mimeType: contentTypeOfUri(served) ?? "image/jpeg",
      created: reference.createdAt.getTime(),
    };
  });
}

/// The appState keys worth reopening a board with. Everything excalidraw keeps
/// there that is about *this* session — the current selection, the open dialog,
/// the collaborator Map (which is not even JSON) — is deliberately absent: a
/// board reopened tomorrow should look like the board, not like the moment the
/// last autosave fired.
export const PERSISTED_APP_STATE_KEYS = [
  "viewBackgroundColor",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
  "objectsSnapModeEnabled",
  "zenModeEnabled",
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemStrokeWidth",
  "currentItemStrokeStyle",
  "currentItemRoughness",
  "currentItemOpacity",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemTextAlign",
  "currentItemStartArrowhead",
  "currentItemEndArrowhead",
  "currentItemArrowType",
  "currentItemRoundness",
] as const;

export type PersistedAppState = Record<string, unknown>;

/// Where the director left the canvas. Stored because reopening a board
/// scrolled to the origin, when the work is two screens to the right, reads as
/// an empty board.
function persistedViewport(source: Record<string, unknown>): PersistedAppState {
  const viewport: PersistedAppState = {};

  for (const key of ["scrollX", "scrollY"] as const) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) viewport[key] = value;
  }

  const zoom = plainObject(source.zoom)?.value;
  if (typeof zoom === "number" && Number.isFinite(zoom)) {
    viewport.zoom = { value: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) };
  }

  return viewport;
}

/// Allowlisted rather than filtered: appState is client input on its way into a
/// Json column, and excalidraw adds keys every release. Copying only scalars we
/// named keeps a `collaborators` Map, a DOM node or a megabyte of pasted state
/// out of the row without having to know what any future key is.
export function persistedAppState(input: unknown): PersistedAppState {
  const source = plainObject(input);
  if (!source) return {};

  const state: PersistedAppState = {};
  for (const key of PERSISTED_APP_STATE_KEYS) {
    const value = source[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      state[key] = value;
    }
  }

  return { ...state, ...persistedViewport(source) };
}

/// The size the row would actually take. Checked before the write, so a board
/// too large is refused with the director's copy still in the editor rather
/// than half-written.
export function sceneByteSize(elements: unknown, appState: unknown) {
  return JSON.stringify({ elements, appState }).length;
}

export function exceedsSceneByteLimit(elements: unknown, appState: unknown) {
  return sceneByteSize(elements, appState) > MOODBOARD_SCENE_BYTE_LIMIT;
}
