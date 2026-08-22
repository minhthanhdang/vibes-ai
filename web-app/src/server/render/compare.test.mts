import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { CELL_DIFFERENT, COMPARE_GRID, aspectApart, compareRenders, sampleGrid } = await import(
  "./compare"
);

type Block = { x: number; y: number; width: number; height: number; colour: string };

/// A picture in the shape a board render is: a light page with dark things on
/// it. Blocks are composited rather than drawn so a test can move one by a
/// known number of pixels and ask what the grid says about it.
async function picture(
  width: number,
  height: number,
  blocks: Block[] = [],
  background = "#ffffff",
) {
  const composite = await Promise.all(
    blocks.map(async ({ x, y, width: w, height: h, colour }) => ({
      input: await sharp({ create: { width: w, height: h, channels: 3, background: colour } })
        .png()
        .toBuffer(),
      left: x,
      top: y,
    })),
  );
  const bytes = await sharp({ create: { width, height, channels: 3, background } })
    .composite(composite)
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

async function transparent(width: number, height: number) {
  const bytes = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

test("the same picture against itself is no difference at all", async () => {
  const one = await picture(320, 240, [{ x: 40, y: 40, width: 80, height: 60, colour: "#202020" }]);
  const difference = await compareRenders(one, one);

  assert.equal(difference.mean, 0);
  assert.equal(difference.differing, 0);
  assert.equal(difference.worst.difference, 0);
  assert.equal(difference.aspect, 0);
  assert.equal(difference.grid, COMPARE_GRID);
});

/// The point of the grid: the two renderers cap at the same longest edge and
/// still round to whole pixels their own way, so a comparison that called a
/// scale difference a drawing difference would report noise on every board.
test("the same arrangement at two scales is not a difference", async () => {
  const large = await picture(800, 600, [
    { x: 100, y: 100, width: 200, height: 150, colour: "#202020" },
    { x: 500, y: 380, width: 180, height: 120, colour: "#606060" },
  ]);
  const small = await picture(400, 300, [
    { x: 50, y: 50, width: 100, height: 75, colour: "#202020" },
    { x: 250, y: 190, width: 90, height: 60, colour: "#606060" },
  ]);

  const difference = await compareRenders(large, small);

  assert.equal(difference.differing, 0);
  assert.ok(difference.mean < CELL_DIFFERENT, `mean was ${difference.mean}`);
  assert.deepEqual(difference.mine, { width: 800, height: 600 });
  assert.deepEqual(difference.theirs, { width: 400, height: 300 });
});

test("a shape drawn somewhere else lights the cells it moved between", async () => {
  const here = await picture(640, 640, [
    { x: 32, y: 32, width: 128, height: 128, colour: "#000000" },
  ]);
  const there = await picture(640, 640, [
    { x: 448, y: 32, width: 128, height: 128, colour: "#000000" },
  ]);

  const difference = await compareRenders(here, there);

  assert.ok(difference.differing > 0, "a moved shape has to differ somewhere");
  /// Two squares of 128px on a 640px picture is a fifth of the width each, and
  /// the grid is 64 cells across — so the pair of them is about a fifth of the
  /// cells, and nothing like all of them.
  assert.ok(difference.differing < 0.3, `differing was ${difference.differing}`);
  assert.ok(difference.worst.difference > 0.9, `worst was ${difference.worst.difference}`);
  /// Both squares sit in the top fifth, and the picture is square, so the worst
  /// cell is up there rather than in the empty half below.
  assert.ok(difference.worst.y < COMPARE_GRID / 5, `worst was at y ${difference.worst.y}`);
});

test("black against white is the whole of the range", async () => {
  const white = await picture(200, 200);
  const black = await picture(200, 200, [], "#000000");

  const difference = await compareRenders(white, black);

  assert.equal(difference.mean, 1);
  assert.equal(difference.differing, 1);
  assert.equal(difference.worst.difference, 1);
});

/// Excalidraw exports transparency when the board asked for no background, and
/// an alpha read as black would score every margin as the darkest thing on the
/// page — a comparison that failed loudest on the boards with least on them.
test("a transparent export is compared as the white it is shown on", async () => {
  const difference = await compareRenders(await transparent(200, 200), await picture(200, 200));

  assert.equal(difference.mean, 0);
  assert.equal(difference.differing, 0);
});

test("a different framing is reported apart from the cells", async () => {
  const wide = await picture(400, 200);
  const tall = await picture(200, 400);
  const twiceAsBig = await picture(800, 400);

  assert.equal((await compareRenders(wide, twiceAsBig)).aspect, 0);

  const framed = await compareRenders(wide, tall);
  /// 2:1 against 1:2 is three quarters apart, and the cells say nothing at all
  /// about it — both are blank white and the grid stretched each to fill.
  assert.equal(framed.aspect, 0.75);
  assert.equal(framed.mean, 0);
});

test("a shape with no area in it is fully apart rather than a division by zero", () => {
  assert.equal(aspectApart({ width: 0, height: 0 }, { width: 400, height: 200 }), 1);
  assert.equal(aspectApart({ width: 400, height: 200 }, { width: 400, height: 0 }), 1);
});

test("the grid is the sample size, whatever the picture", async () => {
  const cells = await sampleGrid(await picture(1600, 900), 8);
  assert.equal(cells.length, 64);
  assert.ok(
    cells.every((grey) => grey === 255),
    "a white picture samples white",
  );
});
