import { DROPPED_IMAGE_GAP } from "@/lib/canvas/moodboard-drop";

/// Frames read as the board's sections — "Act one", "the cold half", "palette"
/// — and excalidraw already ships the tool, the name and the drag-a-child-in
/// behaviour. What it does not ship is any of it applying to the operations
/// *this* board adds: a frame is a rectangle that owns what it contains, and
/// every host-side edit that moves a photo has to know that or the section is
/// destroyed by the action that was supposed to tidy it.
///
/// No canvas, no React, no DOM: what goes in is elements, what comes out is
/// boxes and ids.

/// Excalidraw's two frame-like element types. `magicframe` is the AI frame from
/// its own product; it is a frame in every way that matters here, and a board
/// that has one (from a pasted scene) should not have it read as a photo's
/// neighbour rather than as its container.
export const FRAME_TYPES = ["frame", "magicframe"] as const;

/// The margin between a frame's edge and the photos filling it. The same gap
/// the photos have between each other, because a section whose contents are
/// tighter to its border than to one another reads as overflowing it.
export const FRAME_PADDING = DROPPED_IMAGE_GAP;

export type FrameBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Rect = { x: number; y: number; width: number; height: number };

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/// The frames a scene holds, in the array's own order — which is z-order, so
/// the last one is the one on top.
export function boardFrames(elements: unknown): FrameBox[] {
  if (!Array.isArray(elements)) return [];

  const frames: FrameBox[] = [];
  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element || element.isDeleted === true) continue;
    if (typeof element.type !== "string") continue;
    if (!(FRAME_TYPES as readonly string[]).includes(element.type)) continue;

    const id = element.id;
    const x = finite(element.x);
    const y = finite(element.y);
    const width = finite(element.width);
    const height = finite(element.height);
    if (typeof id !== "string" || x === null || y === null) continue;
    if (width === null || height === null || width <= 0 || height <= 0) continue;

    frames.push({ id, x, y, width, height });
  }

  return frames;
}

/// Which frame an element belongs to, or null — including the case where its
/// `frameId` names a frame that is no longer on the board, which is a photo on
/// the canvas rather than a photo in a section.
export function frameOf(
  frames: readonly FrameBox[],
  frameId: unknown,
): FrameBox | null {
  if (typeof frameId !== "string") return null;
  return frames.find((frame) => frame.id === frameId) ?? null;
}

/// Where inside a frame its photos may be laid out.
export function frameInnerBox(frame: FrameBox): Rect {
  return {
    x: frame.x + FRAME_PADDING,
    y: frame.y + FRAME_PADDING,
    width: frame.width - FRAME_PADDING * 2,
    height: frame.height - FRAME_PADDING * 2,
  };
}

/// The frame a box being *placed* joins, topmost first.
///
/// Containment rather than excalidraw's overlap: a child that only overlaps its
/// frame is drawn clipped at the frame's edge, and a photo that arrives with a
/// side sliced off looks like a broken drop rather than like a section it can be
/// dragged the rest of the way into. Fully inside is unambiguous — it is where
/// the director aimed — and anything else is left on the canvas, which is
/// exactly where it appears to be.
export function frameHolding(frames: readonly FrameBox[], box: Rect): string | null {
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index]!;
    if (
      box.x >= frame.x &&
      box.y >= frame.y &&
      box.x + box.width <= frame.x + frame.width &&
      box.y + box.height <= frame.y + frame.height
    ) {
      return frame.id;
    }
  }
  return null;
}
