import { test } from "node:test";
import assert from "node:assert/strict";

import { designReport } from "./report";
import { pageCustomData } from "@/lib/pages/board-pages";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

function page(
  id: string,
  box: { x: number; y: number; width?: number; height?: number },
  name = id,
): SceneElement {
  const width = box.width ?? HD.width;
  const height = box.height ?? HD.height;
  return {
    id,
    type: "frame",
    x: box.x,
    y: box.y,
    width,
    height,
    name,
    customData: pageCustomData(width, height),
  };
}

const image = (
  id: string,
  box: { x: number; y: number; width?: number; height?: number },
): SceneElement => ({
  id: `el-${id}`,
  type: "image",
  fileId: `ref:${id}`,
  x: box.x,
  y: box.y,
  width: box.width ?? 400,
  height: box.height ?? 300,
});

const line = (id: string, text: string, box: { x: number; y: number }): SceneElement => ({
  id,
  type: "text",
  text,
  x: box.x,
  y: box.y,
  width: 600,
  height: 80,
});

test("the report is the page, what is on it and what shape it is", () => {
  const scene = [
    page("pg-1", { x: 0, y: 0 }, "Act two"),
    image("b", { x: 900, y: 100 }),
    image("a", { x: 100, y: 100 }),
    line("t", "ACT TWO", { x: 100, y: 600 }),
  ];

  const report = designReport({ elements: scene, pageId: "pg-1" });

  assert.deepEqual(report.placed, [
    { referenceId: "a", clipped: false },
    { referenceId: "b", clipped: false },
  ]);
  assert.deepEqual(report.lines, ["ACT TWO"]);
  assert.equal(report.background, null);
  assert.equal(report.page?.name, "Act two");
  assert.equal(report.page?.preset, "LANDSCAPE_HD");
  assert.equal(report.page?.of, 1);
  assert.equal(report.pages, undefined);
});

test("nothing to report is a key that is not there", () => {
  const scene = [page("pg-1", { x: 0, y: 0 }), image("a", { x: 100, y: 100 })];
  const report = designReport({ elements: scene, pageId: "pg-1", named: ["a"] });

  assert.equal(report.notPlaced, undefined);
  assert.equal(report.looseOnBoard, undefined);
  assert.equal(report.made, undefined);
  assert.deepEqual(report.lines, []);
});

test("a picture named and not placed is said, and one nobody named is not", () => {
  const scene = [page("pg-1", { x: 0, y: 0 }), image("a", { x: 100, y: 100 })];

  const report = designReport({ elements: scene, pageId: "pg-1", named: ["a", "b", "c"] });
  assert.deepEqual(report.notPlaced, ["b", "c"]);

  assert.equal(designReport({ elements: scene, pageId: "pg-1" }).notPlaced, undefined);
});

test("a picture on no page at all is reported as loose on the board", () => {
  const scene = [
    page("pg-1", { x: 0, y: 0 }),
    image("a", { x: 100, y: 100 }),
    image("stray", { x: 3000, y: 100 }),
  ];

  const report = designReport({ elements: scene, pageId: "pg-1" });
  assert.deepEqual(report.placed, [{ referenceId: "a", clipped: false }]);
  assert.deepEqual(report.looseOnBoard, ["stray"]);
});

test("a picture running over the page's edge is marked clipped", () => {
  const scene = [
    page("pg-1", { x: 0, y: 0 }),
    image("a", { x: HD.width - 250, y: 100 }),
  ];

  assert.deepEqual(designReport({ elements: scene, pageId: "pg-1" }).placed, [
    { referenceId: "a", clipped: true },
  ]);
});

test("the ground behind the page is not one of the pictures on it", () => {
  const scene = [
    page("pg-1", { x: 0, y: 0 }),
    image("paper", { x: -50, y: -50, width: HD.width + 100, height: HD.height + 100 }),
    image("a", { x: 100, y: 100 }),
  ];

  const report = designReport({ elements: scene, pageId: "pg-1" });
  assert.equal(report.background, "paper");
  assert.deepEqual(report.placed, [{ referenceId: "a", clipped: false }]);
});

test("what the design drew and cut rides out under made, and only when there is any", () => {
  const scene = [page("pg-1", { x: 0, y: 0 })];

  assert.deepEqual(
    designReport({
      elements: scene,
      pageId: "pg-1",
      made: { generated: ["drawn-1"], cropped: [] },
    }).made,
    { generated: ["drawn-1"] },
  );

  assert.deepEqual(
    designReport({
      elements: scene,
      pageId: "pg-1",
      made: { generated: [], cropped: ["cut-1", "cut-2"] },
    }).made,
    { cropped: ["cut-1", "cut-2"] },
  );

  assert.equal(
    designReport({ elements: scene, pageId: "pg-1", made: { generated: [], cropped: [] } }).made,
    undefined,
  );
});

test("a page that cannot be named is answered with the board and its pages", () => {
  const scene = [
    page("pg-1", { x: 0, y: 0 }, "Cold open"),
    page("pg-2", { x: 2200, y: 0 }, "Act two"),
    image("a", { x: 100, y: 100 }),
    image("b", { x: 2300, y: 100 }),
    line("t", "ACT TWO", { x: 2300, y: 600 }),
  ];

  const report = designReport({ elements: scene, pageId: null, named: ["a", "b"] });

  assert.equal(report.page, undefined);
  assert.deepEqual(report.pages?.map(({ name }) => name), ["Cold open", "Act two"]);
  assert.deepEqual(report.placed, [
    { referenceId: "a", clipped: false },
    { referenceId: "b", clipped: false },
  ]);
  assert.equal(report.notPlaced, undefined);
  assert.deepEqual(report.lines, ["ACT TWO"]);
});

test("a page id the board does not carry falls back to the board", () => {
  const scene = [page("pg-1", { x: 0, y: 0 }), image("a", { x: 100, y: 100 })];
  const report = designReport({ elements: scene, pageId: "pg-9" });

  assert.equal(report.page, undefined);
  assert.deepEqual(report.pages?.map(({ pageId }) => pageId), ["pg-1"]);
  assert.deepEqual(report.placed, [{ referenceId: "a", clipped: false }]);
});
