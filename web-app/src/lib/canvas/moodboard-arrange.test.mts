import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ARRANGE_GAP,
  arrangeChanges,
  elementPlacements,
  arrangeableUnits,
  arrangeTargets,
  arrangeRows,
  groupChanges,
  readingOrder,
  type ArrangeBox,
} from "@/lib/canvas/moodboard-arrange";
import { frameInnerBox } from "@/lib/canvas/moodboard-frames";
import { droppedImages } from "@/lib/canvas/moodboard-drop";
import { persistableElements } from "@/lib/scene/moodboard-scene";

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
  const boxes = arrangeableUnits([
    image("a", { x: 0, y: 0, width: 100, height: 100 }),
    { id: "b", type: "text", x: 0, y: 0, width: 80, height: 20 },
    { id: "c", type: "arrow", x: 0, y: 0, width: 80, height: 20 },
    { id: "d", type: "rectangle", x: 0, y: 0, width: 60, height: 40 },
  ]);

  assert.deepEqual(IDS(boxes), ["a"]);
});

test("a deleted or locked image is not moved", () => {
  const boxes = arrangeableUnits([
    image("a", { x: 0, y: 0, width: 100, height: 100 }),
    { ...image("gone", { x: 0, y: 0, width: 100, height: 100 }), isDeleted: true },
    { ...image("pinned", { x: 0, y: 0, width: 100, height: 100 }), locked: true },
  ]);

  assert.deepEqual(IDS(boxes), ["a"]);
});

test("an image with no usable geometry is skipped rather than laid out at NaN", () => {
  const boxes = arrangeableUnits([
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
  const boxes = arrangeableUnits(
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
  const boxes = arrangeableUnits([
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
  const boxes = arrangeableUnits(
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
  const boxes = arrangeableUnits(
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
  const boxes = arrangeableUnits(
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
  const boxes = arrangeableUnits(
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
  const boxes = arrangeableUnits([image("a", { x: 120, y: 40, width: 300, height: 200 })]);
  assert.deepEqual(arrangeRows(boxes), [
    { id: "a", referenceId: "a", frameId: null, x: 120, y: 40, width: 300, height: 200 },
  ]);
});

test("tidying an already tidy board changes nothing at all", () => {
  const boxes = arrangeableUnits(
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
  const boxes = arrangeableUnits(
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

  const placed = arrangeRows(arrangeableUnits(elements));
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

/// Frames are the board's sections, and until they were understood a tidy swept
/// their photos into the board's own grid — which left every one of them still
/// belonging to a frame it was no longer in, drawn clipped at that frame's edge
/// and dragged along the next time the section was moved.

function framed(
  id: string,
  frameId: string | null,
  box: { x: number; y: number; width: number; height: number },
) {
  return { ...image(id, box), frameId };
}

function frameElement(
  id: string,
  box: { x: number; y: number; width: number; height: number },
) {
  return { id, type: "frame", name: id, ...box };
}

const SECTION = frameElement("act-one", { x: 0, y: 0, width: 800, height: 600 });

test("the photos in a frame are their own group, and the canvas is another", () => {
  const { groups } = arrangeTargets(
    [
      SECTION,
      framed("in-a", "act-one", { x: 10, y: 10, width: 200, height: 150 }),
      framed("in-b", "act-one", { x: 300, y: 10, width: 200, height: 150 }),
      framed("out", null, { x: 2000, y: 0, width: 200, height: 150 }),
      framed("orphan", "deleted-frame", { x: 2400, y: 0, width: 200, height: 150 }),
    ],
    {},
  );

  assert.deepEqual(
    groups.map((group) => [group.frame?.id ?? null, IDS(group.boxes)]),
    [
      [null, ["out", "orphan"]],
      ["act-one", ["in-a", "in-b"]],
    ],
  );
});

test("a board with no frames is one group, exactly as before", () => {
  const elements = [
    image("a", { x: 0, y: 0, width: 100, height: 100 }),
    image("b", { x: 200, y: 0, width: 100, height: 100 }),
  ];
  const { groups, boxes } = arrangeTargets(elements, {});

  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.frame, null);
  assert.deepEqual(groupChanges(groups), arrangeChanges(boxes));
});

test("a frame's photos are laid out inside the frame, and none of them leaves it", () => {
  const elements = [
    SECTION,
    ...Array.from({ length: 5 }, (_, index) =>
      framed(`i${index}`, "act-one", {
        /// Scattered well outside the frame, which is what a tidy is for.
        x: 900 + index * 400,
        y: 700,
        width: 300 + index * 40,
        height: 200,
      }),
    ),
  ];

  const { groups } = arrangeTargets(elements, {});
  const placed = groupChanges(groups);
  assert.equal(placed.length, 5);

  const inner = frameInnerBox({ id: "act-one", x: 0, y: 0, width: 800, height: 600 });
  for (const box of placed) {
    assert.ok(box.x >= inner.x - 0.5, `${box.id} left ${box.x}`);
    assert.ok(box.y >= inner.y - 0.5, `${box.id} top ${box.y}`);
    assert.ok(box.x + box.width <= inner.x + inner.width + 0.5, `${box.id} right`);
    assert.ok(box.y + box.height <= inner.y + inner.height + 0.5, `${box.id} bottom`);
  }
});

test("a frame's photos keep their aspect ratios and stop overlapping", () => {
  const elements = [
    SECTION,
    framed("wide", "act-one", { x: 0, y: 0, width: 1600, height: 900 }),
    framed("tall", "act-one", { x: 0, y: 0, width: 900, height: 1600 }),
    framed("square", "act-one", { x: 0, y: 0, width: 1000, height: 1000 }),
  ];

  const placed = groupChanges(arrangeTargets(elements, {}).groups);
  const before = new Map(
    arrangeableUnits(elements).map((box) => [box.id, box.width / box.height]),
  );
  for (const box of placed) {
    assert.ok(Math.abs(box.width / box.height - before.get(box.id)!) < 0.01, box.id);
  }
  for (let a = 0; a < placed.length; a++) {
    for (let b = a + 1; b < placed.length; b++) {
      assert.ok(!overlaps(placed[a]!, placed[b]!), `${placed[a]!.id} over ${placed[b]!.id}`);
    }
  }
});

test("the block is centred in its frame", () => {
  const elements = [
    SECTION,
    framed("a", "act-one", { x: 3000, y: 3000, width: 200, height: 200 }),
    framed("b", "act-one", { x: 3400, y: 3000, width: 200, height: 200 }),
  ];

  const placed = groupChanges(arrangeTargets(elements, {}).groups);
  const left = Math.min(...placed.map((box) => box.x));
  const right = Math.max(...placed.map((box) => box.x + box.width));
  const top = Math.min(...placed.map((box) => box.y));
  const bottom = Math.max(...placed.map((box) => box.y + box.height));

  assert.ok(Math.abs((left + right) / 2 - 400) < 0.5);
  assert.ok(Math.abs((top + bottom) / 2 - 300) < 0.5);
});

/// The same property the free grid has, and the reason a tidy can be pressed
/// twice without adding an undo step that did nothing — a frame does not move,
/// so the second pass solves exactly the problem the first one did.
test("tidying a frame twice moves nothing the second time", () => {
  const elements = [
    SECTION,
    ...Array.from({ length: 6 }, (_, index) =>
      framed(`i${index}`, "act-one", {
        x: 900 + index * 130,
        y: 700 + index * 40,
        width: 220 + (index % 3) * 60,
        height: 160 + (index % 2) * 55,
      }),
    ),
  ];

  const first = groupChanges(arrangeTargets(elements, {}).groups);
  assert.ok(first.length > 0);

  const tidied = elements.map((element) => {
    const box = first.find((entry) => entry.id === element.id);
    return box ? { ...element, x: box.x, y: box.y, width: box.width, height: box.height } : element;
  });
  assert.deepEqual(groupChanges(arrangeTargets(tidied, {}).groups), []);
});

test("a frame too small to hold its own padding leaves its photos alone", () => {
  const elements = [
    frameElement("tiny", { x: 0, y: 0, width: 10, height: 10 }),
    framed("a", "tiny", { x: 500, y: 500, width: 200, height: 200 }),
    framed("b", "tiny", { x: 800, y: 500, width: 200, height: 200 }),
  ];

  assert.deepEqual(groupChanges(arrangeTargets(elements, {}).groups), []);
});

test("selecting photos across two frames tidies each of them where it is", () => {
  const second = frameElement("act-two", { x: 1200, y: 0, width: 800, height: 600 });
  const elements = [
    SECTION,
    second,
    framed("a1", "act-one", { x: 20, y: 400, width: 200, height: 150 }),
    framed("a2", "act-one", { x: 260, y: 400, width: 200, height: 150 }),
    framed("b1", "act-two", { x: 1220, y: 400, width: 200, height: 150 }),
    framed("b2", "act-two", { x: 1460, y: 400, width: 200, height: 150 }),
  ];
  const selected = { selectedElementIds: { a1: true, a2: true, b1: true, b2: true } };

  const { scope, groups } = arrangeTargets(elements, selected);
  assert.equal(scope, "selection");
  assert.deepEqual(
    groups.map((group) => group.frame?.id),
    ["act-one", "act-two"],
  );

  for (const box of groupChanges(groups)) {
    const frame = box.id.startsWith("a") ? SECTION : second;
    assert.ok(box.x >= frame.x && box.x + box.width <= frame.x + frame.width, box.id);
  }
});

test("selecting the frame aims the tidy at the section, not at the board", () => {
  const elements = [
    SECTION,
    framed("in-a", "act-one", { x: 20, y: 20, width: 200, height: 150 }),
    framed("in-b", "act-one", { x: 900, y: 900, width: 200, height: 150 }),
    image("loose", { x: 3000, y: 0, width: 200, height: 150 }),
  ];

  const { scope, boxes, groups } = arrangeTargets(elements, {
    selectedElementIds: { "act-one": true },
  });

  assert.equal(scope, "selection");
  assert.deepEqual(IDS(boxes), ["in-a", "in-b"]);
  assert.deepEqual(
    groups.map((group) => group.frame?.id),
    ["act-one"],
  );
  /// The loose photo is not in the section, so a tidy aimed at the section
  /// leaves it exactly where it is.
  assert.deepEqual(groupChanges(groups).map((box) => box.id).sort(), ["in-a", "in-b"]);
});

function grouped(
  id: string,
  group: string,
  box: { x: number; y: number; width: number; height: number },
) {
  return { ...image(id, box), groupIds: [group] };
}

function caption(
  id: string,
  group: string,
  box: { x: number; y: number; width: number; height: number },
) {
  return { id, type: "text", groupIds: [group], fontSize: 20, ...box };
}

test("a captioned photo is one unit, keyed by its group and bounded by both", () => {
  const boxes = arrangeableUnits([
    grouped("photo", "g1", { x: 100, y: 100, width: 200, height: 150 }),
    caption("note", "g1", { x: 100, y: 260, width: 120, height: 25 }),
  ]);

  assert.equal(boxes.length, 1);
  assert.equal(boxes[0]!.id, "g1");
  assert.equal(boxes[0]!.photos, 1);
  assert.deepEqual(
    { x: boxes[0]!.x, y: boxes[0]!.y, width: boxes[0]!.width, height: boxes[0]!.height },
    { x: 100, y: 100, width: 200, height: 185 },
  );
  assert.deepEqual(boxes[0]!.members?.map((member) => member.id), ["photo", "note"]);
  /// The photo's pointer, so a colour sort can still ask what the unit is of.
  assert.equal(boxes[0]!.referenceId, "photo");
});

test("a group of photos is one block, not five cells", () => {
  const boxes = arrangeableUnits([
    grouped("a", "set", { x: 0, y: 0, width: 100, height: 100 }),
    grouped("b", "set", { x: 120, y: 0, width: 100, height: 100 }),
    image("loose", { x: 400, y: 0, width: 100, height: 100 }),
  ]);

  assert.deepEqual(IDS(boxes), ["set", "loose"]);
  assert.equal(boxes[0]!.photos, 2);
  assert.equal(boxes[0]!.width, 220);
});

test("a group with one locked member is left alone entirely", () => {
  const boxes = arrangeableUnits([
    grouped("photo", "g1", { x: 0, y: 0, width: 100, height: 100 }),
    { ...caption("note", "g1", { x: 0, y: 110, width: 80, height: 20 }), locked: true },
    image("loose", { x: 400, y: 0, width: 100, height: 100 }),
  ]);

  assert.deepEqual(IDS(boxes), ["loose"]);
});

test("a group holding no photo is not a unit — a palette bar stays where it is", () => {
  const boxes = arrangeableUnits([
    { id: "chip", type: "rectangle", groupIds: ["bar"], x: 0, y: 0, width: 60, height: 60 },
    { id: "hex", type: "text", containerId: "chip", x: 0, y: 20, width: 60, height: 20 },
    image("loose", { x: 400, y: 0, width: 100, height: 100 }),
  ]);

  assert.deepEqual(IDS(boxes), ["loose"]);
});

test("a bound label rides with the shape it labels, though it is in no group", () => {
  const boxes = arrangeableUnits([
    grouped("photo", "g1", { x: 0, y: 0, width: 200, height: 200 }),
    { id: "plate", type: "rectangle", groupIds: ["g1"], x: 0, y: 220, width: 200, height: 40 },
    { id: "hex", type: "text", containerId: "plate", fontSize: 16, x: 10, y: 230, width: 60, height: 20 },
  ]);

  assert.deepEqual(boxes[0]!.members?.map((member) => member.id), ["photo", "plate", "hex"]);
});

test("a caption travels with its photo and scales by the same factor", () => {
  const boxes = arrangeableUnits([
    grouped("photo", "g1", { x: 0, y: 0, width: 200, height: 150 }),
    caption("note", "g1", { x: 0, y: 160, width: 120, height: 25 }),
    image("other", { x: 1000, y: 1000, width: 400, height: 300 }),
  ]);

  const placed = arrangeRows(boxes);
  const unit = placed.find((box) => box.id === "g1")!;
  const before = boxes.find((box) => box.id === "g1")!;
  const scale = unit.width / before.width;

  const elements = new Map(
    elementPlacements(boxes, placed).map((placement) => [placement.id, placement]),
  );

  const photo = elements.get("photo")!;
  const note = elements.get("note")!;

  /// The photo sits at the unit's top-left and the caption below it, both at the
  /// same scale — the arrangement the director grouped them to keep.
  assert.ok(Math.abs(photo.x - unit.x) < 0.05);
  assert.ok(Math.abs(photo.y - unit.y) < 0.05);
  assert.ok(Math.abs(photo.width - 200 * scale) < 0.05);
  assert.ok(Math.abs(note.y - (unit.y + 160 * scale)) < 0.05);
  assert.ok(Math.abs(note.width - 120 * scale) < 0.05);
  /// Text has a size of its own, and a caption left at yesterday's point size
  /// inside today's box is the half of the transform that is easy to forget.
  assert.ok(Math.abs(note.fontSize! - 20 * scale) < 0.05);
  /// Nothing leaves the unit it was placed in.
  for (const id of ["photo", "note"]) {
    const member = elements.get(id)!;
    assert.ok(member.x >= unit.x - 0.05 && member.x + member.width <= unit.x + unit.width + 0.05);
    assert.ok(member.y >= unit.y - 0.05 && member.y + member.height <= unit.y + unit.height + 0.05);
  }
});

test("an arrow in a group has its points scaled, not just its box", () => {
  const boxes = arrangeableUnits([
    grouped("photo", "g1", { x: 0, y: 0, width: 200, height: 150 }),
    {
      id: "point-at",
      type: "arrow",
      groupIds: ["g1"],
      x: 210,
      y: 0,
      width: 100,
      height: 50,
      points: [
        [0, 0],
        [100, 50],
      ],
    },
    image("other", { x: 1000, y: 1000, width: 400, height: 300 }),
  ]);

  const placed = arrangeRows(boxes);
  const unit = placed.find((box) => box.id === "g1")!;
  const scale = unit.width / boxes.find((box) => box.id === "g1")!.width;
  const arrow = elementPlacements(boxes, placed).find((p) => p.id === "point-at")!;

  assert.deepEqual(arrow.points, [
    [0, 0],
    [Math.round(100 * scale * 100) / 100, Math.round(50 * scale * 100) / 100],
  ]);
  assert.ok(Math.abs(arrow.width - 100 * scale) < 0.05);
});

test("a lone photo is still written back as itself, with no member expansion", () => {
  const boxes = arrangeableUnits([
    image("a", { x: 0, y: 0, width: 200, height: 150 }),
    image("b", { x: 1000, y: 0, width: 200, height: 150 }),
  ]);
  const placed = arrangeRows(boxes);

  assert.deepEqual(
    elementPlacements(boxes, placed),
    placed.map((box) => ({ id: box.id, x: box.x, y: box.y, width: box.width, height: box.height })),
  );
});

test("tidying a board with a captioned photo twice moves nothing the second time", () => {
  const scene = [
    grouped("photo", "g1", { x: 0, y: 0, width: 200, height: 150 }),
    caption("note", "g1", { x: 0, y: 160, width: 120, height: 25 }),
    image("b", { x: 400, y: 0, width: 300, height: 200 }),
    image("c", { x: 800, y: 40, width: 240, height: 240 }),
  ] as Record<string, unknown>[];

  const first = arrangeableUnits(scene);
  const moved = elementPlacements(first, arrangeChanges(first));
  assert.ok(moved.length > 0);

  const after = scene.map((element) => {
    const placement = moved.find((entry) => entry.id === element.id);
    return placement ? { ...element, ...placement } : element;
  });

  assert.deepEqual(elementPlacements(arrangeableUnits(after), arrangeChanges(arrangeableUnits(after))), []);
});

test("a selection of a captioned photo and a loose one is two units", () => {
  const elements = [
    grouped("photo", "g1", { x: 0, y: 0, width: 200, height: 150 }),
    caption("note", "g1", { x: 0, y: 160, width: 120, height: 25 }),
    image("b", { x: 400, y: 0, width: 300, height: 200 }),
    image("c", { x: 800, y: 0, width: 300, height: 200 }),
  ];

  /// Excalidraw selects the whole group, and neither of its ids is the unit's.
  const { scope, boxes } = arrangeTargets(elements, {
    selectedElementIds: { photo: true, note: true, b: true },
  });

  assert.equal(scope, "selection");
  assert.deepEqual(IDS(boxes), ["g1", "b"]);
});
