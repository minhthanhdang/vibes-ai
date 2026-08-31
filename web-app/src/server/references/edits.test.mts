import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { EDIT_PREVIEW_MAX_EDGE, EDIT_PREVIEW_TYPE, previewOf } = await import("./edits");

const field = async (width: number, height: number, background = "#ff0000") =>
  new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer(),
  );

const decoded = async (base64: string) => sharp(Buffer.from(base64, "base64")).metadata();

test("a preview is a jpeg inside the edge the model is shown at", async () => {
  const preview = await previewOf(await field(4000, 2000), [
    { op: "grade", brightness: 0, contrast: 0, saturation: -100, warmth: 0, hue: 0 },
  ]);

  assert.ok(preview);
  assert.equal(preview.mimeType, EDIT_PREVIEW_TYPE);
  const size = await decoded(preview.base64);
  assert.equal(size.format, "jpeg");
  assert.equal(Math.max(size.width ?? 0, size.height ?? 0), EDIT_PREVIEW_MAX_EDGE);
});

test("a picture already inside the edge is not blown up to reach it", async () => {
  const preview = await previewOf(await field(200, 100), [{ op: "turn", turn: "upside-down" }]);

  assert.ok(preview);
  const size = await decoded(preview.base64);
  assert.deepEqual({ width: size.width, height: size.height }, { width: 200, height: 100 });
});

test("the crop op frames the preview, so the model judges the cut it planned", async () => {
  const source = new Uint8Array(
    await sharp({ create: { width: 200, height: 100, channels: 3, background: "#ff0000" } })
      .composite([
        {
          input: await sharp({
            create: { width: 100, height: 100, channels: 3, background: "#00ff00" },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer(),
  );

  const preview = await previewOf(source, [{ op: "crop", box: [0, 0, 1000, 500] }]);
  assert.ok(preview);
  const size = await decoded(preview.base64);
  assert.deepEqual({ width: size.width, height: size.height }, { width: 100, height: 100 });

  const { data } = await sharp(Buffer.from(preview.base64, "base64"))
    .extract({ left: 50, top: 50, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(data[1]! > 200 && data[0]! < 80, "the preview is of the green half the crop kept");
});

test("a quarter turn is in the preview's own edges", async () => {
  const preview = await previewOf(await field(200, 100), [{ op: "turn", turn: "right" }]);

  assert.ok(preview);
  const size = await decoded(preview.base64);
  assert.deepEqual({ width: size.width, height: size.height }, { width: 100, height: 200 });
});

test("bytes that cannot be decoded are refused here, and swallowed by the previewer above", async () => {
  await assert.rejects(() => previewOf(new Uint8Array([1, 2, 3, 4]), []));
});
