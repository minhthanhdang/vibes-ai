import { normalizeHexColor } from "./analysis";
import type { ScenePoint } from "./moodboard-drop";

/// A moodboard is images *and the colour they are made of*. Every reference on
/// the board already carries agent 2's palette, but it is readable only in a
/// panel — and a palette that cannot be put on the board next to the photos is
/// not part of the board a director shows anyone, or of the deck agent 5 builds
/// from it.
///
/// So this is the palette as an object on the canvas: a bar of swatches, each
/// labelled with its hex, laid out from colours excalidraw has no notion of.
/// No canvas and no React in here — a palette is a list of colours and a
/// rectangle is four numbers.

/// A Coolors-shaped chip: taller than it is wide, so a bar of them reads as a
/// palette rather than as a row of squares somebody drew.
export const SWATCH_WIDTH = 96;
export const SWATCH_HEIGHT = 128;

/// The chips touch. A gap makes six unrelated rectangles; a continuous bar is
/// one object the eye reads as "these colours go together", which is the whole
/// claim a palette makes.
export const SWATCH_GAP = 0;

/// Excalidraw's "S". The label is data, not lettering, so it is set in the mono
/// family rather than in the hand-drawn one the rest of a board is in.
export const LABEL_FONT_SIZE = 16;

/// How far under the photos the bar lands. Clear of the selection's own
/// handles, close enough to still read as belonging to it.
export const PALETTE_OFFSET = 48;

/// Six colours per reference (`PALETTE_LIMIT`), so a selection of five is up to
/// thirty. A bar of eight is already 768 units wide — past that it stops being
/// a palette and becomes a gradient nobody can name.
export const BOARD_PALETTE_LIMIT = 8;

/// Excalidraw's own ink and paper, so a swatch label sits in the same two
/// colours as every other piece of text on the board.
export const DARK_INK = "#1e1e1e";
export const LIGHT_INK = "#ffffff";

/// Relative luminance above which black text beats white on the same
/// background — the crossover of the two WCAG contrast ratios, not a guess at
/// "light or dark".
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

/// The palette of everything the director selected, most shared colour first.
///
/// One photo's palette is agent 2's answer about that photo. Several photos'
/// palettes together is the question a director is actually asking of a
/// moodboard — "what colour is this set" — so the merge is by how many of the
/// selected references a colour appears in, and only then by where it first
/// appeared. Each palette is already ordered most to least prominent, so a
/// colour leading two of them leads the result.
export function mergedPalette(palettes: readonly (readonly unknown[])[]): string[] {
  const occurrences = new Map<string, { count: number; first: number }>();
  let position = 0;

  for (const palette of palettes) {
    /// Within one reference a repeated colour is still one colour, and it must
    /// not count twice towards being shared across references.
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

/// Which of excalidraw's two inks a hex label is legible in. A palette is
/// nothing without its numbers, and a #101010 swatch labelled in #1e1e1e is a
/// swatch with no number on it.
export function readableInk(color: string): string {
  const hex = normalizeHexColor(color);
  if (!hex) return DARK_INK;

  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > INK_LUMINANCE_THRESHOLD ? DARK_INK : LIGHT_INK;
}

/// Where the bar goes for a given selection: centred under it, so it reads as
/// the palette *of those photos* rather than as something that happened to land
/// on the canvas. `bounds` is excalidraw's `[minX, minY, maxX, maxY]`.
export function paletteAnchor(bounds: readonly [number, number, number, number]): ScenePoint {
  const [minX, , maxX, maxY] = bounds;
  return {
    x: (minX + maxX) / 2,
    y: maxY + PALETTE_OFFSET + SWATCH_HEIGHT / 2,
  };
}

/// The bar itself, centred on `at` — the same rule the reference drop lands by,
/// so a palette placed by hand and a palette placed under a selection are the
/// same shape of thing.
///
/// Every chip carries the same `groupIds`: a palette is one object. Pulling a
/// single colour out of it is ungrouping, which is a thing the director asks
/// for; six chips that have to be selected individually to be moved is not.
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
    /// No outline: the chips butt together and a stroke between them would draw
    /// a grid over the palette. `transparent` is excalidraw's own way to say a
    /// shape has no stroke, and it skips the pass entirely.
    strokeColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    /// Flat, not hand-drawn: a swatch is a measurement. Roughness would put a
    /// sketched edge and an uneven fill on the one element whose whole job is
    /// to be exactly one colour.
    roughness: 0,
    roundness: null,
    groupIds: [groupId],
    /// Bound to the chip rather than a text element under it, so it moves,
    /// scales and deletes with the colour it names — and so excalidraw does the
    /// measuring and centring that a pure layout cannot.
    label: {
      text: color.toUpperCase(),
      fontSize: LABEL_FONT_SIZE,
      strokeColor: readableInk(color),
      /// `FONT_FAMILY.Cascadia`. Named by value rather than imported so this
      /// module stays runnable without the editor — importing excalidraw here
      /// would take the layout rules out of reach of a plain node test.
      fontFamily: 3,
      textAlign: "center",
      verticalAlign: "bottom",
    },
  }));
}
