import { normalizeHexColor } from "@/lib/analysis/analysis";
import type { ScenePoint } from "@/lib/canvas/moodboard-drop";
import { relativeLuminance } from "@/lib/render/contrast";

export const SWATCH_WIDTH = 96;
export const SWATCH_HEIGHT = 128;

export const SWATCH_GAP = 0;

export const LABEL_FONT_SIZE = 16;

export const PALETTE_OFFSET = 48;

export const BOARD_PALETTE_LIMIT = 8;

export const DARK_INK = "#1e1e1e";
export const LIGHT_INK = "#ffffff";

const INK_LUMINANCE_THRESHOLD = 0.179;

export type PaletteSwatch = {
  type: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: string;
  strokeColor: string;
  fillStyle: "solid";
  strokeWidth: number;
  roughness: number;
  roundness: null;
  groupIds: string[];
  label: {
    text: string;
    fontSize: number;
    strokeColor: string;
    fontFamily: number;
    textAlign: "center";
    verticalAlign: "bottom";
  };
};

export function mergedPalette(palettes: readonly (readonly unknown[])[]): string[] {
  const occurrences = new Map<string, { count: number; first: number }>();
  let position = 0;

  for (const palette of palettes) {
    const seen = new Set<string>();

    for (const value of palette) {
      const color = normalizeHexColor(value);
      if (!color || seen.has(color)) continue;
      seen.add(color);

      const entry = occurrences.get(color);
      if (entry) entry.count += 1;
      else occurrences.set(color, { count: 1, first: position });
      position += 1;
    }
  }

  return [...occurrences.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.first - b.first)
    .slice(0, BOARD_PALETTE_LIMIT)
    .map(([color]) => color);
}

export function readableInk(color: string): string {
  const hex = normalizeHexColor(color);
  if (!hex) return DARK_INK;

  return relativeLuminance(hex) > INK_LUMINANCE_THRESHOLD ? DARK_INK : LIGHT_INK;
}

export function paletteAnchor(bounds: readonly [number, number, number, number]): ScenePoint {
  const [minX, , maxX, maxY] = bounds;
  return {
    x: (minX + maxX) / 2,
    y: maxY + PALETTE_OFFSET + SWATCH_HEIGHT / 2,
  };
}

export function paletteSwatches(
  colors: readonly string[],
  at: ScenePoint,
  groupId: string,
): PaletteSwatch[] {
  const swatches = colors.map(normalizeHexColor).filter((color): color is string => color !== null);
  if (swatches.length === 0) return [];

  const width = swatches.length * SWATCH_WIDTH + (swatches.length - 1) * SWATCH_GAP;
  const left = at.x - width / 2;
  const top = at.y - SWATCH_HEIGHT / 2;

  return swatches.map((color, index) => ({
    type: "rectangle",
    x: left + index * (SWATCH_WIDTH + SWATCH_GAP),
    y: top,
    width: SWATCH_WIDTH,
    height: SWATCH_HEIGHT,
    backgroundColor: color,
    strokeColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    roundness: null,
    groupIds: [groupId],
    label: {
      text: color.toUpperCase(),
      fontSize: LABEL_FONT_SIZE,
      strokeColor: readableInk(color),
      fontFamily: 3,
      textAlign: "center",
      verticalAlign: "bottom",
    },
  }));
}
