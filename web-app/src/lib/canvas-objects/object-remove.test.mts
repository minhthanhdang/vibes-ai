import { test } from "node:test";
import assert from "node:assert/strict";

import { removeObjects } from "@/lib/canvas-objects/object-remove";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

type Box = { x: number; y: number; width: number; height: number };

function pageFrame(id: string, box: Box, name = "Page 1", extra: object = {}) {
  return { id, type: "frame", name, ...box, customData: { page: true }, ...extra };
}

function photo(id: string, referenceId: string, box: Box, extra: object = {}) {
  return { id, type: "image", fileId: `ref:${referenceId}`, ...box, ...extra };
}

function line(id: string, text: string, box: Box, extra: object = {}) {
  return { id, type: "text", text, ...box, ...extra };
}

function ids(elements: readonly SceneElement[] | null): string[] {
  return (elements ?? []).map((element) => element.id);
}

test("an objectId takes exactly that element out of the array — dropped, not tombstoned", () => {
  const scene = [
    photo("a", "ref-a", { x: 0, y: 0, width: 300, height: 200 }),
    photo("b", "ref-b", { x: 400, y: 0, width: 300, height: 200 }),
  ];
  const result = removeObjects(scene, ["a"]);

  assert.deepEqual(ids(result.elements), ["b"]);
  assert.deepEqual(result.removed, [{ object: "a", kind: "image", count: 1 }]);
  assert.deepEqual(result.notOnBoard, []);
  assert.deepEqual(result.refused, []);
});

test("a bound label goes with its container", () => {
  const scene = [
    photo("a", "ref-a", { x: 0, y: 0, width: 300, height: 200 }),
    line("cap", "the sunset", { x: 0, y: 210, width: 300, height: 30 }, { containerId: "a" }),
    photo("b", "ref-b", { x: 400, y: 0, width: 300, height: 200 }),
  ];
  const result = removeObjects(scene, ["a"]);

  assert.deepEqual(ids(result.elements), ["b"]);
  assert.deepEqual(result.removed, [{ object: "a", kind: "image", count: 2 }]);
});

test("locked is refused, never half-honoured", () => {
  const scene = [photo("a", "ref-a", { x: 0, y: 0, width: 300, height: 200 }, { locked: true })];
  const result = removeObjects(scene, ["a"]);

  assert.equal(result.elements, null);
  assert.deepEqual(result.refused, [{ object: "a", reason: "locked" }]);
});

test("a pageId takes the page and what stands on it, and unframes what merely named it", () => {
  const scene = [
    photo("m1", "ref-a", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
    photo("m2", "ref-b", { x: 500, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("stray", "ref-c", { x: HD.width + 500, y: 0, width: 300, height: 200 }, { frameId: "p1" }),
  ];
  const result = removeObjects(scene, ["p1"]);

  assert.deepEqual(ids(result.elements), ["stray"]);
  assert.equal(result.elements![0]!.frameId, null);
  assert.deepEqual(result.removed, [{ object: "p1", kind: "page", count: 3 }]);
});

test("a locked page is refused", () => {
  const scene = [pageFrame("p1", { x: 0, y: 0, ...HD }, "Page 1", { locked: true })];
  const result = removeObjects(scene, ["p1"]);

  assert.equal(result.elements, null);
  assert.deepEqual(result.refused, [{ object: "p1", reason: "locked" }]);
});

test("a referenceId takes every element pointing at it, so a photo dropped twice leaves once", () => {
  const scene = [
    photo("a", "ref-a", { x: 0, y: 0, width: 300, height: 200 }),
    photo("b", "ref-a", { x: 400, y: 0, width: 300, height: 200 }),
    photo("c", "ref-b", { x: 800, y: 0, width: 300, height: 200 }),
  ];
  const result = removeObjects(scene, ["ref-a"]);

  assert.deepEqual(ids(result.elements), ["c"]);
  assert.deepEqual(result.removed, [{ object: "ref-a", kind: "reference", count: 2 }]);
});

test("a reference with a locked copy is refused whole rather than half-removed", () => {
  const scene = [
    photo("a", "ref-a", { x: 0, y: 0, width: 300, height: 200 }),
    photo("b", "ref-a", { x: 400, y: 0, width: 300, height: 200 }, { locked: true }),
  ];
  const result = removeObjects(scene, ["ref-a"]);

  assert.equal(result.elements, null);
  assert.equal(result.refused.length, 1);
  assert.match(result.refused[0]!.reason, /locked/);
});

test("a line leaves by its words, surviving a retyped capital and a doubled space", () => {
  const scene = [
    line("t1", "Act One", { x: 0, y: 0, width: 400, height: 50 }),
    line("t2", "act  ONE", { x: 0, y: 60, width: 400, height: 50 }),
    line("t3", "Act Two", { x: 0, y: 120, width: 400, height: 50 }),
  ];
  const result = removeObjects(scene, ["ACT   one"]);

  assert.deepEqual(ids(result.elements), ["t3"]);
  assert.deepEqual(result.removed, [{ object: "ACT   one", kind: "line", count: 2 }]);
});

test("what names nothing live is notOnBoard — an unknown id, and a tombstone's", () => {
  const scene = [
    photo("a", "ref-a", { x: 0, y: 0, width: 300, height: 200 }),
    photo("grave", "ref-b", { x: 0, y: 0, width: 300, height: 200 }, { isDeleted: true }),
  ];
  const result = removeObjects(scene, ["ghost", "grave"]);

  assert.equal(result.elements, null);
  assert.deepEqual(result.notOnBoard, ["ghost", "grave"]);
});

test("scaffolding is refused rather than swept — an arrow or a section is not a canvas object", () => {
  const scene = [
    { id: "arrow", type: "arrow", x: 0, y: 0, width: 100, height: 10 },
    { id: "sec", type: "frame", name: "Act one", x: 0, y: 0, width: 800, height: 600 },
  ];
  const result = removeObjects(scene, ["arrow", "sec"]);

  assert.equal(result.elements, null);
  assert.equal(result.refused.length, 2);
  assert.match(result.refused[0]!.reason, /not a canvas object/);
  assert.match(result.refused[1]!.reason, /not a canvas object/);
});

test("tombstones keep their places while live elements leave around them", () => {
  const scene = [
    photo("a", "ref-a", { x: 0, y: 0, width: 300, height: 200 }),
    photo("grave", "ref-b", { x: 0, y: 0, width: 300, height: 200 }, { isDeleted: true }),
    photo("b", "ref-c", { x: 400, y: 0, width: 300, height: 200 }),
  ];
  const result = removeObjects(scene, ["a"]);

  assert.deepEqual(ids(result.elements), ["grave", "b"]);
});

test("selectors read the array the one before left — a page taken first leaves its member named-by-nothing", () => {
  const scene = [
    photo("m1", "ref-a", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
    pageFrame("p1", { x: 0, y: 0, ...HD }),
  ];
  const result = removeObjects(scene, ["p1", "m1"]);

  assert.deepEqual(ids(result.elements), []);
  assert.deepEqual(result.removed, [{ object: "p1", kind: "page", count: 2 }]);
  assert.deepEqual(result.notOnBoard, ["m1"]);
});

function shape(id: string, type: string, box: Box, extra: object = {}) {
  return { id, type, ...box, ...extra };
}

test("a shape leaves the board by its objectId", () => {
  const scene = [
    shape("s1", "rectangle", { x: 0, y: 0, width: 300, height: 200 }),
    photo("b", "ref-b", { x: 400, y: 0, width: 300, height: 200 }),
  ];
  const result = removeObjects(scene, ["s1"]);

  assert.deepEqual(ids(result.elements), ["b"]);
  assert.deepEqual(result.removed, [{ object: "s1", kind: "shape", count: 1 }]);
  assert.deepEqual(result.refused, []);
});

test("a flat rule leaves too", () => {
  const result = removeObjects(
    [shape("rule", "line", { x: 0, y: 500, width: 900, height: 0 })],
    ["rule"],
  );

  assert.deepEqual(ids(result.elements), []);
  assert.deepEqual(result.removed, [{ object: "rule", kind: "shape", count: 1 }]);
});

test("an arrow is refused rather than removed", () => {
  const result = removeObjects(
    [shape("arr", "arrow", { x: 0, y: 0, width: 100, height: 100 })],
    ["arr"],
  );

  assert.equal(result.elements, null);
  assert.equal(result.refused.length, 1);
  assert.match(result.refused[0]!.reason, /not a canvas object/);
});

test("a page's ground is refused toward set_page_background, never taken off as an object", () => {
  const box = { x: 0, y: 0, width: HD.width, height: HD.height };
  const ground = {
    id: "ground",
    type: "rectangle",
    ...box,
    backgroundColor: "#0c111c",
    locked: true,
    customData: { pageBackground: true },
  };
  const scene = [ground, photo("a", "ref-a", { x: 0, y: 0, width: 300, height: 200 }), pageFrame("page_1", box)] as unknown as SceneElement[];

  const result = removeObjects(scene, ["ground"]);
  assert.equal(result.elements, null);
  assert.deepEqual(result.notOnBoard, []);
  assert.equal(result.refused.length, 1);
  assert.match(result.refused[0]!.reason, /set_page_background/);
});
