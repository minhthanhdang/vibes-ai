import { normalizeHexColor } from "@/lib/analysis/analysis";
import { readingOrder, type ArrangeBox } from "@/lib/canvas/moodboard-arrange";

/// The order the tidy fills its grid in, when the user wants the board
/// sorted by colour rather than straightened where it stands.
///
/// This is the one arrangement a moodboard is actually judged on and neither
/// excalidraw nor a filing system can produce: grouping the warm frames away
/// from the cold ones is how a set of photos is turned into a look, and until
/// now it was done by dragging each photo next to the ones it matches. Agent 2
/// already reads a palette off every reference, so the board can be sorted by
/// what is *in* the photos rather than by name, date or where they landed.
///
/// No canvas, no React, no DOM: what goes in is boxes and hex, what comes out
/// is the same boxes in another order.

export type BoardPalettes = ReadonlyMap<string, readonly string[]>;

/// Below this a colour has no hue worth grouping by. A #6b6a68 wall reports a
/// hue of 40°, and putting it between two ambers because of that is worse than
/// calling it what it is — grey.
const CHROMATIC_SATURATION = 0.15;

/// A near-black and a near-white still report a hue, and it is meaningless for
/// the same reason: what the eye reads there is the tone, not the colour.
const CHROMATIC_MIN_LIGHTNESS = 0.08;
const CHROMATIC_MAX_LIGHTNESS = 0.95;

type Hsl = { hue: number; saturation: number; lightness: number };

/// HSL of an `#rrggbb`. Hue is the axis a colour sort is about, and RGB has no
/// axis at all — sorting on the packed integer puts #ff0000 beside #ff00ff.
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

/// What a photo counts as for sorting: a colour, or a tone when it has no
/// colour to speak of.
export type PaletteTone =
  | { kind: "chromatic"; hue: number; lightness: number }
  | { kind: "neutral"; lightness: number };

/// The one colour a photo is filed under.
///
/// A palette is ordered most prominent first, so the leading entry that has a
/// hue at all is the colour the photo reads as — a night shot whose palette
/// opens on two near-blacks is still the shot with the neon in it, and filing
/// it under black would put it with the greyscale portraits. A palette with no
/// chromatic entry is a genuinely neutral photo and is filed by its tone, so
/// the greyscale frames come out as a ramp rather than scattered.
///
/// Null is "nothing known about this photo" — an unanalyzed reference, not a
/// colourless one, and the two must not be laid out together.
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

/// Which hue the row starts at. The wheel has no beginning, and starting at red
/// by fiat cuts whichever cluster happens to straddle it: a board of sunsets
/// spanning 350° and 10° would come out with half its frames at each end. The
/// widest gap between two used hues is the one place no cluster is broken by
/// starting there.
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

/// The photos in colour order: around the wheel first, then the neutrals as a
/// tone ramp, then anything the analyzer has not answered on yet.
///
/// The unanalyzed go last rather than into the middle of the run — a photo of
/// unknown colour dropped between two ambers breaks the only thing this order
/// exists to show, and it is also the honest place for it: the tail of the
/// board is where a user looks for what is still coming.
///
/// Ties fall back to the order the board already reads in, which is what makes
/// the layout a fixed point: tidying by colour twice moves nothing the second
/// time, because the second pass reads back its own output.
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
  /// Dark to light, so the greyscale tail is a ramp read the same way as the
  /// colour run before it rather than an arbitrary heap of greys.
  neutral.sort((a, b) => a.lightness - b.lightness || a.index - b.index);

  return [...chromatic, ...neutral].map((entry) => entry.box).concat(unknown);
}

/// Whether sorting by colour would say anything. One photo with a palette is
/// not a colour order, and offering the action on a board the analyzer has not
/// answered on yet is a button that quietly lays the board out exactly as the
/// plain tidy would.
export function hasColourOrder(referenceIds: readonly string[], palettes: BoardPalettes): boolean {
  const known = new Set<string>();
  for (const id of referenceIds) {
    if (paletteTone(palettes.get(id))) known.add(id);
    if (known.size >= 2) return true;
  }
  return false;
}
