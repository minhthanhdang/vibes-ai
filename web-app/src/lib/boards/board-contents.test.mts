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

/// §XI.5: the fourth kind is asked for by name, and a reader that did not ask
/// gets exactly the list it always got — which is what keeps every count of
/// photographs a count of photographs.
test("shapes come back only when a reader asks for them", () => {
  const scene: SceneElement[] = [
    { id: "e1", type: "rectangle", x: 0, y: 0, width: 800, height: 500, backgroundColor: "#0c111c" },
    image("e2", "ref-a", BOX),
  ];

  assert.deepEqual(
    boardItems(scene).map((item) => item.kind),
    ["image"],
  );
  assert.deepEqual(
    boardItems(scene, { shapes: true }).map((item) => item.kind),
    ["shape", "image"],
  );
});

test("a shape carries the fill, the stroke and the opacity the renderer drew it with", () => {
  const [block] = boardItems(
    [
      {
        id: "e1",
        type: "ellipse",
        x: 10,
        y: 20,
        width: 200,
        height: 200,
        backgroundColor: "#f4efe6",
        strokeColor: "#1e1e1e",
        strokeWidth: 4,
        opacity: 45,
      },
    ],
    { shapes: true },
  );

  assert.equal(block?.shape, "ellipse");
  assert.equal(block?.style?.fill, "#f4efe6");
  assert.equal(block?.style?.stroke, "#1e1e1e");
  assert.equal(block?.style?.strokeWidth, 4);
  assert.equal(block?.opacity, 45);
});

/// The read's one-extent rule (§XI.1) arriving at this door: a rule drawn across
/// a page is a line with no height, and a list that dropped it would describe a
/// page whose divider is invisible.
test("a flat line is a shape, and a photograph with no area is still drag residue", () => {
  const items = boardItems(
    [
      { id: "e1", type: "line", x: 100, y: 500, width: 800, height: 0 },
      image("e2", "ref-a", { x: 0, y: 0, width: 0, height: 100 }),
    ],
    { shapes: true },
  );

  assert.deepEqual(
    items.map((item) => item.kind),
    ["shape"],
  );
});

/// The page brief's blocks read their fill from the renderer's own reading
/// (`shapeAppearance`), so the rule about which shapes paint an inside arrives
/// here for nothing: a rule with the toolbar's colour left on it describes a
/// hairline rather than a colour field across the page.
test("a rule's stored background is not a fill on the block it becomes", () => {
  const [rule] = boardItems(
    [
      {
        id: "e1",
        type: "line",
        x: 100,
        y: 500,
        width: 800,
        height: 0,
        backgroundColor: "#f4efe6",
        strokeColor: "#0b3d2e",
        points: [[0, 0], [800, 0]],
      },
    ],
    { shapes: true },
  );

  assert.equal(rule?.style?.fill, "transparent");
  assert.equal(rule?.style?.stroke, "#0b3d2e");
});

/// Invariant 13's other half: the kinds with no handle stay out of the list at
/// this door too, whoever asked. They are named in `read_canvas`' remainder,
/// which is the one place counting them is honest.
test("an arrow, a diamond and a scribble are not shapes a reader can ask for", () => {
  const items = boardItems(
    [
      { id: "e1", type: "arrow", x: 0, y: 0, width: 50, height: 50 },
      { id: "e2", type: "diamond", x: 0, y: 0, width: 50, height: 50 },
      { id: "e3", type: "freedraw", x: 0, y: 0, width: 50, height: 50 },
      { id: "e4", type: "embeddable", x: 0, y: 0, width: 50, height: 50 },
    ],
    { shapes: true },
  );

  assert.deepEqual(items, []);
});

test("a page's own ground is not one of the shapes the opt-in reads", () => {
  const ground = {
    id: "ground",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    backgroundColor: "#0c111c",
    customData: { pageBackground: true },
  } as unknown as SceneElement;
  const drawn = {
    id: "scrim",
    type: "rectangle",
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    backgroundColor: "#ffffff",
  } as unknown as SceneElement;

  assert.deepEqual(
    boardItems([ground, drawn], { shapes: true }).map((item) => item.shape),
    ["rectangle"],
    "the one somebody drew, never the page it was drawn on",
  );
  assert.deepEqual(boardItems([ground, drawn]), []);
});
