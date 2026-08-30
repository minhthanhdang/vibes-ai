import { DROPPED_IMAGE_GAP } from "@/lib/canvas/moodboard-drop";

export const FRAME_TYPES = ["frame", "magicframe"] as const;

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

export function frameOf(
  frames: readonly FrameBox[],
  frameId: unknown,
): FrameBox | null {
  if (typeof frameId !== "string") return null;
  return frames.find((frame) => frame.id === frameId) ?? null;
}

export function frameInnerBox(frame: FrameBox): Rect {
  return {
    x: frame.x + FRAME_PADDING,
    y: frame.y + FRAME_PADDING,
    width: frame.width - FRAME_PADDING * 2,
    height: frame.height - FRAME_PADDING * 2,
  };
}

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
