import { normalizeHexColor } from "@/lib/analysis/analysis";
import { readingOrder, type ArrangeBox } from "@/lib/canvas/moodboard-arrange";

export type BoardPalettes = ReadonlyMap<string, readonly string[]>;

const CHROMATIC_SATURATION = 0.15;

const CHROMATIC_MIN_LIGHTNESS = 0.08;
const CHROMATIC_MAX_LIGHTNESS = 0.95;

type Hsl = { hue: number; saturation: number; lightness: number };

function hsl(hex: string): Hsl {
  const [red, green, blue] = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  ) as [number, number, number];

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;
  const lightness = (max + min) / 2;

  if (chroma === 0) return { hue: 0, saturation: 0, lightness };

  const sixth =
    max === red
      ? (green - blue) / chroma
      : max === green
        ? (blue - red) / chroma + 2
        : (red - green) / chroma + 4;

  return {
    hue: (sixth * 60 + 360) % 360,
    saturation: chroma / (1 - Math.abs(2 * lightness - 1)),
    lightness,
  };
}

export type PaletteTone =
  | { kind: "chromatic"; hue: number; lightness: number }
  | { kind: "neutral"; lightness: number };

export function paletteTone(palette: readonly unknown[] | undefined): PaletteTone | null {
  const colors = (palette ?? [])
    .map(normalizeHexColor)
    .filter((color): color is string => color !== null)
    .map(hsl);
  if (colors.length === 0) return null;

  const chromatic = colors.find(
    (color) =>
      color.saturation >= CHROMATIC_SATURATION &&
      color.lightness >= CHROMATIC_MIN_LIGHTNESS &&
      color.lightness <= CHROMATIC_MAX_LIGHTNESS,
  );
  if (chromatic) return { kind: "chromatic", hue: chromatic.hue, lightness: chromatic.lightness };

  const lightness = colors.reduce((sum, color) => sum + color.lightness, 0) / colors.length;
  return { kind: "neutral", lightness };
}

function hueOrigin(hues: readonly number[]): number {
  if (hues.length < 2) return 0;

  const sorted = [...hues].sort((a, b) => a - b);
  let origin = sorted[0]!;
  let widest = -1;

  for (let index = 0; index < sorted.length; index++) {
    const next = sorted[(index + 1) % sorted.length]!;
    const gap = (next - sorted[index]! + 360) % 360;
    if (gap > widest) {
      widest = gap;
      origin = next;
    }
  }

  return origin;
}

export function colourOrder(boxes: readonly ArrangeBox[], palettes: BoardPalettes): ArrangeBox[] {
  type Placed = { box: ArrangeBox; index: number; hue: number; lightness: number };

  const chromatic: Placed[] = [];
  const neutral: Placed[] = [];
  const unknown: ArrangeBox[] = [];

  readingOrder(boxes).forEach((box, index) => {
    const tone = box.referenceId ? paletteTone(palettes.get(box.referenceId)) : null;
    if (!tone) unknown.push(box);
    else if (tone.kind === "chromatic")
      chromatic.push({ box, index, hue: tone.hue, lightness: tone.lightness });
    else neutral.push({ box, index, hue: 0, lightness: tone.lightness });
  });

  const origin = hueOrigin(chromatic.map((entry) => entry.hue));
  const around = (hue: number) => (hue - origin + 360) % 360;

  chromatic.sort(
    (a, b) => around(a.hue) - around(b.hue) || a.lightness - b.lightness || a.index - b.index,
  );
  neutral.sort((a, b) => a.lightness - b.lightness || a.index - b.index);

  return [...chromatic, ...neutral].map((entry) => entry.box).concat(unknown);
}

export function hasColourOrder(referenceIds: readonly string[], palettes: BoardPalettes): boolean {
  const known = new Set<string>();
  for (const id of referenceIds) {
    if (paletteTone(palettes.get(id))) known.add(id);
    if (known.size >= 2) return true;
  }
  return false;
}
