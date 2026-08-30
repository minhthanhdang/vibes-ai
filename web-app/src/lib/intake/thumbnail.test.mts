import { test } from "node:test";
import assert from "node:assert/strict";

const { thumbnailBox, THUMBNAIL_MAX_EDGE } = await import("@/lib/intake/thumbnail");

test("the longest edge lands on the box and the aspect ratio survives", () => {
  const landscape = thumbnailBox(4000, 3000, 640);
  assert.deepEqual(landscape, { width: 640, height: 480, isNeeded: true });

  const portrait = thumbnailBox(3000, 4000, 640);
  assert.deepEqual(portrait, { width: 480, height: 640, isNeeded: true });
});

test("an image already inside the box needs no thumbnail", () => {
  assert.equal(thumbnailBox(320, 200, 640).isNeeded, false);
  assert.equal(thumbnailBox(640, 640, 640).isNeeded, false);
  assert.equal(thumbnailBox(641, 640, 640).isNeeded, true);
});

test("a small image is never upscaled", () => {
  const box = thumbnailBox(100, 50, 640);
  assert.deepEqual(box, { width: 100, height: 50, isNeeded: false });
});

test("an extreme aspect ratio still yields a drawable canvas", () => {
  const box = thumbnailBox(10000, 3, 640);
  assert.equal(box.width, 640);
  assert.equal(box.height, 1);
});

test("the default box is the exported max edge", () => {
  assert.deepEqual(thumbnailBox(2 * THUMBNAIL_MAX_EDGE, 2 * THUMBNAIL_MAX_EDGE), {
    width: THUMBNAIL_MAX_EDGE,
    height: THUMBNAIL_MAX_EDGE,
    isNeeded: true,
  });
});
