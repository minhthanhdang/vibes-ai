import { test } from "node:test";
import assert from "node:assert/strict";

import { pageRemoval } from "@/lib/pages/page-remove";
import { boardPages, pageCustomData } from "@/lib/pages/board-pages";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;
const SECOND = HD.width + PAGE_GAP;

function page(id: string, x: number, name = id): SceneElement {
  return {
    id,
    type: "frame",
    x,
    y: 0,
    width: HD.width,
    height: HD.height,
    name,
    customData: pageCustomData(HD.width, HD.height),
  };
}

function section(id: string, x: number): SceneElement {
  return { id, type: "frame", x, y: 0, width: 600, height: 500, name: "Night work" };
}

function image(
  id: string,
  box: { x: number; y: number; width?: number; height?: number },
  frameId: string | null = null,
): SceneElement {
  return {
    id: `img-${id}`,
    type: "image",
    fileId: `ref:${id}`,
    status: "saved",
    x: box.x,
    y: box.y,
    width: box.width ?? 400,
    height: box.height ?? 300,
    frameId,
  };
}

function text(id: string, words: string, box: { x: number; y: number }): SceneElement {
  return {
    id,
    type: "text",
    text: words,
    x: box.x,
    y: box.y,
    width: 500,
    height: 60,
  };
}

function spread(): SceneElement[] {
  return [
    page("pg-1", 0, "Act one"),
    image("a", { x: 100, y: 100 }, "pg-1"),
    image("b", { x: 700, y: 100 }, "pg-1"),
    text("line-1", "WHAT THE CITY KEEPS", { x: 100, y: 600 }),
    page("pg-2", SECOND, "Act two"),
    image("c", { x: SECOND + 100, y: 100 }, "pg-2"),
  ];
}

test("removing a page takes its rectangle and everything standing on it", () => {
  const removed = pageRemoval(spread(), "pg-1")!;

  assert.deepEqual(
    removed.elements.map((element) => element.id),
    ["pg-2", "img-c"],
  );
  assert.deepEqual(
    removed.pictures.map((picture) => picture.referenceId),
    ["a", "b"],
  );
  assert.deepEqual(removed.lines, ["WHAT THE CITY KEEPS"]);
  assert.equal(removed.emptiesBoard, false);
});

test("the board's other pages are left exactly as they were", () => {
  const elements = spread();
  const removed = pageRemoval(elements, "pg-1")!;

  assert.equal(boardPages(removed.elements).length, 1);
  assert.equal(removed.elements[0], elements[4]);
  assert.equal(removed.elements[1], elements[5]);
});

test("what leaves is decided by geometry, not by frameId", () => {
  const elements = [
    page("pg-1", 0),
    page("pg-2", SECOND),
    image("a", { x: SECOND + 100, y: 100 }, "pg-1"),
    image("b", { x: 100, y: 100 }, null),
  ];
  const removed = pageRemoval(elements, "pg-1")!;

  assert.deepEqual(
    removed.pictures.map((picture) => picture.referenceId),
    ["b"],
  );
  assert.deepEqual(
    removed.elements.map((element) => element.id),
    ["pg-2", "img-a"],
  );
});

test("a photograph dragged off the page loses the name of the frame that is going", () => {
  const elements = [
    page("pg-1", 0),
    image("a", { x: -900, y: 1400 }, "pg-1"),
  ];
  const removed = pageRemoval(elements, "pg-1")!;

  assert.equal(removed.elements.length, 1);
  assert.equal(removed.elements[0]!.id, "img-a");
  assert.equal(removed.elements[0]!.frameId, null);
});

test("a section the page was drawn over keeps its rectangle and its photographs", () => {
  const elements = [
    section("sec-1", 100),
    image("a", { x: 200, y: 100 }, "sec-1"),
    image("b", { x: 900, y: 100 }, null),
    page("pg-1", 0),
  ];
  const removed = pageRemoval(elements, "pg-1")!;

  assert.deepEqual(
    removed.elements.map((element) => element.id),
    ["sec-1", "img-a"],
  );
  assert.deepEqual(
    removed.pictures.map((picture) => picture.referenceId),
    ["b"],
  );
  assert.equal(removed.sections, 1);
  assert.equal(removed.keptInSections, 1);
});

test("a picture over the page edge is reported as one the tile drew cut off", () => {
  const elements = [page("pg-1", 0), image("a", { x: HD.width - 300, y: 100 })];
  const removed = pageRemoval(elements, "pg-1")!;

  assert.deepEqual(removed.pictures, [{ referenceId: "a", clipped: true }]);
});

test("the board's only page going says the board is left with none", () => {
  const removed = pageRemoval([page("pg-1", 0), image("a", { x: 100, y: 100 })], "pg-1")!;

  assert.equal(removed.emptiesBoard, true);
  assert.deepEqual(removed.elements, []);
});

test("a page id the board does not carry is refused rather than throwing", () => {
  assert.equal(pageRemoval(spread(), "pg-9"), null);
  assert.equal(pageRemoval(spread(), undefined), null);
});

test("a tombstone the editor keeps for undo is neither removed nor counted", () => {
  const elements: SceneElement[] = [
    page("pg-1", 0),
    { ...image("a", { x: 100, y: 100 }), isDeleted: true },
  ];
  const removed = pageRemoval(elements, "pg-1")!;

  assert.deepEqual(removed.pictures, []);
  assert.deepEqual(
    removed.elements.map((element) => element.id),
    ["img-a"],
  );
});

test("a reference standing on the page twice is one thing the user loses", () => {
  const elements = [
    page("pg-1", 0),
    image("a", { x: 100, y: 100 }),
    { ...image("a", { x: 900, y: 500 }), id: "img-a-again" },
  ];
  const removed = pageRemoval(elements, "pg-1")!;

  assert.equal(removed.pictures.length, 1);
  assert.equal(removed.elements.length, 0);
});

test("discarding a page takes its ground with it", () => {
  const scene = [
    {
      id: "ground",
      type: "rectangle",
      x: 0,
      y: 0,
      width: HD.width,
      height: HD.height,
      backgroundColor: "#0c111c",
      locked: true,
      customData: { pageBackground: true },
    } as unknown as SceneElement,
    image("a", { x: 100, y: 100 }),
    page("pg-1", 0),
    page("pg-2", SECOND),
  ];

  const removal = pageRemoval(scene, "pg-1")!;
  assert.deepEqual(
    removal.elements.map((element) => element.id),
    ["pg-2"],
  );
});
