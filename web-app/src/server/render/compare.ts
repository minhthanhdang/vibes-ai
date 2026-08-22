import "server-only";
import sharp from "sharp";

/// Measuring `renderForModel`'s draw against excalidraw's own export of the
/// same scene (compositor-v2.md §III.2.1, and the first thing the task says to
/// flag rather than decide).
///
/// The bet stage 0 made is that a re-implemented renderer is close enough that
/// a model judging an arrangement in one picture would judge the same
/// arrangement the same way in the other. That bet is checkable — the browser
/// already stores an export of the board at a known revision
/// (`boardRenderObjectPath`) and this draws the same revision — but only if
/// "close enough" is a number rather than an impression, which is what this
/// file is for. `scripts/render-check.mts` is what puts real boards through it.
///
/// **Arrangement, not pixels.** The comparison is deliberately coarse: both
/// pictures are flattened onto one small grid of luminance cells and compared
/// cell by cell. Two reasons, and both are about measuring the thing that
/// matters. A stroke a pixel wide in a different place is a per-pixel
/// difference of tens of thousands and a design difference of nothing; and the
/// two pictures are not registered — the same padding and the same maximum
/// dimension go in, but the rounding to whole pixels is each renderer's own, so
/// a pixel-to-pixel subtraction would mostly measure a half-pixel offset. What
/// a grid measures is where the dark and the light of the page ended up, which
/// is what "does it look wrong" is asked about.

/// Cells on a side. Sixty-four over a 1,600px render is a 25px cell — about the
/// smallest patch of a page a model's judgement turns on, and small enough that
/// one moved photograph lights several cells rather than blurring into none.
export const COMPARE_GRID = 64;

/// How far apart one cell's two greys have to be to count as a disagreement.
/// A tenth of the range: past antialiasing and past a font that hinted
/// differently, short of a shape that is there in one picture and not the other.
export const CELL_DIFFERENT = 0.1;

export type PictureShape = { width: number; height: number };

export type RenderDifference = {
  grid: number;
  mine: PictureShape;
  theirs: PictureShape;
  /// How far the two framings are apart, as a share of the taller-per-wide of
  /// the pair. Reported beside the cell numbers rather than folded into them
  /// because the grid stretches both pictures to fill it: a render that framed
  /// the board differently would otherwise come back as a small mean difference
  /// with the disagreement squeezed out of it.
  aspect: number;
  /// Mean absolute difference across every cell, 0 (identical) to 1 (black
  /// against white).
  mean: number;
  /// The share of cells past `CELL_DIFFERENT`. The number worth reading first:
  /// a mean is dragged down by the empty margin every board has, and a
  /// disagreement that is real is local.
  differing: number;
  /// The worst single cell and where it is, in grid coordinates from the top
  /// left — so a bad comparison names a place to look at rather than only a
  /// score.
  worst: { x: number; y: number; difference: number };
};

/// The picture's own pixel size, which is not the grid's and is worth saying:
/// the two renderers take the same `maxWidthOrHeight` and can still land a
/// pixel apart, and a much larger gap than that is a scale disagreement rather
/// than a rounding one.
export async function pictureShape(bytes: Uint8Array): Promise<PictureShape> {
  const { width, height } = await sharp(Buffer.from(bytes)).metadata();
  return { width: width ?? 0, height: height ?? 0 };
}

/// One picture as `grid × grid` greys.
///
/// Flattened onto white first: excalidraw exports transparency when the board
/// asked for no background, and an unflattened alpha reads as black — which
/// would score an empty margin as the darkest thing on the page and swamp every
/// real difference. `fit: "fill"` rather than a letterbox because the aspect
/// difference is reported separately and a letterbox would put bars of
/// background into the cells being compared.
export async function sampleGrid(bytes: Uint8Array, grid = COMPARE_GRID): Promise<Uint8Array> {
  const { data } = await sharp(Buffer.from(bytes))
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(grid, grid, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

export async function compareRenders(
  mine: Uint8Array,
  theirs: Uint8Array,
  grid = COMPARE_GRID,
): Promise<RenderDifference> {
  const [mineShape, theirsShape, a, b] = await Promise.all([
    pictureShape(mine),
    pictureShape(theirs),
    sampleGrid(mine, grid),
    sampleGrid(theirs, grid),
  ]);

  let total = 0;
  let differing = 0;
  let worst = { x: 0, y: 0, difference: 0 };
  for (let index = 0; index < a.length; index += 1) {
    const difference = Math.abs(a[index] - b[index]) / 255;
    total += difference;
    if (difference > CELL_DIFFERENT) differing += 1;
    if (difference > worst.difference) {
      worst = { x: index % grid, y: Math.floor(index / grid), difference };
    }
  }

  return {
    grid,
    mine: mineShape,
    theirs: theirsShape,
    aspect: aspectApart(mineShape, theirsShape),
    mean: total / a.length,
    differing: differing / a.length,
    worst,
  };
}

/// Two framings as one number. Zero when the pictures are the same shape at any
/// size; three quarters when one is 2:1 and the other 1:2. Exported for its own
/// test rather than reached through a picture, because the case worth pinning —
/// a shape with no area in it — is one sharp will not hand back for anything it
/// can open, and a comparison of an unmeasurable picture is fully apart rather
/// than a division by zero: not knowing is not evidence of agreement.
export function aspectApart(mine: PictureShape, theirs: PictureShape): number {
  const one = mine.width / mine.height;
  const two = theirs.width / theirs.height;
  if (!Number.isFinite(one) || !Number.isFinite(two) || one <= 0 || two <= 0) return 1;
  return Math.abs(one - two) / Math.max(one, two);
}
