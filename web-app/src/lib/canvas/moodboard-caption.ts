import { clipped, collapsed } from "@/lib/util/text";

import { selectedElementIds } from "@/lib/canvas/moodboard-selection";

export const CAPTION_GAP = 12;

export const CAPTION_WIDTH_DIVISOR = 16;
export const CAPTION_MIN_FONT = 12;
export const CAPTION_MAX_FONT = 36;

export type CaptionBox = { x: number; y: number; width: number; height: number };

export function captionFontSize(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return CAPTION_MIN_FONT;
  const size = width / CAPTION_WIDTH_DIVISOR;
  return Math.round(Math.min(CAPTION_MAX_FONT, Math.max(CAPTION_MIN_FONT, size)));
}

export const CAPTION_MAX_LENGTH = 60;

export function captionText(source: string): string | null {
  const text = collapsed(source);
  if (text.length === 0) return null;
  return clipped(text, CAPTION_MAX_LENGTH);
}

export function captionPlacement(photo: CaptionBox) {
  return {
    x: photo.x,
    y: photo.y + photo.height + CAPTION_GAP,
    fontSize: captionFontSize(photo.width),
  };
}

export function captionCentre(photo: CaptionBox, measuredWidth: number): number {
  return photo.x + (photo.width - measuredWidth) / 2;
}

export function captionablePhotos(elements: unknown, appState: unknown): number {
  if (!Array.isArray(elements)) return 0;
  const selected = new Set(selectedElementIds(appState));
  if (selected.size === 0) return 0;

  return elements.filter((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const element = entry as Record<string, unknown>;
    return (
      element.type === "image" &&
      element.isDeleted !== true &&
      element.locked !== true &&
      typeof element.id === "string" &&
      selected.has(element.id) &&
      (!Array.isArray(element.groupIds) || element.groupIds.length === 0)
    );
  }).length;
}
