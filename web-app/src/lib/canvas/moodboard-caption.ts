/// Labelling a photo on the board.
///
/// A moodboard is images and what the user says about them — "act two, the
/// hallway", "this light, not this framing" — and excalidraw has text but no
/// notion of a caption: its bound labels work on containers and arrows, and an
/// image is neither. So a note beside a photo is a free text element that knows
/// nothing about the photo, and every arrangement afterwards separates the two.
///
/// The answer is excalidraw's own group: a caption is grouped with its photo, so
/// the editor moves, scales, copies and deletes them as one object, and §II.8's
/// tidy carries the caption along because a group is one unit to the layout.
/// This module decides only where the text goes and how big it is.
///
/// No canvas, no React, no DOM.

import { selectedElementIds } from "@/lib/canvas/moodboard-selection";

/// Between the photo's bottom edge and the caption. Half the gap the grid leaves
/// between photos: a caption further from its own photo than the photos are from
/// each other reads as belonging to the row below it.
export const CAPTION_GAP = 12;

/// A caption is read at whatever zoom the board is read at, so its size has to
/// follow the photo rather than the canvas: a fixed 20pt is a headline under a
/// thumbnail and unreadable under a full-width still. A sixteenth of the width
/// is roughly the proportion a printed plate caption has.
export const CAPTION_WIDTH_DIVISOR = 16;
export const CAPTION_MIN_FONT = 12;
export const CAPTION_MAX_FONT = 36;

export type CaptionBox = { x: number; y: number; width: number; height: number };

export function captionFontSize(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return CAPTION_MIN_FONT;
  const size = width / CAPTION_WIDTH_DIVISOR;
  return Math.round(Math.min(CAPTION_MAX_FONT, Math.max(CAPTION_MIN_FONT, size)));
}

/// One line, and short. A caption is a label rather than a note — the board has
/// text elements for anything longer — and a title long enough to wrap under its
/// photo widens the unit the tidy then lays out, which shrinks the photo it was
/// meant to describe.
export const CAPTION_MAX_LENGTH = 60;

export function captionText(source: string): string | null {
  const text = source.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  return text.length > CAPTION_MAX_LENGTH
    ? `${text.slice(0, CAPTION_MAX_LENGTH - 1).trimEnd()}…`
    : text;
}

/// Where the caption starts, before the editor has measured it: under the photo
/// and at its left edge. Centring needs the measured width, which only the
/// editor knows, so it is a second step rather than a guess made here.
export function captionPlacement(photo: CaptionBox) {
  return {
    x: photo.x,
    y: photo.y + photo.height + CAPTION_GAP,
    fontSize: captionFontSize(photo.width),
  };
}

/// The caption centred under its photo once its width is known.
export function captionCentre(photo: CaptionBox, measuredWidth: number): number {
  return photo.x + (photo.width - measuredWidth) / 2;
}

/// How many of the selected elements could take a caption, which is what decides
/// whether the offer is made at all.
///
/// A photo already in a group is not one of them. Excalidraw's groups nest, and
/// an outer group holding only this photo and its new caption — while its
/// existing group holds elements the outer one does not — is a state its own
/// gestures cannot produce. It is also the honest reading: a photo that already
/// has a caption does not need a second, and one grouped with something else has
/// an arrangement the user made.
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
