import { test } from "node:test";
import assert from "node:assert/strict";

import { canvasObjects } from "@/lib/canvas-objects/object-read";
import { objectShape } from "@/lib/canvas-objects/object-shape";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

type Box = { x: number; y: number; width: number; height: number };

function pageFrame(id: string, box: Box, name = "Page 1") {
  return { id, type: "frame", name, ...box, customData: { page: true } };
}

function photo(id: string, referenceId: string | null, box: Box, extra: object = {}) {
  return {
    id,
    type: "image",
    fileId: referenceId ? `ref:${referenceId}` : "abc123",
    ...box,
    ...extra,
  };
}

const PAGE: Box = { x: 0, y: 0, width: HD.width, height: HD.height };

test("an object on a page is measured back into pixels of that page", () => {
  const objects = canvasObjects([
    pageFrame("page-1", PAGE),
    /// A quarter of the page's width against an eighth of its height, which on
    /// a 16:9 page is 3.56:1 — a shape no name on the list carries.
    photo("obj-1", "ref-1", {
      x: 0,
      y: 0,
      width: HD.width / 4,
      height: HD.height / 8,
    }),
  ]);

  const shape = objectShape(objects!, "obj-1");
  assert.equal(shape?.width, Math.round(HD.width / 4));
  assert.equal(shape?.height, Math.round(HD.height / 8));
  assert.equal(shape?.shape.ratio, 3.56);
  assert.equal(shape?.shape.label, "3.56:1");
  assert.equal(shape?.pageId, "page-1");
  assert.equal(shape?.referenceId, "ref-1");
  assert.equal(shape?.kind, "image");
});

test("a box near a named format comes back under the name", () => {
  const objects = canvasObjects([
    pageFrame("page-1", PAGE),
    photo("obj-1", "ref-1", { x: 0, y: 0, width: 640, height: 360 }),
  ]);

  assert.equal(objectShape(objects!, "obj-1")?.shape.label, "16:9");
});

test("an object loose on the canvas is measured in the pixels it is already in", () => {
  const objects = canvasObjects([photo("obj-1", "ref-1", { x: 40, y: 40, width: 300, height: 300 })]);

  const shape = objectShape(objects!, "obj-1");
  assert.equal(shape?.shape.label, "1:1");
  assert.equal(shape?.width, 300);
  assert.equal(shape?.height, 300);
  assert.equal(shape?.pageId, undefined);
});

test("a page is measured off its recorded size rather than off its rounded box", () => {
  const objects = canvasObjects([pageFrame("page-1", { ...PAGE, x: 12.4, y: 7.6 }, "Act one")]);

  const shape = objectShape(objects!, "page-1");
  assert.equal(shape?.kind, "page");
  assert.equal(shape?.name, "Act one");
  assert.equal(shape?.width, HD.width);
  assert.equal(shape?.height, HD.height);
  assert.equal(shape?.shape.label, "16:9");
});

test("the shape is read off the clipped box, which is the box the model was shown", () => {
  /// Half of it hangs off the right edge, so `read_canvas` reports the visible
  /// half — a square picture showing as a rectangle twice as tall as it is wide
  /// — and the cut is held to what shows rather than to the whole.
  const objects = canvasObjects([
    pageFrame("page-1", PAGE),
    photo("obj-1", "ref-1", {
      x: HD.width - 200,
      y: 0,
      width: 400,
      height: 400,
    }),
  ]);

  const shape = objectShape(objects!, "obj-1");
  assert.equal(shape?.clipped, true);
  assert.equal(shape?.width, 200);
  assert.equal(shape?.height, 400);
  assert.equal(shape?.shape.label, "0.50:1");
});

test("a handle the board does not carry has no shape", () => {
  const objects = canvasObjects([pageFrame("page-1", PAGE)]);
  assert.equal(objectShape(objects!, "obj-9"), null);
});

test("a box with no area has no shape", () => {
  const objects = canvasObjects([
    pageFrame("page-1", PAGE),
    photo("obj-1", "ref-1", { x: 100, y: 100, width: 0.2, height: 200 }),
  ]);

  assert.equal(objectShape(objects!, "obj-1"), null);
});

test("a sliver past what a cut can be held to has no shape", () => {
  const objects = canvasObjects([
    photo("obj-1", "ref-1", { x: 0, y: 0, width: 4000, height: 20 }),
  ]);

  assert.equal(objectShape(objects!, "obj-1"), null);
});

test("an image naming nothing the project holds still has a shape", () => {
  const objects = canvasObjects([
    pageFrame("page-1", PAGE),
    photo("obj-1", null, { x: 0, y: 0, width: 400, height: 400 }),
  ]);

  const shape = objectShape(objects!, "obj-1");
  assert.equal(shape?.referenceId, undefined);
  assert.equal(shape?.shape.label, "1:1");
});

test("text is an object with a shape like any other", () => {
  const objects = canvasObjects([
    pageFrame("page-1", PAGE),
    { id: "obj-1", type: "text", text: "Act one", x: 0, y: 0, width: 600, height: 200 },
  ]);

  const shape = objectShape(objects!, "obj-1");
  assert.equal(shape?.kind, "text");
  assert.equal(shape?.shape.label, "3.00:1");
});

test("a page-scoped read still measures its members, because the page came with them", () => {
  const objects = canvasObjects(
    [
      pageFrame("page-1", PAGE),
      photo("obj-1", "ref-1", { x: 0, y: 0, width: 400, height: 400 }),
    ],
    { pageId: "page-1" },
  );

  assert.equal(objectShape(objects!, "obj-1")?.shape.label, "1:1");
});
