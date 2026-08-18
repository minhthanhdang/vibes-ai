import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { cutBytes } = await import("./cut");
const { THUMBNAIL_MAX_EDGE, THUMBNAIL_JPEG_QUALITY, thumbnailBox } = await import(
  "@/lib/intake/thumbnail",
);
const { CROP_JPEG_QUALITY } = await import("@/lib/canvas/moodboard-crop");

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

/// Both encodes are the browser's own numbers, and the cut's is the one with a
/// consequence past its weight: it is part of what `hashBytes` digests, so a
/// door encoding at a quality of its own files a second row of a cut the
/// project already holds.
test("the cut is encoded at the quality the browser cuts at", async () => {
  const source = await frame(400, 200, "jpeg");
  const region = { left: 0, top: 0, width: 200, height: 100 };

  const cut = await cutBytes(source, { x: 0, y: 0, width: 0.5, height: 0.5 });
  const asTheBrowserWould = await sharp(source)
    .extract(region)
    .jpeg({ quality: Math.round(CROP_JPEG_QUALITY * 100) })
    .toBuffer();
  assert.deepEqual(Buffer.from(cut.bytes), asTheBrowserWould);

  /// And not at sharp's own default, which is what dropping the number gets.
  const atSharpsDefault = await sharp(source).extract(region).jpeg().toBuffer();
  assert.notDeepEqual(Buffer.from(cut.bytes), atSharpsDefault);
});

test("the grid copy is encoded at the quality every other grid copy is", async () => {
  const cut = await cutBytes(await frame(4000, 2000, "jpeg"), {
    x: 0,
    y: 0,
    width: 0.5,
    height: 1,
  });
  assert.ok(cut.thumbnail);

  const box = thumbnailBox(cut.width, cut.height);
  const copy = (quality: number) =>
    sharp(cut.bytes).resize(box.width, box.height).jpeg({ quality }).toBuffer();

  assert.deepEqual(
    Buffer.from(cut.thumbnail.bytes),
    await copy(Math.round(THUMBNAIL_JPEG_QUALITY * 100)),
  );
  assert.notDeepEqual(Buffer.from(cut.thumbnail.bytes), await copy(95));
});

/// A copy of the frame at the cut's dimensions is the right size, the right
/// format and the wrong picture — every assertion about the copy above passes
/// on one. What it draws is the tile the gallery shows for this row, so it has
/// to be the part of the photograph that was kept.
test("the grid copy is a copy of the cut and not of the frame", async () => {
  const green = await sharp({
    create: { width: 2000, height: 2000, channels: 3, background: "#00ff00" },
  })
    .png()
    .toBuffer();
  const halves = new Uint8Array(
    await sharp({ create: { width: 4000, height: 2000, channels: 3, background: "#ff0000" } })
      .composite([{ input: green, left: 0, top: 0 }])
      .jpeg()
      .toBuffer(),
  );

  const red = await cutBytes(halves, { x: 0.5, y: 0, width: 0.5, height: 1 });
  assert.ok(red.thumbnail);
  assert.ok(
    !isGreen(await pixel(red.thumbnail.bytes, 5, 5)),
    "the copy of a cut of the red half is red where the frame is green",
  );

  const marked = await cutBytes(halves, { x: 0, y: 0, width: 0.5, height: 1 });
  assert.ok(marked.thumbnail);
  assert.ok(isGreen(await pixel(marked.thumbnail.bytes, 5, 5)), "and green where the cut is");
});
