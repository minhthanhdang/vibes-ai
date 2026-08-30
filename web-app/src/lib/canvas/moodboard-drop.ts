import { referenceFileId } from "@/lib/scene/moodboard-scene";

export const REFERENCE_DRAG_MIME = "application/x-director-reference";

export const DROPPED_IMAGE_MAX_EDGE = 320;

export const DROPPED_IMAGE_GAP = 24;

export type ReferenceDragItem = {
  referenceId: string;
  width: number | null;
  height: number | null;
};

export type ScenePoint = { x: number; y: number };

export type DroppedImage = {
  type: "image";
  fileId: string;
  status: "saved";
  x: number;
  y: number;
  width: number;
  height: number;
};

export function encodeReferenceDrag(references: readonly ReferenceDragItem[]): string {
  return JSON.stringify({ references });
}

function finiteSize(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function dragItem(entry: unknown): ReferenceDragItem | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  const { referenceId, width, height } = entry as Record<string, unknown>;
  if (typeof referenceId !== "string" || referenceId.trim().length === 0) return null;

  return { referenceId: referenceId.trim(), width: finiteSize(width), height: finiteSize(height) };
}

export function decodeReferenceDrag(raw: string | null | undefined): ReferenceDragItem[] | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { references } = parsed as Record<string, unknown>;
  if (!Array.isArray(references)) return null;

  const items: ReferenceDragItem[] = [];
  const seen = new Set<string>();
  for (const entry of references) {
    const item = dragItem(entry);
    if (!item || seen.has(item.referenceId)) continue;
    seen.add(item.referenceId);
    items.push(item);
  }

  return items.length > 0 ? items : null;
}

export function referenceDragItem(
  reference: { id: string; width?: number | null; height?: number | null },
  drawn?: { naturalWidth?: number; naturalHeight?: number } | null,
): ReferenceDragItem {
  return {
    referenceId: reference.id,
    width: finiteSize(reference.width) ?? finiteSize(drawn?.naturalWidth),
    height: finiteSize(reference.height) ?? finiteSize(drawn?.naturalHeight),
  };
}

export function draggedReferenceIds(
  ordered: readonly string[],
  selected: readonly string[],
  draggedId: string,
): string[] {
  if (!selected.includes(draggedId)) return [draggedId];
  const wanted = new Set(selected);
  return ordered.filter((id) => wanted.has(id));
}

export function toggledDragSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id];
}

export function carriesReferenceDrag(types: readonly string[] | undefined): boolean {
  return types?.includes(REFERENCE_DRAG_MIME) ?? false;
}

export function droppedImageSize(width: number | null, height: number | null) {
  const naturalWidth = finiteSize(width);
  const naturalHeight = finiteSize(height);
  if (!naturalWidth || !naturalHeight) {
    return { width: DROPPED_IMAGE_MAX_EDGE, height: DROPPED_IMAGE_MAX_EDGE };
  }

  const scale = DROPPED_IMAGE_MAX_EDGE / Math.max(naturalWidth, naturalHeight);
  return {
    width: Math.round(naturalWidth * scale * 100) / 100,
    height: Math.round(naturalHeight * scale * 100) / 100,
  };
}

export function scenePointOfDrop(
  viewport: { clientX: number; clientY: number },
  canvas: {
    offsetLeft: number;
    offsetTop: number;
    scrollX: number;
    scrollY: number;
    zoom: number;
  },
): ScenePoint {
  const zoom = finiteSize(canvas.zoom) ?? 1;
  return {
    x: (viewport.clientX - canvas.offsetLeft) / zoom - canvas.scrollX,
    y: (viewport.clientY - canvas.offsetTop) / zoom - canvas.scrollY,
  };
}

export function scenePointOfViewportCentre(canvas: {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
}): ScenePoint {
  return scenePointOfDrop(
    { clientX: canvas.offsetLeft + canvas.width / 2, clientY: canvas.offsetTop + canvas.height / 2 },
    canvas,
  );
}

export function droppedImage(reference: ReferenceDragItem, at: ScenePoint): DroppedImage {
  const { width, height } = droppedImageSize(reference.width, reference.height);
  return {
    type: "image",
    fileId: referenceFileId(reference.referenceId),
    status: "saved",
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
  };
}

export function droppedImageGrid(count: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(count, 1))));
  return { columns, rows: Math.max(1, Math.ceil(Math.max(count, 1) / columns)) };
}

export function droppedImages(
  references: readonly ReferenceDragItem[],
  at: ScenePoint,
): DroppedImage[] {
  const { columns, rows } = droppedImageGrid(references.length);
  const cell = DROPPED_IMAGE_MAX_EDGE + DROPPED_IMAGE_GAP;
  const top = at.y - ((rows - 1) * cell) / 2;

  return references.map((reference, index) => {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, references.length - row * columns);
    return droppedImage(reference, {
      x: at.x - ((inRow - 1) * cell) / 2 + (index % columns) * cell,
      y: top + row * cell,
    });
  });
}
