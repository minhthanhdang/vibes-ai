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

export type ReferenceDragPayload = {
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

export function encodeReferenceDrag(payload: ReferenceDragPayload): string {
  return JSON.stringify(payload);
}

function finiteSize(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/// `dataTransfer` is the one channel in the browser that any page can write,
/// so what comes out of it is parsed the way any other client input is. A drag
/// that is not ours — or is ours but malformed — reads as null, and the drop
/// falls through to excalidraw.
export function decodeReferenceDrag(raw: string | null | undefined): ReferenceDragPayload | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { referenceId, width, height } = parsed as Record<string, unknown>;
  if (typeof referenceId !== "string" || referenceId.trim().length === 0) return null;

  return { referenceId: referenceId.trim(), width: finiteSize(width), height: finiteSize(height) };
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
export function droppedImage(payload: ReferenceDragPayload, at: ScenePoint): DroppedImage {
  const { width, height } = droppedImageSize(payload.width, payload.height);
  return {
    type: "image",
    fileId: referenceFileId(payload.referenceId),
    status: "saved",
    x: at.x - width / 2,
    y: at.y - height / 2,
    width,
    height,
  };
}
