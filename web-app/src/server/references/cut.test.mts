import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { cutBytes, thumbnailOf } = await import("./cut");
const { THUMBNAIL_MAX_EDGE, THUMBNAIL_JPEG_QUALITY, thumbnailBox } = await import(
  "@/lib/intake/thumbnail",
);
const { CROP_JPEG_QUALITY } = await import("@/lib/canvas/moodboard-crop");

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
  const cut = await cutBytes(await frame(400, 200, "jpeg", 6), {
    x: 0,
    y: 0,
    width: 1,
    height: 0.5,
  });

  assert.deepEqual({ width: cut.width, height: cut.height }, { width: 200, height: 200 });
});

test("a rotated photograph is cut upright, not out of its stored grid", async () => {
  const source = await frame(400, 200, "jpeg", 6);
  const topRight = { x: 0.5, y: 0, width: 0.5, height: 0.25 };

  const marked = await cutBytes(source, topRight);
  assert.ok(isGreen(await pixel(marked.bytes, 97, 1)), "the marked corner is in the cut");

  const topLeft = await cutBytes(source, { ...topRight, x: 0 });
  assert.ok(!isGreen(await pixel(topLeft.bytes, 97, 1)), "and the other half of that edge is not");
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

test("the cut is encoded at the quality the browser cuts at", async () => {
  const source = await frame(400, 200, "jpeg");
  const region = { left: 0, top: 0, width: 200, height: 100 };

  const cut = await cutBytes(source, { x: 0, y: 0, width: 0.5, height: 0.5 });
  const asTheBrowserWould = await sharp(source)
    .extract(region)
    .jpeg({ quality: Math.round(CROP_JPEG_QUALITY * 100) })
    .toBuffer();
  assert.deepEqual(Buffer.from(cut.bytes), asTheBrowserWould);

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

test("thumbnailOf reads the frame's own size when handed none", async () => {
  const made = await thumbnailOf(await frame(400, 200, "jpeg"));
  assert.deepEqual({ width: made.width, height: made.height }, { width: 400, height: 200 });
  assert.equal(made.thumbnail, null);
});

test("thumbnailOf reads a rotated frame upright", async () => {
  const made = await thumbnailOf(await frame(400, 200, "jpeg", 6));
  assert.deepEqual({ width: made.width, height: made.height }, { width: 200, height: 400 });
});

test("thumbnailOf makes a box-sized jpeg copy of a frame past the grid", async () => {
  const made = await thumbnailOf(await frame(4000, 2000, "jpeg"));
  assert.deepEqual({ width: made.width, height: made.height }, { width: 4000, height: 2000 });

  assert.ok(made.thumbnail);
  assert.equal(made.thumbnail.contentType, "image/jpeg");
  const thumb = await sharp(made.thumbnail.bytes).metadata();
  assert.equal(thumb.format, "jpeg");
  const box = thumbnailBox(4000, 2000);
  assert.deepEqual(
    { width: thumb.width, height: thumb.height },
    { width: box.width, height: box.height },
  );
});

test("thumbnailOf refuses bytes that are not an image", async () => {
  await assert.rejects(() => thumbnailOf(new Uint8Array([1, 2, 3, 4])), /decode|unsupported|input/i);
});

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

test("an empty list of edits is the cut nothing was asked of", async () => {
  const source = await frame(400, 200, "jpeg");
  const region = { x: 0, y: 0, width: 0.5, height: 0.5 };

  const plain = await cutBytes(source, region);
  const asked = await cutBytes(source, region, []);
  assert.deepEqual(Buffer.from(asked.bytes), Buffer.from(plain.bytes));
});

test("a quarter turn swaps the edges on the row and in the bytes alike", async () => {
  const cut = await cutBytes(await frame(400, 400, "jpeg"), {
    x: 0,
    y: 0,
    width: 0.25,
    height: 0.5,
  }, [{ op: "turn", turn: "right" }]);

  assert.deepEqual({ width: cut.width, height: cut.height }, { width: 200, height: 100 });
  const size = await sharp(cut.bytes).metadata();
  assert.deepEqual({ width: size.width, height: size.height }, { width: 200, height: 100 });
});

test("a half turn leaves the edges where they were", async () => {
  const cut = await cutBytes(await frame(400, 400, "jpeg"), {
    x: 0,
    y: 0,
    width: 0.25,
    height: 0.5,
  }, [{ op: "turn", turn: "upside-down" }]);

  assert.deepEqual({ width: cut.width, height: cut.height }, { width: 100, height: 200 });
});

test("a right turn carries the marked corner from the top left to the top right", async () => {
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const cut = await cutBytes(await frame(200, 200, "png"), whole, [
    { op: "turn", turn: "right" },
  ]);

  assert.ok(isGreen(await pixel(cut.bytes, 197, 1)), "the marker turned to the top right");
  assert.ok(!isGreen(await pixel(cut.bytes, 1, 1)), "and is no longer at the top left");
});

test("a left turn carries it to the bottom left instead", async () => {
  const cut = await cutBytes(await frame(200, 200, "png"), { x: 0, y: 0, width: 1, height: 1 }, [
    { op: "turn", turn: "left" },
  ]);

  assert.ok(isGreen(await pixel(cut.bytes, 1, 197)), "the marker turned to the bottom left");
});

test("a horizontal flip is left to right, not top to bottom", async () => {
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const source = await frame(200, 200, "png");

  const flopped = await cutBytes(source, whole, [{ op: "flip", axis: "horizontal" }]);
  assert.ok(isGreen(await pixel(flopped.bytes, 197, 1)), "the marker crossed to the top right");

  const flipped = await cutBytes(source, whole, [{ op: "flip", axis: "vertical" }]);
  assert.ok(isGreen(await pixel(flipped.bytes, 1, 197)), "and the other axis to the bottom left");
});

test("flipping both ways is the same picture as turning it upside down", async () => {
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const source = await frame(200, 100, "png");

  const flipped = await cutBytes(source, whole, [{ op: "flip", axis: "both" }]);
  const turned = await cutBytes(source, whole, [{ op: "turn", turn: "upside-down" }]);
  assert.deepEqual(Buffer.from(flipped.bytes), Buffer.from(turned.bytes));
});

test("a grade at the bottom of the saturation knob greys the field out", async () => {
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const source = await frame(200, 100, "png");

  const grey = await cutBytes(source, whole, [
    { op: "grade", brightness: 0, contrast: 0, saturation: -100, warmth: 0, hue: 0 },
  ]);
  const [r, g, b] = await pixel(grey.bytes, 100, 50);
  assert.ok(Math.abs(r! - g!) < 6 && Math.abs(g! - b!) < 6, `the red field is still ${r},${g},${b}`);

  const plain = await cutBytes(source, whole);
  const [red, green] = await pixel(plain.bytes, 100, 50);
  assert.ok(red! - green! > 100, "and it was red before the grade");
});

test("warmth lifts the red channel and drops the blue one", async () => {
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const grey = (hex: string) =>
    sharp({ create: { width: 40, height: 40, channels: 3, background: hex } })
      .png()
      .toBuffer()
      .then((bytes) => new Uint8Array(bytes));
  const warmth = (knob: number) =>
    ({ op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: knob, hue: 0 }) as const;

  const light = await cutBytes(await grey("#c0c0c0"), whole, [warmth(100)]);
  const [r, , b] = await pixel(light.bytes, 20, 20);
  assert.ok(r! > 192 && b! < 192, `a light grey warmed to ${r},${b}`);

  const cooled = await cutBytes(await grey("#c0c0c0"), whole, [warmth(-100)]);
  const [red, , blue] = await pixel(cooled.bytes, 20, 20);
  assert.ok(red! < 192 && blue! > 192, `and cooled to ${red},${blue}`);
});

test("warmth pivots on mid-grey exactly as contrast does, so it splits the tones", async () => {
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const source = new Uint8Array(
    await sharp({ create: { width: 40, height: 40, channels: 3, background: "#808080" } })
      .png()
      .toBuffer(),
  );

  const warm = await cutBytes(source, whole, [
    { op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: 100, hue: 0 },
  ]);
  const [r, g, b] = await pixel(warm.bytes, 20, 20);
  for (const channel of [r, g, b]) {
    assert.ok(Math.abs(channel! - 128) <= 1, `mid-grey moved to ${channel}`);
  }
});

test("contrast pivots on mid-grey rather than on black", async () => {
  const whole = { x: 0, y: 0, width: 1, height: 1 };
  const source = new Uint8Array(
    await sharp({ create: { width: 40, height: 40, channels: 3, background: "#808080" } })
      .png()
      .toBuffer(),
  );

  const punchy = await cutBytes(source, whole, [
    { op: "grade", brightness: 0, contrast: 60, saturation: 0, warmth: 0, hue: 0 },
  ]);
  const [r, g, b] = await pixel(punchy.bytes, 20, 20);
  for (const channel of [r, g, b]) {
    assert.ok(Math.abs(channel! - 128) <= 1, `mid-grey moved to ${channel}`);
  }
});

test("a turn and a grade in one list are both in the bytes", async () => {
  const cut = await cutBytes(await frame(200, 100, "png"), { x: 0, y: 0, width: 1, height: 1 }, [
    { op: "turn", turn: "right" },
    { op: "grade", brightness: 0, contrast: 0, saturation: -100, warmth: 0, hue: 0 },
  ]);

  assert.deepEqual({ width: cut.width, height: cut.height }, { width: 100, height: 200 });
  const [r, g, b] = await pixel(cut.bytes, 50, 100);
  assert.ok(Math.abs(r! - g!) < 6 && Math.abs(g! - b!) < 6, "and the field is grey");
});
