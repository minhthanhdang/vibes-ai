import { contentTypeOfUri } from "@/lib/intake/image-types";
import { referenceCanvasImagePath } from "@/server/references/display";

export const MOODBOARD_ELEMENT_LIMIT = 5000;

export const MOODBOARD_SCENE_BYTE_LIMIT = 2_000_000;

export const REFERENCE_FILE_PREFIX = "ref:";

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

export type BoardImageVariant = "thumb" | "full";

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function referenceFileId(referenceId: string) {
  return `${REFERENCE_FILE_PREFIX}${referenceId}`;
}

export function referenceIdFromFileId(fileId: unknown): string | null {
  if (typeof fileId !== "string" || !fileId.startsWith(REFERENCE_FILE_PREFIX)) return null;
  const referenceId = fileId.slice(REFERENCE_FILE_PREFIX.length).trim();
  return referenceId.length > 0 ? referenceId : null;
}

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
    if (seen.has(id)) continue;

    seen.add(id);
    kept.push(element as SceneElement);
  }

  return kept;
}

export function sceneReferenceIds(elements: readonly SceneElement[]): string[] {
  const ids = new Set<string>();
  for (const element of elements) {
    const referenceId = referenceIdFromFileId(element.fileId);
    if (referenceId) ids.add(referenceId);
  }
  return [...ids];
}

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

export function sceneByteSize(elements: unknown, appState: unknown) {
  return JSON.stringify({ elements, appState }).length;
}

export function exceedsSceneByteLimit(elements: unknown, appState: unknown) {
  return sceneByteSize(elements, appState) > MOODBOARD_SCENE_BYTE_LIMIT;
}
