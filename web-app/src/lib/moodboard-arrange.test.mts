import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ARRANGE_GAP,
  arrangeChanges,
  arrangeableImages,
  arrangeTargets,
  arrangeRows,
  readingOrder,
  type ArrangeBox,
} from "./moodboard-arrange";
import { droppedImages } from "./moodboard-drop";
import { persistableElements } from "./moodboard-scene";

function image(id: string, box: { x: number; y: number; width: number; height: number }) {
  return { id, type: "image", fileId: `ref:${id}`, ...box };
}

const AREA = (boxes: readonly ArrangeBox[]) =>
  boxes.reduce((sum, box) => sum + box.width * box.height, 0);

const IDS = (boxes: readonly ArrangeBox[]) => boxes.map((box) => box.id);

function overlaps(a: ArrangeBox, b: ArrangeBox) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

test("only images take part — a note, an arrow and a swatch keep their place", () => {
  const boxes = arrangeableImages([
    image("a", { x: 0, y: 0, width: 100, height: 100 }),
    { id: "b", type: "text", x: 0, y: 0, width: 80, height: 20 },
    { id: "c", type: "arrow", x: 0, y: 0, width: 80, height: 20 },
    { id: "d", type: "rectangle", x: 0, y: 0, width: 60, height: 40 },
  ]);

  assert.deepEqual(IDS(boxes), ["a"]);
});

test("a deleted or locked image is not moved", () => {
  const boxes = arrangeableImages([
    image("a", { x: 0, y: 0, width: 100, height: 100 }),
    { ...image("gone", { x: 0, y: 0, width: 100, height: 100 }), isDeleted: true },
    { ...image("pinned", { x: 0, y: 0, width: 100, height: 100 }), locked: true },
  ]);

  assert.deepEqual(IDS(boxes), ["a"]);
});

test("an image with no usable geometry is skipped rather than laid out at NaN", () => {
  const boxes = arrangeableImages([
    image("a", { x: 0, y: 0, width: 100, height: 100 }),
    { id: "b", type: "image", x: 0, y: 0, width: 0, height: 100 },
    { id: "c", type: "image", x: Number.NaN, y: 0, width: 10, height: 10 },
    { id: "d", type: "image", y: 0, width: 10, height: 10 },
  ]);

  assert.deepEqual(IDS(boxes), ["a"]);
});

test("two or more images selected is what gets tidied", () => {
  const elements = [
    image("a", { x: 0, y: 0, width: 100, height: 100 }),
    image("b", { x: 200, y: 0, width: 100, height: 100 }),
    image("c", { x: 400, y: 0, width: 100, height: 100 }),
  ];
  const targets = arrangeTargets(elements, {
    selectedElementIds: { a: true, b: true, c: false },
  });

  assert.equal(targets.scope, "selection");
  assert.deepEqual(IDS(targets.boxes), ["a", "b"]);
});

test("selecting one image tidies the board — one image is not an arrangement", () => {
  const elements = [
    image("a", { x: 0, y: 0, width: 100, height: 100 }),
    image("b", { x: 200, y: 0, width: 100, height: 100 }),
  ];
  const targets = arrangeTargets(elements, { selectedElementIds: { a: true } });

  assert.equal(targets.scope, "board");
  assert.deepEqual(IDS(targets.boxes), ["a", "b"]);
});

test("selecting a shape and nothing else still tidies the board", () => {
  const elements = [
    image("a", { x: 0, y: 0, width: 100, height: 100 }),
    { id: "s", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
  ];
  const targets = arrangeTargets(elements, { selectedElementIds: { s: true } });

  assert.equal(targets.scope, "board");
  assert.deepEqual(IDS(targets.boxes), ["a"]);
});

test("the grid is filled in the order the board reads, not in z-order", () => {
  /// Listed back to front: the last photo pasted is the first element here.
  const order = readingOrder([
    image("bottom-right", { x: 400, y: 300, width: 200, height: 150 }),
    image("top-right", { x: 400, y: 0, width: 200, height: 150 }),
    image("top-left", { x: 0, y: 0, width: 200, height: 150 }),
    image("bottom-left", { x: 0, y: 300, width: 200, height: 150 }),
  ]);

  assert.deepEqual(IDS(order), ["top-left", "top-right", "bottom-left", "bottom-right"]);
});

test("a row whose photos do not line up exactly is still one row", () => {
  /// Three photos placed by hand across the top: none of them share a y, and a
  /// sort on y alone would read them as three rows.
  const order = readingOrder([
    image("middle", { x: 300, y: 12, width: 200, height: 150 }),
    image("right", { x: 600, y: -9, width: 200, height: 150 }),
    image("left", { x: 0, y: 4, width: 200, height: 150 }),
  ]);

  assert.deepEqual(IDS(order), ["left", "middle", "right"]);
});

test("tidying keeps every photo, once", () => {
  const boxes = arrangeableImages(
    Array.from({ length: 9 }, (_, index) =>
      image(`i${index}`, {
        x: index * 37,
        y: index * 91,
        width: 100 + index * 20,
        height: 200 - index * 10,
      }),
    ),
  );

  const placed = arrangeRows(boxes);
  assert.deepEqual(IDS(placed).sort(), IDS(boxes).sort());
});

test("every photo keeps its own aspect ratio", () => {
  const boxes = arrangeableImages([
    image("wide", { x: 0, y: 0, width: 400, height: 100 }),
    image("tall", { x: 0, y: 0, width: 100, height: 400 }),
    image("square", { x: 0, y: 0, width: 200, height: 200 }),
    image("photo", { x: 0, y: 0, width: 300, height: 200 }),
  ]);
  const before = new Map(boxes.map((box) => [box.id, box.width / box.height]));

  for (const placed of arrangeRows(boxes)) {
    assert.ok(
      Math.abs(placed.width / placed.height - before.get(placed.id)!) < 0.01,
      `${placed.id} changed shape`,
    );
  }
});

test("every photo on the board comes out the same height, in centred rows", () => {
  const boxes = arrangeableImages(
    Array.from({ length: 12 }, (_, index) =>
      image(`i${index}`, {
        x: index * 50,
        y: index * 50,
        width: 200 + (index % 3) * 60,
        height: 150 + (index % 4) * 40,
      }),
    ),
  );

  const placed = arrangeRows(boxes);
  for (const box of placed) assert.ok(Math.abs(box.height - placed[0]!.height) < 0.01);

  const rows = new Map<number, typeof placed>();
  for (const box of placed) {
    const row = rows.get(box.y) ?? [];
    row.push(box);
    rows.set(box.y, row);
  }
  assert.ok(rows.size > 1, "expected more than one row");

  const centres = [...rows.values()].map((row) => {
    const left = Math.min(...row.map((box) => box.x));
    const right = Math.max(...row.map((box) => box.x + box.width));
    return (left + right) / 2;
  });
  for (const centre of centres) assert.ok(Math.abs(centre - centres[0]!) < 0.5);
});

test("nothing overlaps", () => {
  const boxes = arrangeableImages(
    Array.from({ length: 15 }, (_, index) =>
      image(`i${index}`, {
        x: 0,
        y: 0,
        width: 120 + ((index * 7) % 5) * 40,
        height: 100 + ((index * 3) % 4) * 50,
      }),
    ),
  );

  const placed = arrangeRows(boxes);
  for (let a = 0; a < placed.length; a++) {
    for (let b = a + 1; b < placed.length; b++) {
      assert.ok(!overlaps(placed[a]!, placed[b]!), `${placed[a]!.id} overlaps ${placed[b]!.id}`);
    }
  }
});

test("the photos cover the area they covered before — a tidy is not a zoom", () => {
  const boxes = arrangeableImages(
    Array.from({ length: 8 }, (_, index) =>
      image(`i${index}`, {
        x: index * 400,
        y: 0,
        width: 320 - index * 20,
        height: 240 + index * 15,
      }),
    ),
  );

  const before = AREA(boxes);
  const after = AREA(arrangeRows(boxes));
  assert.ok(Math.abs(after - before) < before * 0.01, `${after} vs ${before}`);
});

test("the block sits in the middle of where the photos were", () => {
  const boxes = arrangeableImages(
    Array.from({ length: 6 }, (_, index) =>
      image(`i${index}`, { x: 1000 + index * 300, y: 600 + index * 40, width: 300, height: 200 }),
    ),
  );
  const centre = (list: readonly ArrangeBox[]) => ({
    x: (Math.min(...list.map((b) => b.x)) + Math.max(...list.map((b) => b.x + b.width))) / 2,
    y: (Math.min(...list.map((b) => b.y)) + Math.max(...list.map((b) => b.y + b.height))) / 2,
  });

  const before = centre(boxes);
  const after = centre(arrangeRows(boxes));
  assert.ok(Math.abs(after.x - before.x) < 0.5, `x moved to ${after.x} from ${before.x}`);
  assert.ok(Math.abs(after.y - before.y) < 0.5, `y moved to ${after.y} from ${before.y}`);
});

test("a single photo is left exactly where it is", () => {
  const boxes = arrangeableImages([image("a", { x: 120, y: 40, width: 300, height: 200 })]);
  assert.deepEqual(arrangeRows(boxes), [
    { id: "a", referenceId: "a", x: 120, y: 40, width: 300, height: 200 },
  ]);
});

test("tidying an already tidy board changes nothing at all", () => {
  const boxes = arrangeableImages(
    Array.from({ length: 7 }, (_, index) =>
      image(`i${index}`, {
        x: index * 90,
        y: index * 30,
        width: 200 + (index % 3) * 55,
        height: 140 + (index % 2) * 60,
      }),
    ),
  );

  const once = arrangeRows(boxes);
  assert.ok(arrangeChanges(boxes).length > 0);
  assert.deepEqual(arrangeChanges(once), []);
});

test("gaps are the drop's own, so a tidied grid matches one that was dropped", () => {
  const boxes = arrangeableImages(
    Array.from({ length: 4 }, (_, index) =>
      image(`i${index}`, { x: index * 500, y: 0, width: 200, height: 200 }),
    ),
  );

  const placed = arrangeRows(boxes);
  const first = placed[0]!;
  const second = placed[1]!;
  assert.equal(Math.round(second.x - (first.x + first.width)), ARRANGE_GAP);
});

/// The contract that cannot be seen by looking at the board: a tidy is a
/// position change on the same elements, so what it produces has to survive the
/// filter the autosave puts every scene through, or the arrangement is lost on
/// reload.
test("a tidied element is still a storable one", () => {
  const dropped = droppedImages(
    [
      { referenceId: "one", width: 1600, height: 900 },
      { referenceId: "two", width: 900, height: 1600 },
      { referenceId: "three", width: 1200, height: 1200 },
    ],
    { x: 0, y: 0 },
  );
  const elements = dropped.map((image, index) => ({ ...image, id: `e${index}` }));

  const placed = arrangeRows(arrangeableImages(elements));
  const tidied = elements.map((element) => {
    const box = placed.find((entry) => entry.id === element.id)!;
    return { ...element, ...box };
  });

  const stored = persistableElements(tidied);
  assert.equal(stored.length, 3);
  for (const element of stored) {
    const box = placed.find((entry) => entry.id === element.id)!;
    assert.equal(element.x, box.x);
    assert.equal(element.width, box.width);
    assert.equal(element.fileId, `ref:${element.fileId?.toString().slice(4)}`);
  }
});
