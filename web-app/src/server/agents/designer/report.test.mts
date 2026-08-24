import { test } from "node:test";
import assert from "node:assert/strict";

import { designReport } from "./report";
import { pageCustomData } from "@/lib/pages/board-pages";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The read agent 6 writes its reply off — what really landed on the page,
/// rather than what the design was asked for or what its closing line claims.
///
/// Pure and table-driven, for `designAsk`'s reason: this is the whole of what
/// the user is told about a page nothing else in the turn watched being made,
/// and it is worth being able to assert on without a scene in a row.

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

  /// Reading order rather than array order: "the one on the left" is the first
  /// thing the user names, and it is the first thing here.
  assert.deepEqual(report.placed, [
    { referenceId: "a", clipped: false },
    { referenceId: "b", clipped: false },
  ]);
  assert.deepEqual(report.lines, ["ACT TWO"]);
  assert.equal(report.background, null);
  assert.equal(report.page?.name, "Act two");
  assert.equal(report.page?.preset, "LANDSCAPE_HD");
  assert.equal(report.page?.of, 1);
  /// The page's own digest and nothing else: a report that named a page has no
  /// use for a list of the board's.
  assert.equal(report.pages, undefined);
});

/// The three keys that are only there when they have something to say. An
/// answer carrying `notPlaced: []` reads to a model as a fact about the page
/// rather than as nothing having happened.
test("nothing to report is a key that is not there", () => {
  const scene = [page("pg-1", { x: 0, y: 0 }), image("a", { x: 100, y: 100 })];
  const report = designReport({ elements: scene, pageId: "pg-1", named: ["a"] });

  assert.equal(report.notPlaced, undefined);
  assert.equal(report.looseOnBoard, undefined);
  assert.equal(report.made, undefined);
  assert.deepEqual(report.lines, []);
});

/// `notPlaced` is against the ids agent 6 *named* and never against the
/// gallery: agent 8 chooses for itself, and a picture it never wanted is not
/// one it left off.
test("a picture named and not placed is said, and one nobody named is not", () => {
  const scene = [page("pg-1", { x: 0, y: 0 }), image("a", { x: 100, y: 100 })];

  const report = designReport({ elements: scene, pageId: "pg-1", named: ["a", "b", "c"] });
  assert.deepEqual(report.notPlaced, ["b", "c"]);

  assert.equal(designReport({ elements: scene, pageId: "pg-1" }).notPlaced, undefined);
});

/// The failure this whole report exists to make visible: a design that put a
/// picture beside the page rather than on it. Every page read on its own is
/// correct and the picture is in none of them.
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

/// A picture hanging over the page's edge is drawn cut off there. The user sees
/// it and the model has to be able to say it is an overflow rather than a crop.
test("a picture running over the page's edge is marked clipped", () => {
  const scene = [
    page("pg-1", { x: 0, y: 0 }),
    image("a", { x: HD.width - 250, y: 100 }),
  ];

  assert.deepEqual(designReport({ elements: scene, pageId: "pg-1" }).placed, [
    { referenceId: "a", clipped: true },
  ]);
});

/// The picture standing behind the page is apart from the ones on it, which is
/// the whole point of reading it: a page of one photograph on a paper texture
/// holds one photograph, and a background counted with them makes the answer
/// say two and reads back to the user as a picture they never put there.
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

/// The ledgers the two image tools keep, passed straight through. A drawn
/// picture is the one thing in the gallery the user cannot tell by looking, so
/// it is the one thing agent 6 has to say out loud.
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

/// The one case that cannot be resolved: a board of several pages, nobody named
/// one, and the model made none — so which page it chose is a fact only the
/// scene it wrote knows. Answered with the board rather than with an empty
/// page, because the pictures really are somewhere and "nothing was placed"
/// would be a lie agent 6 would pass straight on.
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
  /// Board-wide, so a picture on either page counts as placed and `notPlaced`
  /// stays honest rather than naming every picture the design used.
  assert.deepEqual(report.placed, [
    { referenceId: "a", clipped: false },
    { referenceId: "b", clipped: false },
  ]);
  assert.equal(report.notPlaced, undefined);
  assert.deepEqual(report.lines, ["ACT TWO"]);
});

/// A page id the board has not got is the same case: it resolves to no page, so
/// the report falls back to the board rather than describing an empty one.
test("a page id the board does not carry falls back to the board", () => {
  const scene = [page("pg-1", { x: 0, y: 0 }), image("a", { x: 100, y: 100 })];
  const report = designReport({ elements: scene, pageId: "pg-9" });

  assert.equal(report.page, undefined);
  assert.deepEqual(report.pages?.map(({ pageId }) => pageId), ["pg-1"]);
  assert.deepEqual(report.placed, [{ referenceId: "a", clipped: false }]);
});
