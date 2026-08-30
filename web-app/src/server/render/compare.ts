import "server-only";
import sharp from "sharp";

export const COMPARE_GRID = 64;

export const CELL_DIFFERENT = 0.1;

export type PictureShape = { width: number; height: number };

export type RenderDifference = {
  grid: number;
  mine: PictureShape;
  theirs: PictureShape;
  aspect: number;
  mean: number;
  differing: number;
  worst: { x: number; y: number; difference: number };
};

export async function pictureShape(bytes: Uint8Array): Promise<PictureShape> {
  const { width, height } = await sharp(Buffer.from(bytes)).metadata();
  return { width: width ?? 0, height: height ?? 0 };
}

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

export function aspectApart(mine: PictureShape, theirs: PictureShape): number {
  const one = mine.width / mine.height;
  const two = theirs.width / theirs.height;
  if (!Number.isFinite(one) || !Number.isFinite(two) || one <= 0 || two <= 0) return 1;
  return Math.abs(one - two) / Math.max(one, two);
}
