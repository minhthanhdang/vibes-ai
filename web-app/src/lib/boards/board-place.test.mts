import { test } from "node:test";
import assert from "node:assert/strict";

import { placeOnBoard } from "@/lib/boards/board-place";
import { DROPPED_IMAGE_GAP, DROPPED_IMAGE_MAX_EDGE } from "@/lib/canvas/moodboard-drop";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The edit that replaced a rebuild for a picture joining or leaving a board the
/// director arranged by hand. Everything here is about the two things it promises
/// — the picture is on (or off) the board, and nothing that was already there
/// moved — plus what it says about the ids it could not act on.

const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };

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

function line(text: string, box: Box): SceneElement {
  return { id: `txt-${text}`, type: "text", text, originalText: text, ...box };
}

const sizes: Record<string, { width: number; height: number }> = {
  wide: { width: 4000, height: 2000 },
  tall: { width: 2000, height: 4000 },
  square: { width: 3000, height: 3000 },
};
const sizeOf = (id: string) => sizes[id] ?? null;

function ids(elements: readonly SceneElement[]) {
  return elements.map((element) => element.fileId).filter(Boolean);
}

test("a picture joins the board under everything already on it", () => {
  const elements = [
    picture("a", { x: 100, y: 100, width: 300, height: 200 }),
    picture("b", { x: 500, y: 100, width: 300, height: 200 }),
  ];

  const result = placeOnBoard({
    elements,
    page: PAGE,
    add: ["wide"],
    sizeOf,
    makeId: () => "new-1",
  });

  assert.deepEqual(result.added, ["wide"]);
  assert.deepEqual(result.removed, []);
  /// Appended, which is where a drop puts one: the newest thing on a board is
  /// the thing on top of it.
  assert.deepEqual(ids(result.elements), ["ref:a", "ref:b", "ref:wide"]);

  const joined = result.elements[2];
  assert.equal(joined.id, "new-1");
  assert.equal(joined.status, "saved");
  /// Under the covering rectangle of what is there (y 100..300), by the gap.
  assert.equal(joined.y, 300 + DROPPED_IMAGE_GAP);
  /// Centred on it (x 100..800).
  assert.equal(
    (joined.x as number) + (joined.width as number) / 2,
    450,
  );
});

test("nothing already on the board is touched — the same objects come back", () => {
  const elements = [
    picture("a", { x: 100, y: 100, width: 300, height: 200 }),
    line("Act two", { x: 100, y: 400, width: 600, height: 40 }),
  ];

  const result = placeOnBoard({ elements, page: PAGE, add: ["wide"], sizeOf });

  assert.equal(result.elements[0], elements[0]);
  assert.equal(result.elements[1], elements[1]);
  assert.equal(result.elements.length, 3);
});

test("a picture joins at the size the board's own pictures are, not at the drop's", () => {
  /// Three pictures at 600, 600 and 1000 on their longest edge: the median is
  /// 600, so a landscape 2:1 joining is 600 × 300 rather than the drop's 320.
  const elements = [
    picture("a", { x: 0, y: 0, width: 600, height: 400 }),
    picture("b", { x: 700, y: 0, width: 600, height: 400 }),
    picture("c", { x: 0, y: 500, width: 1000, height: 600 }),
  ];

  const result = placeOnBoard({ elements, page: PAGE, add: ["wide"], sizeOf });

  const joined = result.elements[3];
  assert.deepEqual({ width: joined.width, height: joined.height }, { width: 600, height: 300 });
});

test("an empty board sizes a joining picture the way a drop does", () => {
  const result = placeOnBoard({ elements: [], page: PAGE, add: ["square"], sizeOf });

  const joined = result.elements[0];
  assert.deepEqual(
    { width: joined.width, height: joined.height },
    { width: DROPPED_IMAGE_MAX_EDGE, height: DROPPED_IMAGE_MAX_EDGE },
  );
  /// Centred on the page it has, since there is nothing else to centre on.
  assert.equal((joined.x as number) + DROPPED_IMAGE_MAX_EDGE / 2, PAGE.width / 2);
});

test("a reference whose pixel size was never recorded lands square", () => {
  const result = placeOnBoard({ elements: [], page: PAGE, add: ["unmeasured"], sizeOf });

  const joined = result.elements[0];
  assert.equal(joined.width, joined.height);
});

test("two joining together sit on one midline, in the order they were named", () => {
  const result = placeOnBoard({ elements: [], page: PAGE, add: ["wide", "tall"], sizeOf });

  const [first, second] = result.elements;
  assert.equal(first.fileId, "ref:wide");
  assert.equal(second.fileId, "ref:tall");
  assert.equal(
    (first.y as number) + (first.height as number) / 2,
    (second.y as number) + (second.height as number) / 2,
  );
  assert.equal(
    (second.x as number) - ((first.x as number) + (first.width as number)),
    DROPPED_IMAGE_GAP,
  );
});

test("a picture taken off goes entirely, and the board keeps everything else", () => {
  const elements = [
    picture("a", { x: 0, y: 0, width: 300, height: 200 }),
    picture("b", { x: 400, y: 0, width: 300, height: 200 }),
    line("Act two", { x: 0, y: 300, width: 600, height: 40 }),
  ];

  const result = placeOnBoard({ elements, page: PAGE, remove: ["a"], sizeOf });

  assert.deepEqual(result.removed, ["a"]);
  assert.deepEqual(result.notOnBoard, []);
  assert.deepEqual(
    result.elements.map((element) => element.id),
    ["img-b", "txt-Act two"],
  );
});

test("a photograph dropped twice leaves once", () => {
  const elements = [
    picture("a", { x: 0, y: 0, width: 300, height: 200 }),
    { ...picture("a", { x: 400, y: 0, width: 300, height: 200 }), id: "img-a-again" },
  ];

  const result = placeOnBoard({ elements, page: PAGE, remove: ["a"], sizeOf });

  assert.deepEqual(result.elements, []);
  assert.deepEqual(result.removed, ["a"]);
});

test("taking off a picture the board never held is said, not swallowed", () => {
  const elements = [picture("a", { x: 0, y: 0, width: 300, height: 200 })];

  const result = placeOnBoard({ elements, page: PAGE, remove: ["b"], sizeOf });

  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.notOnBoard, ["b"]);
  assert.deepEqual(result.elements, elements);
});

test("a picture already on the board is not drawn twice", () => {
  const elements = [picture("wide", { x: 0, y: 0, width: 300, height: 150 })];

  const result = placeOnBoard({ elements, page: PAGE, add: ["wide"], sizeOf });

  assert.deepEqual(result.added, []);
  assert.deepEqual(result.alreadyOn, ["wide"]);
  assert.deepEqual(result.elements, elements);
});

test("a picture taken off and put back on in one call is placed again", () => {
  const elements = [picture("wide", { x: 0, y: 0, width: 300, height: 150 })];

  const result = placeOnBoard({
    elements,
    page: PAGE,
    add: ["wide"],
    remove: ["wide"],
    sizeOf,
    makeId: () => "new-1",
  });

  assert.deepEqual(result.added, ["wide"]);
  assert.deepEqual(result.removed, ["wide"]);
  assert.deepEqual(result.alreadyOn, []);
  assert.deepEqual(ids(result.elements), ["ref:wide"]);
  assert.equal(result.elements[0].id, "new-1");
});

test("a picture joining a board whose pictures sit in one corner lands beside them", () => {
  /// Deliberately not `sceneBounds`, which always covers the page: a new picture
  /// a page-height below the arrangement is a picture the director has to hunt
  /// for.
  const elements = [picture("a", { x: 0, y: 0, width: 200, height: 200 })];

  const result = placeOnBoard({ elements, page: PAGE, add: ["square"], sizeOf });

  assert.equal(result.elements[1].y, 200 + DROPPED_IMAGE_GAP);
});
