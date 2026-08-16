import { referenceFileId } from "./moodboard-scene";

/// Dragging a reference from the sidebar onto the board. What crosses the
/// drag is an id and a shape, never bytes — the element that lands points at
/// the same `Reference` row the sidebar tile does, so the board costs a
/// pointer and the photo is still one object in the bucket.
///
/// None of this needs the canvas or the DOM: a drag is a payload, a viewport
/// point and a zoom, and what comes out is where an image belongs in scene
/// coordinates.

/// Our own type rather than `text/plain`: a drag carrying it is unambiguously
/// ours, so a URL or a file dragged in from the desktop still reaches
/// excalidraw's own handler untouched.
export const REFERENCE_DRAG_MIME = "application/x-director-reference";

/// The longest edge a dropped image gets, in scene units. Every reference
/// lands the same size regardless of whether it was shot at 6000px or saved
/// from a contact sheet — a moodboard is about arrangement, and a drop that
/// covered the whole canvas would have to be resized before it could be
/// placed.
export const DROPPED_IMAGE_MAX_EDGE = 320;

/// The space between two images of a multi-reference drop. Enough that the
/// grid reads as separate photos rather than a contact sheet, and small enough
/// that the batch stays one thing the director can marquee and move.
export const DROPPED_IMAGE_GAP = 24;

export type ReferenceDragItem = {
  referenceId: string;
  width: number | null;
  height: number | null;
};

export type ScenePoint = { x: number; y: number };

/// The scene-coordinate box an image occupies, in the shape excalidraw's
/// element skeleton takes.
export type DroppedImage = {
  type: "image";
  fileId: string;
  /// Excalidraw's default for a new image element is `pending`, which means
  /// "the bytes are not in the files map yet" and renders as a placeholder.
  /// Ours never are pending: the file entry is a reference pointer the load
  /// rebuilds every time, so the element is complete the moment it lands.
  status: "saved";
  x: number;
  y: number;
  width: number;
  height: number;
};

/// A drag carries a list, never a single reference: building a board is
/// choosing a set of photos, and dragging them one at a time is the same
/// arrangement done six times.
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

/// `dataTransfer` is the one channel in the browser that any page can write,
/// so what comes out of it is parsed the way any other client input is. A drag
/// that is not ours — or is ours but malformed — reads as null, and the drop
/// falls through to excalidraw.
///
/// A single unusable entry in an otherwise good list is dropped rather than
/// failing the whole drag: five photos landing when six were dragged is closer
/// to what was asked for than nothing landing at all.
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
    /// The same reference twice is one image: a selection cannot hold it twice,
    /// so a repeat is a hand-built payload rather than an intent.
    if (!item || seen.has(item.referenceId)) continue;
    seen.add(item.referenceId);
    items.push(item);
  }

  return items.length > 0 ? items : null;
}

/// What a drag started on one tile carries. Dragging a tile that is part of the
/// selection takes the whole selection; dragging one outside it takes just that
/// tile and is not the moment to argue about the selection. Ordered by the list
/// the director is looking at, which also drops ids whose reference is gone.
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

/// Read during `dragover`, where the payload itself is unreadable: the browser
/// hides drag data until the drop to keep a page from reading what is merely
/// passing over it. The type list stays visible, which is enough to decide
/// whether to accept.
export function carriesReferenceDrag(types: readonly string[] | undefined): boolean {
  return types?.includes(REFERENCE_DRAG_MIME) ?? false;
}

/// The reference's aspect ratio at board size. A reference uploaded before the
/// dimension columns existed — or one whose probe failed — has no ratio to
/// preserve, so it lands square and the director resizes it; guessing a shape
/// would be worse than an obviously neutral one.
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

/// Where a viewport point lands in the scene. Excalidraw exports this same
/// conversion, but it only exists once the 1.5 MB editor module has loaded and
/// it takes a full `AppState` — this takes the four numbers it actually reads,
/// which is what makes the drop testable without a canvas.
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

/// The image lands centred on the cursor rather than starting there: the
/// director is pointing at where the photo goes, not at its top-left corner.
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

/// As square a grid as the count allows. Photos dropped in a row would run off
/// the side of the viewport at six, and a column off the bottom — a square
/// block is the shape that stays where it was dropped.
export function droppedImageGrid(count: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(count, 1))));
  return { columns, rows: Math.max(1, Math.ceil(Math.max(count, 1) / columns)) };
}

/// Where a batch of references lands: cells of the same size the drop sizes to,
/// each image centred in its own cell so a portrait and a landscape photo sit on
/// one axis rather than on their top-left corners.
///
/// The grid is centred on the cursor — including a short last row, so a drop of
/// three does not read as a block with a corner missing. A drop of one is
/// exactly `droppedImage`: the single case is not a special case.
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
