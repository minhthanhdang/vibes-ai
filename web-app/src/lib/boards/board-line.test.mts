import { test } from "node:test";
import assert from "node:assert/strict";

import { placeLinesOnBoard } from "@/lib/boards/board-line";
import { DROPPED_IMAGE_GAP } from "@/lib/canvas/moodboard-drop";
import { LAYOUT_TEXT_MAX_FONT, LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The edit that replaced a rebuild for a line of text joining or leaving a board
/// the director arranged by hand. Same two promises as the picture edit — the line
/// is on (or off) the board, and nothing already there moved — plus what it says
/// about the wordings it could not act on.

const PAGE = { width: 1920, height: 1080 };

type Box = { x: number; y: number; width: number; height: number };

function picture(referenceId: string, box: Box): SceneElement {
  return {
    id: `img-${referenceId}`,
    type: "image",
    fileId: `ref:${referenceId}`,
    status: "saved",
    ...box,
  };
}

function line(text: string, box: Box, fontSize = 40): SceneElement {
  return { id: `txt-${text}`, type: "text", text, originalText: text, fontSize, ...box };
}

function texts(elements: readonly SceneElement[]) {
  return elements.filter((element) => element.type === "text").map((element) => element.text);
}

const ARRANGEMENT = [
  picture("a", { x: 100, y: 200, width: 300, height: 200 }),
  picture("b", { x: 500, y: 240, width: 300, height: 200 }),
];

test("a line joins the board above everything already on it", () => {
  const result = placeLinesOnBoard({
    elements: ARRANGEMENT,
    page: PAGE,
    add: ["Act two"],
    makeId: () => "new-1",
  });

  assert.deepEqual(result.added, ["Act two"]);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(texts(result.elements), ["Act two"]);

  const set = result.elements.at(-1)!;
  assert.equal(set.id, "new-1");
  assert.equal(set.type, "text");
  /// Both strings, so opening the block to edit it does not resurrect a different
  /// one — the rule `rewordOnBoard` writes by.
  assert.equal(set.originalText, "Act two");
  /// Across the arrangement and centred on it: x and width are the covering
  /// rectangle of what is on the board, not the page.
  assert.equal(set.x, 100);
  assert.equal(set.width, 700);
  assert.equal(set.textAlign, "center");
  /// A headline left to size itself shrinks to its own words.
  assert.equal(set.autoResize, false);

  const height = set.height as number;
  /// Above the topmost thing on the board, by the same gap a drop leaves.
  assert.equal(set.y, 200 - DROPPED_IMAGE_GAP - height);
});

test("everything already on the board comes back as the objects it was", () => {
  const result = placeLinesOnBoard({
    elements: ARRANGEMENT,
    page: PAGE,
    add: ["Act two"],
    makeId: () => "new-1",
  });

  assert.equal(result.elements[0], ARRANGEMENT[0]);
  assert.equal(result.elements[1], ARRANGEMENT[1]);
});

test("a joining line is set at the size the board's own type is", () => {
  const elements = [
    ...ARRANGEMENT,
    line("Dawn", { x: 100, y: 500, width: 400, height: 40 }, 32),
    line("Dusk", { x: 100, y: 560, width: 400, height: 40 }, 36),
    /// One word blown up to a title is deliberate, and the median is what keeps
    /// it from deciding the size of every line after it.
    line("RIDGE", { x: 100, y: 620, width: 400, height: 120 }, 96),
  ];

  const result = placeLinesOnBoard({ elements, page: PAGE, add: ["Act two"], makeId: () => "n" });

  assert.equal(result.elements.at(-1)!.fontSize, 36);
});

test("a board with no type on it sets the line off its own width", () => {
  const result = placeLinesOnBoard({
    elements: ARRANGEMENT,
    page: PAGE,
    add: ["Act two"],
    makeId: () => "n",
  });

  const fontSize = result.elements.at(-1)!.fontSize as number;
  /// 5% of the 700-wide arrangement, inside the layout's own bounds.
  assert.equal(fontSize, 35);
  assert.ok(fontSize >= LAYOUT_TEXT_MIN_FONT && fontSize <= LAYOUT_TEXT_MAX_FONT);
});

test("several lines named at once stack in the order they were given", () => {
  const result = placeLinesOnBoard({
    elements: ARRANGEMENT,
    page: PAGE,
    add: ["Act one", "Act two"],
    makeId: (() => {
      let n = 0;
      return () => `new-${++n}`;
    })(),
  });

  assert.deepEqual(texts(result.elements), ["Act one", "Act two"]);
  const [first, second] = result.elements.slice(-2) as SceneElement[];
  const height = first!.height as number;
  /// Reading downwards onto the board, and the block of them clear of it.
  assert.equal((second!.y as number) - (first!.y as number), height + DROPPED_IMAGE_GAP);
  assert.equal((second!.y as number) + height + DROPPED_IMAGE_GAP, 200);
});

test("a line taken off goes wherever it is, and every copy of it goes", () => {
  const elements = [
    ...ARRANGEMENT,
    line("Act one", { x: 100, y: 20, width: 400, height: 50 }),
    line("Act one", { x: 900, y: 800, width: 400, height: 50 }),
    line("Dusk", { x: 100, y: 900, width: 400, height: 50 }),
  ];

  const result = placeLinesOnBoard({ elements, page: PAGE, remove: ["  act   ONE "] });

  /// Matched on the words, because the model quotes a line back out of
  /// inspect_board rather than pointing at an id.
  assert.deepEqual(result.removed, ["act ONE"]);
  assert.deepEqual(texts(result.elements), ["Dusk"]);
  assert.deepEqual(result.notOnBoard, []);
});

test("a wording no block carries is named rather than ignored", () => {
  const elements = [...ARRANGEMENT, line("Act one", { x: 100, y: 20, width: 400, height: 50 })];

  const result = placeLinesOnBoard({ elements, page: PAGE, remove: ["Act three"] });

  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.notOnBoard, ["Act three"]);
  assert.deepEqual(texts(result.elements), ["Act one"]);
});

test("a line the board already says is not written on it twice", () => {
  const elements = [...ARRANGEMENT, line("Act one", { x: 100, y: 20, width: 400, height: 50 })];

  const result = placeLinesOnBoard({ elements, page: PAGE, add: ["act one"], makeId: () => "n" });

  assert.deepEqual(result.added, []);
  assert.deepEqual(result.alreadyOn, ["act one"]);
  assert.deepEqual(texts(result.elements), ["Act one"]);
});

/// The one case where a line is both taken off and put on: the words are the
/// same, so it has to be read as a move rather than as a duplicate.
test("a line taken off and put back on in one call is set again", () => {
  const elements = [...ARRANGEMENT, line("Act one", { x: 900, y: 900, width: 400, height: 50 })];

  const result = placeLinesOnBoard({
    elements,
    page: PAGE,
    add: ["Act one"],
    remove: ["Act one"],
    makeId: () => "new-1",
  });

  assert.deepEqual(result.added, ["Act one"]);
  assert.deepEqual(result.removed, ["Act one"]);
  assert.deepEqual(result.alreadyOn, []);
  assert.deepEqual(texts(result.elements), ["Act one"]);
  assert.equal(result.elements.at(-1)!.id, "new-1");
});

test("blank and repeated wordings are dropped rather than acted on", () => {
  const result = placeLinesOnBoard({
    elements: ARRANGEMENT,
    page: PAGE,
    add: ["Act two", "  ", "ACT   TWO"],
    remove: ["   "],
    makeId: () => "new-1",
  });

  assert.deepEqual(result.added, ["Act two"]);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(texts(result.elements), ["Act two"]);
});

/// A block whose drawn string was emptied by wrapping still carries what the
/// director typed, so both strings have to be read.
test("a line is matched through originalText when the drawn string is gone", () => {
  const elements = [
    ...ARRANGEMENT,
    { id: "txt-1", type: "text", text: "", originalText: "Act one", x: 100, y: 20, width: 400, height: 50 },
  ];

  const result = placeLinesOnBoard({ elements, page: PAGE, remove: ["Act one"] });

  assert.deepEqual(result.removed, ["Act one"]);
  assert.equal(result.elements.length, 2);
});

test("a board with nothing on it sets the line above its page", () => {
  const result = placeLinesOnBoard({ elements: [], page: PAGE, add: ["Act two"], makeId: () => "n" });

  const set = result.elements[0]!;
  assert.equal(set.x, 0);
  assert.equal(set.width, PAGE.width);
  assert.ok((set.y as number) < 0);
});
