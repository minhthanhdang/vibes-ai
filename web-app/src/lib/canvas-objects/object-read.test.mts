import { test } from "node:test";
import assert from "node:assert/strict";

import { canvasObjects, canvasRead, type CanvasObject } from "@/lib/canvas-objects/object-read";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";

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

function words(id: string, text: string, box: Box, extra: object = {}) {
  return { id, type: "text", text, ...box, ...extra };
}

function shape(id: string, type: string, box: Box, extra: object = {}) {
  return { id, type, ...box, ...extra };
}

function byId(objects: readonly CanvasObject[] | null, id: string): CanvasObject {
  const found = objects?.find((object) => object.objectId === id);
  assert.ok(found, `no object ${id}`);
  return found;
}

test("an empty scene reads as no objects, and a non-array as none rather than a throw", () => {
  assert.deepEqual(canvasObjects([]), []);
  assert.deepEqual(canvasObjects(undefined), []);
});

test("a photo on a page is a thousandths box with the page's id, and the page is an object too", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("el-1", "ref-a", { x: 0, y: 0, width: HD.width / 2, height: HD.height }),
  ]);

  assert.deepEqual(objects, [
    {
      objectId: "p1",
      kind: "page",
      box: [0, 0, HD.height, HD.width],
      boxUnit: "px",
      z: 0,
      name: "Page 1",
      preset: "LANDSCAPE_HD",
      size: { width: HD.width, height: HD.height },
    },
    {
      objectId: "el-1",
      kind: "image",
      referenceId: "ref-a",
      box: [0, 0, 1000, 500],
      boxUnit: "thousandths",
      z: 0,
      pageId: "p1",
    },
  ]);
});

test("a photo loose on the canvas crosses in scene pixels with no pageId", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("loose", "ref-b", { x: 2500, y: 100, width: 320, height: 240 }),
  ]);

  const loose = byId(objects, "loose");
  assert.deepEqual(loose.box, [100, 2500, 340, 2820]);
  assert.equal(loose.boxUnit, "px");
  assert.equal("pageId" in loose, false);
});

test("a photo whose centre is off the page is loose however much of it overlaps", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("edge", "ref-c", { x: HD.width - 100, y: 0, width: 400, height: 300 }),
  ]);

  assert.equal("pageId" in byId(objects, "edge"), false);
});

test("where two pages overlap the topmost holds the photo", () => {
  const objects = canvasObjects([
    pageFrame("under", { x: 0, y: 0, ...HD }),
    pageFrame("over", { x: HD.width / 2, y: 0, ...HD }, "Page 2"),
    photo("shared", "ref-d", { x: HD.width - 400, y: 100, width: 300, height: 300 }),
  ]);

  const shared = byId(objects, "shared");
  assert.equal(shared.pageId, "over");
});

test("a photo over the page edge is clipped and its box clamped to the page's 0-1000", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("hangs", "ref-e", { x: -200, y: 0, width: 600, height: 540 }),
  ]);

  const hangs = byId(objects, "hangs");
  assert.equal(hangs.clipped, true);
  assert.deepEqual(hangs.box, [0, 0, 500, 208]);
});

test("angle crosses in degrees while the scene stores radians, absent when straight", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("tilted", "ref-f", { x: 100, y: 100, width: 200, height: 200 }, { angle: Math.PI / 2 }),
    photo("straight", "ref-g", { x: 600, y: 100, width: 200, height: 200 }),
  ]);

  assert.equal(byId(objects, "tilted").angle, 90);
  assert.equal("angle" in byId(objects, "straight"), false);
});

test("locked crosses present-or-absent, on members and on the page frame itself", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    { ...pageFrame("p2", { x: HD.width + PAGE_GAP, y: 0, ...HD }, "Page 2"), locked: true },
    photo("held", "ref-h", { x: 100, y: 100, width: 200, height: 200 }, { locked: true }),
    photo("free", "ref-i", { x: 600, y: 100, width: 200, height: 200 }),
  ]);

  assert.equal(byId(objects, "held").locked, true);
  assert.equal(byId(objects, "p2").locked, true);
  assert.equal("locked" in byId(objects, "free"), false);
  assert.equal("locked" in byId(objects, "p1"), false);
});

test("z is the scene's stacking among the page's members while the list reads top-left first", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("later-but-left", "ref-j", { x: 1200, y: 600, width: 300, height: 300 }),
    photo("on-top", "ref-k", { x: 100, y: 100, width: 300, height: 300 }),
  ]);

  const [, first, second] = objects!;
  assert.equal(first!.objectId, "on-top");
  assert.equal(first!.z, 1);
  assert.equal(second!.objectId, "later-but-left");
  assert.equal(second!.z, 0);
});

test("a line crosses with its words, and a pasted essay is clamped with the cut said", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    words("caption", "THE COLD HALF", { x: 100, y: 100, width: 400, height: 60 }),
    words("essay", "a".repeat(400), { x: 100, y: 300, width: 400, height: 200 }),
  ]);

  const caption = byId(objects, "caption");
  assert.equal(caption.kind === "text" && caption.text, "THE COLD HALF");
  assert.equal("clamped" in caption, false);
  const essay = byId(objects, "essay");
  assert.ok(essay.kind === "text" && essay.clamped);
  assert.ok(essay.kind === "text" && essay.text.length < 400);
});

test("a line of type carries the colour, size, family and alignment it is set in", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    words("headline", "THE COLD HALF", { x: 100, y: 100, width: 800, height: 120 }, {
      strokeColor: "#f2e8dc",
      fontSize: 96,
      fontFamily: 7,
      textAlign: "center",
    }),
  ]);

  assert.deepEqual(byId(objects, "headline"), {
    objectId: "headline",
    kind: "text",
    text: "THE COLD HALF",
    colour: "#f2e8dc",
    fontSize: 96,
    font: "display",
    align: "center",
    box: [93, 52, 204, 469],
    boxUnit: "thousandths",
    z: 0,
    pageId: "p1",
  });
});

test("the hand family and type set left are said by their absence, not on every line", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    words("plain", "a caption", { x: 100, y: 100, width: 400, height: 40 }, {
      fontFamily: 5,
      textAlign: "left",
    }),
  ]);

  const plain = byId(objects, "plain");
  assert.equal("font" in plain, false);
  assert.equal("align" in plain, false);
});

test("a text element missing every type field reads what the picture set it in", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    words("bare", "words", { x: 100, y: 100, width: 200, height: 25 }),
  ]);

  const bare = byId(objects, "bare");
  assert.equal(bare.kind === "text" && bare.colour, "#1e1e1e");
  assert.equal(bare.kind === "text" && bare.fontSize, 20);
  assert.equal("font" in bare, false);
});

test("a family outside the five is named other, and the sans twin is named sans", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    words("twin", "one", { x: 100, y: 100, width: 200, height: 25 }, { fontFamily: 9 }),
    words("older", "two", { x: 100, y: 200, width: 200, height: 25 }, { fontFamily: 1 }),
    words("nonsense", "three", { x: 100, y: 300, width: 200, height: 25 }, { fontFamily: 42 }),
  ]);

  assert.equal(byId(objects, "twin").kind === "text" && (byId(objects, "twin") as { font?: string }).font, "sans");
  assert.equal((byId(objects, "older") as { font?: string }).font, "other");
  assert.equal("font" in byId(objects, "nonsense"), false);
});

test("a faded photograph and a faded line of type carry their opacity, a whole one does not", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("scrim", "ref-a", { x: 0, y: 0, width: 960, height: 1080 }, { opacity: 40 }),
    photo("whole", "ref-b", { x: 1000, y: 0, width: 400, height: 400 }),
    words("grey", "under it", { x: 100, y: 100, width: 400, height: 40 }, { opacity: 30 }),
  ]);

  assert.equal((byId(objects, "scrim") as { opacity?: number }).opacity, 40);
  assert.equal("opacity" in byId(objects, "whole"), false);
  assert.equal((byId(objects, "grey") as { opacity?: number }).opacity, 30);
});

test("tombstones, arrows and sections are not objects — images, text, shapes and pages are", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    { id: "section", type: "frame", x: 100, y: 100, width: 500, height: 500 },
    { id: "arrow", type: "arrow", x: 100, y: 100, width: 200, height: 10, points: [[0, 0]] },
    shape("chip", "rectangle", { x: 700, y: 100, width: 96, height: 128 }),
    photo("gone", "ref-l", { x: 100, y: 700, width: 200, height: 200 }, { isDeleted: true }),
    photo("here", "ref-m", { x: 400, y: 700, width: 200, height: 200 }),
  ]);

  assert.deepEqual(
    objects!.map((object) => object.objectId),
    ["p1", "chip", "here"],
  );
});

test("a rectangle, an ellipse and a line are objects carrying their own appearance", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    shape("block", "rectangle", { x: 0, y: 0, width: 960, height: 1080 }, {
      backgroundColor: "#8b2f1d",
      strokeColor: "#1e1e1e",
      strokeWidth: 2,
      roundness: { type: 3 },
      opacity: 40,
    }),
    shape("dot", "ellipse", { x: 1200, y: 100, width: 200, height: 200 }, {
      backgroundColor: "transparent",
      strokeColor: "#ffffff",
      strokeWidth: 4,
      strokeStyle: "dashed",
    }),
    shape("rule", "line", { x: 100, y: 900, width: 900, height: 0 }, {
      strokeColor: "#0b3d2e",
    }),
  ]);

  assert.deepEqual(byId(objects, "block"), {
    objectId: "block",
    kind: "shape",
    shape: "rectangle",
    fill: "#8b2f1d",
    stroke: "#1e1e1e",
    strokeWidth: 2,
    rounded: true,
    opacity: 40,
    box: [0, 0, 1000, 500],
    boxUnit: "thousandths",
    z: 0,
    pageId: "p1",
  });

  const dot = byId(objects, "dot");
  assert.equal(dot.kind === "shape" && dot.fill, "transparent");
  assert.equal(dot.kind === "shape" && dot.strokeStyle, "dashed");
  assert.equal("rounded" in dot, false);
  assert.equal("opacity" in dot, false);

  const rule = byId(objects, "rule");
  assert.equal(rule.kind === "shape" && rule.shape, "line");
  assert.equal(rule.kind === "shape" && rule.stroke, "#0b3d2e");
});

test("a shape missing every appearance field reads excalidraw's defaults, not zeroes", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    shape("bare", "rectangle", { x: 100, y: 100, width: 200, height: 200 }),
  ]);

  const bare = byId(objects, "bare");
  assert.equal(bare.kind === "shape" && bare.fill, "transparent");
  assert.equal(bare.kind === "shape" && bare.stroke, "#1e1e1e");
  assert.equal(bare.kind === "shape" && bare.strokeWidth, 1);
  assert.equal("strokeStyle" in bare, false);
});

test("a rule reads no fill, whatever colour the toolbar left on it", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    shape("rule", "line", { x: 100, y: 900, width: 900, height: 0 }, {
      backgroundColor: "#ffcc00",
      strokeColor: "#0b3d2e",
      points: [[0, 0], [900, 0]],
    }),
  ]);

  const rule = byId(objects, "rule");
  assert.equal(rule.kind === "shape" && rule.fill, "transparent");
  assert.equal(rule.kind === "shape" && rule.stroke, "#0b3d2e");
});

test("a shape with one extent and no area is still an object, unlike a photo with none", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    shape("flat", "line", { x: 100, y: 500, width: 800, height: 0 }),
    photo("nothing", "ref-s", { x: 100, y: 100, width: 0, height: 0 }),
    shape("point", "rectangle", { x: 100, y: 100, width: 0, height: 0 }),
  ]);

  assert.deepEqual(
    objects!.map((object) => object.objectId),
    ["p1", "flat"],
  );
});

test("a bound label is not a handle, and is named in the remainder rather than lost", () => {
  const read = canvasRead([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    shape("swatch", "rectangle", { x: 100, y: 100, width: 96, height: 128 }),
    words("hex", "#8B2F1D", { x: 100, y: 200, width: 96, height: 20 }, { containerId: "swatch" }),
    words("free", "THE COLD HALF", { x: 400, y: 100, width: 400, height: 60 }),
  ]);

  assert.deepEqual(
    read!.objects.map((object) => object.objectId),
    ["p1", "swatch", "free"],
  );
  assert.equal(
    read!.unaddressable,
    "1 thing on this board is not an object you can address: 1 label bound to a shape",
  );
});

test("arrows, diamonds, freehand strokes and embeds are counted and named, never silently absent", () => {
  const read = canvasRead([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    shape("a1", "arrow", { x: 100, y: 100, width: 200, height: 10 }),
    shape("a2", "arrow", { x: 100, y: 300, width: 200, height: 10 }),
    shape("d1", "diamond", { x: 400, y: 100, width: 100, height: 100 }),
    shape("f1", "freedraw", { x: 600, y: 100, width: 300, height: 200 }),
    shape("e1", "embeddable", { x: 1000, y: 100, width: 400, height: 300 }),
    shape("gone", "arrow", { x: 100, y: 500, width: 200, height: 10 }, { isDeleted: true }),
  ]);

  assert.deepEqual(
    read!.objects.map((object) => object.objectId),
    ["p1"],
  );
  assert.equal(
    read!.unaddressable,
    "5 things on this board are not objects you can address: 2 arrows, 1 diamond, 1 freehand drawing, 1 embed",
  );
});

test("nothing unaddressable is no remainder at all, and a page read counts only that page's", () => {
  const second = { x: HD.width + PAGE_GAP, y: 0, ...HD };
  const scene = [
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    pageFrame("p2", second, "Page 2"),
    shape("on-first", "arrow", { x: 100, y: 100, width: 200, height: 10 }),
    shape("on-second", "freedraw", { x: second.x + 100, y: 100, width: 200, height: 200 }),
  ];

  assert.equal(
    canvasRead(scene, { pageId: "p2" })!.unaddressable,
    "1 thing on this page is not an object you can address: 1 freehand drawing",
  );
  assert.equal("unaddressable" in canvasRead([pageFrame("p1", { x: 0, y: 0, ...HD })])!, false);
});

test("a rounded photograph says so, and a square one says nothing at all", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("soft", "ref-a", { x: 100, y: 100, width: 200, height: 200 }, {
      roundness: { type: 3 },
    }),
    photo("hard", "ref-b", { x: 400, y: 100, width: 200, height: 200 }),
  ]);

  const soft = byId(objects, "soft");
  assert.equal(soft.kind === "image" && soft.rounded, true);
  assert.equal("rounded" in byId(objects, "hard"), false);
});

test("an image naming nothing the project holds is still an object, referenceId null", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("foreign", null, { x: 100, y: 100, width: 200, height: 200 }),
  ]);

  const foreign = byId(objects, "foreign");
  assert.equal(foreign.kind === "image" && foreign.referenceId, null);
});

test("asking for one page answers that page and its members alone", () => {
  const second = { x: HD.width + PAGE_GAP, y: 0, ...HD };
  const objects = canvasObjects(
    [
      pageFrame("p1", { x: 0, y: 0, ...HD }),
      pageFrame("p2", second, "Page 2"),
      photo("on-first", "ref-n", { x: 100, y: 100, width: 200, height: 200 }),
      photo("on-second", "ref-o", { x: second.x + 100, y: 100, width: 200, height: 200 }),
      photo("loose", "ref-p", { x: -1000, y: -1000, width: 200, height: 200 }),
    ],
    { pageId: "p2" },
  );

  assert.deepEqual(
    objects!.map((object) => object.objectId),
    ["p2", "on-second"],
  );
});

test("an unknown pageId is null, not an empty read", () => {
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD })];

  assert.equal(canvasObjects(scene, { pageId: "nope" }), null);
  assert.deepEqual(
    canvasObjects(scene, { pageId: "p1" })!.map((object) => object.objectId),
    ["p1"],
  );
});

test("pages read in reading order with z as their own stacking", () => {
  const objects = canvasObjects([
    pageFrame("right-but-first", { x: HD.width + PAGE_GAP, y: 0, ...HD }, "Page 2"),
    pageFrame("left-but-second", { x: 0, y: 0, ...HD }),
  ]);

  assert.deepEqual(
    objects!.map((object) => [object.objectId, object.z]),
    [
      ["left-but-second", 1],
      ["right-but-first", 0],
    ],
  );
});

test("membership is geometry, not frameId", () => {
  const objects = canvasObjects([
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("dragged-off", "ref-q", { x: 5000, y: 5000, width: 200, height: 200 }, { frameId: "p1" }),
    photo("never-adopted", "ref-r", { x: 100, y: 100, width: 200, height: 200 }, { frameId: null }),
  ]);

  assert.equal("pageId" in byId(objects, "dragged-off"), false);
  assert.equal(byId(objects, "never-adopted").pageId, "p1");
});

test("a page's own ground is not an object — it reads as the page's background", () => {
  const box = { x: 0, y: 0, width: HD.width, height: HD.height };
  const scene = [
    { ...shape("ground", "rectangle", box, { backgroundColor: "#0c111c", locked: true }), customData: { pageBackground: true } },
    photo("p1", "sketch", { x: 100, y: 100, width: 400, height: 300 }),
    pageFrame("page_1", box),
  ];

  const read = canvasRead(scene)!;
  assert.deepEqual(
    read.objects.map((object) => object.objectId),
    ["page_1", "p1"],
    "the ground carries no handle at all",
  );
  const page = read.objects[0] as Extract<CanvasObject, { kind: "page" }>;
  assert.equal(page.background, "#0c111c");
  assert.equal(read.unaddressable, undefined, "it is reported as the page's colour, not as a remainder");
});

test("a page standing on nothing says nothing about a background", () => {
  const box = { x: 0, y: 0, width: HD.width, height: HD.height };
  const read = canvasRead([photo("p1", "sketch", { x: 10, y: 10, width: 100, height: 100 }), pageFrame("page_1", box)])!;
  const page = read.objects[0] as Extract<CanvasObject, { kind: "page" }>;
  assert.equal("background" in page, false);
});
