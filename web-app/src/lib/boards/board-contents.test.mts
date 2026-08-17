import { test } from "node:test";
import assert from "node:assert/strict";

import { boardContents, boardItems, readingOrder, sceneBounds } from "@/lib/boards/board-contents";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

function image(id: string, referenceId: string | null, box: { x: number; y: number; width: number; height: number }): SceneElement {
  return { id, type: "image", ...(referenceId ? { fileId: `ref:${referenceId}` } : {}), ...box };
}

function text(id: string, value: string, box: { x: number; y: number; width: number; height: number }): SceneElement {
  return { id, type: "text", text: value, ...box };
}

const BOX = { x: 0, y: 0, width: 100, height: 100 };

test("a scene reads as its images and its text, and nothing else the user drew", () => {
  const items = boardItems([
    image("e1", "ref-a", BOX),
    text("e2", "Act one", { x: 0, y: 200, width: 300, height: 40 }),
    { id: "e3", type: "rectangle", x: 0, y: 0, width: 50, height: 50 },
    { id: "e4", type: "arrow", x: 0, y: 0, width: 50, height: 50 },
  ]);

  assert.deepEqual(
    items.map((item) => [item.kind, item.referenceId, item.text]),
    [
      ["image", "ref-a", null],
      ["text", null, "Act one"],
    ],
  );
});

test("an element without a real box is not on the board as far as this is concerned", () => {
  const items = boardItems([
    image("e1", "ref-a", { x: 0, y: 0, width: 0, height: 100 }),
    { id: "e2", type: "image", fileId: "ref:ref-b", x: 0, y: 0 },
    { id: "e3", type: "image", fileId: "ref:ref-c", x: Number.NaN, y: 0, width: 10, height: 10 },
    image("e4", "ref-d", BOX),
  ]);

  assert.deepEqual(
    items.map((item) => item.referenceId),
    ["ref-d"],
  );
});

test("reading order is rows first, then left to right inside a row", () => {
  const scene = [
    image("e1", "top-right", { x: 500, y: 0, width: 200, height: 100 }),
    image("e2", "bottom", { x: 0, y: 300, width: 200, height: 100 }),
    image("e3", "top-left", { x: 0, y: 10, width: 200, height: 100 }),
  ];

  assert.deepEqual(boardContents(scene).pictures, ["top-left", "top-right", "bottom"]);
});

/// Overlap rather than a band width: two pictures whose boxes cross the same
/// horizontal line are the same row whatever their heights are.
test("a taller picture and the one beside it are one row, not two", () => {
  const ordered = readingOrder([
    { x: 300, y: 40, width: 100, height: 40 },
    { x: 0, y: 0, width: 100, height: 400 },
  ]);

  assert.deepEqual(
    ordered.map((item) => item.x),
    [0, 300],
  );
});

test("a picture on the board twice is one picture, at the first place it appears", () => {
  const scene = [
    image("e1", "ref-a", { x: 0, y: 0, width: 100, height: 100 }),
    image("e2", "ref-b", { x: 200, y: 0, width: 100, height: 100 }),
    image("e3", "ref-a", { x: 0, y: 400, width: 100, height: 100 }),
  ];

  assert.deepEqual(boardContents(scene).pictures, ["ref-a", "ref-b"]);
});

test("images that name nothing this project holds are counted, since there is no id to give back", () => {
  const scene = [
    image("e1", "ref-a", { x: 0, y: 0, width: 100, height: 100 }),
    { id: "e2", type: "image", fileId: "3a7f9c", x: 200, y: 0, width: 100, height: 100 },
  ];

  const contents = boardContents(scene);
  assert.deepEqual(contents.pictures, ["ref-a"]);
  assert.equal(contents.unnamedImages, 1);
});

test("the lines are the text of the board, in reading order, without the empty ones", () => {
  const scene = [
    text("e1", "  ", { x: 0, y: 0, width: 300, height: 40 }),
    text("e2", " Act two ", { x: 0, y: 400, width: 300, height: 40 }),
    text("e3", "Exteriors", { x: 0, y: 200, width: 300, height: 40 }),
  ];

  assert.deepEqual(boardContents(scene).lines, ["Exteriors", "Act two"]);
});

test("the page is the miniature's rectangle when everything is on it", () => {
  const items = boardItems([image("e1", "ref-a", { x: 100, y: 100, width: 200, height: 200 })]);

  assert.deepEqual(sceneBounds(items, { width: 1920, height: 1080 }), {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
});

/// A composed board never leaves its page; a board the user dragged together
/// has no obligation to stay on it, and a preview cropped to the page would omit
/// the picture they just put beside it.
test("a picture dragged off the page widens the rectangle rather than being cut off it", () => {
  const items = boardItems([
    image("e1", "ref-a", { x: -200, y: 0, width: 100, height: 100 }),
    image("e2", "ref-b", { x: 1900, y: 1000, width: 300, height: 300 }),
  ]);

  assert.deepEqual(sceneBounds(items, { width: 1920, height: 1080 }), {
    x: -200,
    y: 0,
    width: 2400,
    height: 1300,
  });
});
