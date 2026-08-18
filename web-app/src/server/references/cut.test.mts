import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { cutBytes } = await import("./cut");
const { THUMBNAIL_MAX_EDGE } = await import("@/lib/intake/thumbnail");

/// A frame with a marker block in one corner, so a cut can be checked for
/// taking the part of the photograph it was asked for rather than merely a
/// rectangle of the right size.
async function frame(
  width: number,
  height: number,
  format: "jpeg" | "png",
  orientation?: number,
) {
  const marker = { create: { width: 4, height: 4, channels: 3, background: "#00ff00" } } as const;
  const image = sharp({
    create: { width, height, channels: 3, background: "#ff0000" },
  }).composite([{ input: await sharp(marker).png().toBuffer(), left: 0, top: 0 }]);

  const bytes = await (orientation ? image.withMetadata({ orientation }) : image)
    [format]()
    .toBuffer();
  return new Uint8Array(bytes);
}

const pixel = async (bytes: Uint8Array, left: number, top: number) => {
  const { data } = await sharp(bytes)
    .extract({ left, top, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
};

const isGreen = ([r, g]: number[]) => g > 200 && r < 80;

test("cuts the region's fractions out of the frame's own pixels", async () => {
  const cut = await cutBytes(await frame(400, 200, "jpeg"), {
    x: 0.5,
    y: 0,
    width: 0.25,
    height: 0.5,
  });

  assert.deepEqual({ width: cut.width, height: cut.height }, { width: 100, height: 100 });
  const size = await sharp(cut.bytes).metadata();
  assert.deepEqual({ width: size.width, height: size.height }, { width: 100, height: 100 });
});

test("takes the part of the photograph the region names", async () => {
  const source = await frame(400, 200, "jpeg");

  const corner = await cutBytes(source, { x: 0, y: 0, width: 0.25, height: 0.5 });
  assert.ok(isGreen(await pixel(corner.bytes, 1, 1)), "the marked corner is in the cut");

  const elsewhere = await cutBytes(source, { x: 0.5, y: 0.5, width: 0.25, height: 0.5 });
  assert.ok(!isGreen(await pixel(elsewhere.bytes, 1, 1)), "a cut of the far corner is not");
});

test("a photograph's EXIF orientation is the frame the region is of", async () => {
  /// Orientation 6 stores a 400x200 grid that displays as 200x400, and the
  /// browser's `createImageBitmap` measured the displayed one. A cut of the
  /// stored grid would be a different part of the picture and the wrong shape.
  const cut = await cutBytes(await frame(400, 200, "jpeg", 6), {
    x: 0,
    y: 0,
    width: 1,
    height: 0.5,
  });

  assert.deepEqual({ width: cut.width, height: cut.height }, { width: 200, height: 200 });
});

test("keeps a PNG a PNG and encodes everything else as JPEG", async () => {
  const region = { x: 0, y: 0, width: 0.5, height: 0.5 };

  const png = await cutBytes(await frame(100, 100, "png"), region);
  assert.equal(png.contentType, "image/png");
  assert.equal((await sharp(png.bytes).metadata()).format, "png");

  const jpeg = await cutBytes(await frame(100, 100, "jpeg"), region);
  assert.equal(jpeg.contentType, "image/jpeg");
  assert.equal((await sharp(jpeg.bytes).metadata()).format, "jpeg");
});

test("makes the grid-sized copy in the same pass", async () => {
  const cut = await cutBytes(await frame(4000, 2000, "jpeg"), {
    x: 0,
    y: 0,
    width: 0.5,
    height: 1,
  });

  assert.ok(cut.thumbnail, "a cut larger than the grid is filed with its copy");
  const thumb = await sharp(cut.thumbnail.bytes).metadata();
  assert.equal(thumb.format, "jpeg");
  assert.equal(Math.max(thumb.width ?? 0, thumb.height ?? 0), THUMBNAIL_MAX_EDGE);
  assert.ok(cut.thumbnail.bytes.length < cut.bytes.length);
});

test("a cut already inside the grid is owed no copy", async () => {
  const cut = await cutBytes(await frame(800, 400, "jpeg"), {
    x: 0,
    y: 0,
    width: 0.5,
    height: 0.5,
  });

  assert.equal(cut.thumbnail, null);
});

test("a region that runs off the edge is clamped rather than throwing", async () => {
  const cut = await cutBytes(await frame(200, 100, "jpeg"), {
    x: 0.9,
    y: 0.9,
    width: 0.5,
    height: 0.5,
  });

  assert.deepEqual({ width: cut.width, height: cut.height }, { width: 20, height: 10 });
});

test("bytes that are not an image are refused with a sentence", async () => {
  await assert.rejects(
    () => cutBytes(new Uint8Array([1, 2, 3, 4]), { x: 0, y: 0, width: 1, height: 1 }),
    /decode|unsupported|input/i,
  );
});
