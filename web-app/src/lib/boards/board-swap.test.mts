import { test } from "node:test";
import assert from "node:assert/strict";

import { swapOnBoard } from "@/lib/boards/board-swap";
import { fitInSlot, layoutById } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The edit that replaced a rebuild. Everything here is about the two things a
/// swap promises — the new picture takes the old one's place, and nothing else
/// on the board moves — plus what it says about the pairs it could not honour.

const SPLIT = layoutById("SPLIT")!;

const slotOf = (id: string) => SPLIT.slots.find((slot) => slot.id === id)!;

function seated(
  placed: readonly [string, string, number, number][],
  extra: readonly SceneElement[] = [],
): SceneElement[] {
  return [
    ...placed.map(([referenceId, slotId, width, height], index) => ({
      id: `el-${index}`,
      type: "image",
      fileId: `ref:${referenceId}`,
      ...fitInSlot(slotOf(slotId), { id: referenceId, kind: "image" as const, width, height }),
    })),
    ...extra,
  ];
}

const sizes = (table: Record<string, [number, number]>) => (id: string) =>
  table[id] ? { width: table[id]![0], height: table[id]![1] } : null;

const boxOf = (element: SceneElement) => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
});

test("the picture put on is fitted to the slot, not to the box the loose one had", () => {
  const panel = slotOf("img-1");
  /// A letterbox in a near-square panel: contained, it uses a fraction of the
  /// slot. The cut taken at the panel's own shape must be measured against the
  /// *slot*, or the whole point of the exchange is lost.
  const elements = seated([["wide", "img-1", 1000, 300]]);
  const before = boxOf(elements[0]!);

  const { elements: after, swapped } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "wide", putOn: "cut" }],
    sizeOf: sizes({ cut: [panel.width, panel.height] }),
  });

  assert.deepEqual(swapped, [{ takeOff: "wide", putOn: "cut", slotId: "img-1" }]);
  assert.equal(after[0]!.fileId, "ref:cut");
  assert.deepEqual(boxOf(after[0]!), {
    x: panel.x,
    y: panel.y,
    width: panel.width,
    height: panel.height,
  });
  assert.notDeepEqual(boxOf(after[0]!), before);
});

test("nothing but the swapped element changes, and it keeps its place in the array", () => {
  const elements = seated(
    [
      ["a", "img-1", 1000, 300],
      ["b", "img-2", 1000, 1000],
    ],
    [{ id: "caption", type: "text", x: 10, y: 10, width: 200, height: 40, text: "Act two" }],
  );

  const { elements: after } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "cut" }],
    sizeOf: sizes({ cut: [1600, 900] }),
  });

  assert.equal(after.length, 3);
  /// Same element id and same index: z-order is array order, so a swap that
  /// appended would put the picture over the caption it was under.
  assert.equal(after[0]!.id, "el-0");
  assert.deepEqual(after[1], elements[1]);
  assert.deepEqual(after[2], elements[2]);
});

test("a picture the director moved themselves keeps its centre and its weight", () => {
  const elements: SceneElement[] = [
    { id: "el-0", type: "image", fileId: "ref:a", x: 0, y: 0, width: 400, height: 300 },
  ];

  const { elements: after, swapped } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "tall" }],
    sizeOf: sizes({ tall: [1000, 2000] }),
  });

  /// No slot: the board's template put nothing here, so there is nothing to fit
  /// to and the answer says so rather than naming a slot nobody is using.
  assert.deepEqual(swapped, [{ takeOff: "a", putOn: "tall" }]);
  const box = boxOf(after[0]!) as { x: number; y: number; width: number; height: number };
  assert.equal(box.width / box.height, 0.5);
  /// The room it was occupying, not the box it was drawn in: contained in the
  /// old box the portrait would be 150×300 and shrink again on the next swap.
  assert.ok(Math.abs(box.width * box.height - 400 * 300) / (400 * 300) < 0.01);
  /// Within a pixel: the box is rounded to whole units, so an odd difference
  /// puts the centre on a half.
  assert.ok(Math.abs(box.x + box.width / 2 - 200) <= 1);
  assert.ok(Math.abs(box.y + box.height / 2 - 150) <= 1);
});

test("a picture whose size was never recorded takes the whole slot", () => {
  const panel = slotOf("img-1");
  const elements = seated([["a", "img-1", 1000, 300]]);

  const { elements: after } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "unmeasured" }],
    sizeOf: () => null,
  });

  assert.deepEqual(boxOf(after[0]!), {
    x: panel.x,
    y: panel.y,
    width: panel.width,
    height: panel.height,
  });
});

test("an unmeasured picture on a hand-placed element is left in the box it found", () => {
  const elements: SceneElement[] = [
    { id: "el-0", type: "image", fileId: "ref:a", x: 5, y: 7, width: 400, height: 300 },
  ];

  const { elements: after } = swapOnBoard({
    elements,
    layout: null,
    swaps: [{ takeOff: "a", putOn: "unmeasured" }],
    sizeOf: () => null,
  });

  assert.equal(after[0]!.fileId, "ref:unmeasured");
  assert.deepEqual(boxOf(after[0]!), { x: 5, y: 7, width: 400, height: 300 });
});

test("a picture that is not on the board is named rather than ignored", () => {
  const elements = seated([["a", "img-1", 1000, 300]]);

  const { elements: after, swapped, notOnBoard } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "ghost", putOn: "cut" }],
    sizeOf: sizes({ cut: [1600, 900] }),
  });

  assert.deepEqual(swapped, []);
  assert.deepEqual(notOnBoard, ["ghost"]);
  assert.deepEqual(after, elements);
});

/// Both pictures already on the board is not a replacement — nothing joins the
/// board and nothing leaves it — so it is the one thing a swap can do that a
/// rebuild used to be the only route to.
test("two pictures already on the board trade places, each fitted to the slot it lands in", () => {
  const first = slotOf("img-1");
  const second = slotOf("img-2");
  const elements = seated([
    ["a", "img-1", 1000, 300],
    ["b", "img-2", 300, 1000],
  ]);

  const { elements: after, swapped, traded, alreadyOnBoard } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "b" }],
    sizeOf: sizes({ a: [1000, 300], b: [300, 1000] }),
  });

  assert.deepEqual([swapped, alreadyOnBoard], [[], []]);
  assert.deepEqual(traded, [
    { takeOff: "a", putOn: "b", putOnSlotId: "img-1", takeOffSlotId: "img-2" },
  ]);
  /// Each element keeps its index — z-order is array order — and carries the
  /// other picture, refitted to the slot it is now standing in.
  assert.deepEqual(
    after.map((element) => element.fileId),
    ["ref:b", "ref:a"],
  );
  assert.deepEqual(
    boxOf(after[0]!),
    fitInSlot(first, { id: "b", kind: "image", width: 300, height: 1000 }),
  );
  assert.deepEqual(
    boxOf(after[1]!),
    fitInSlot(second, { id: "a", kind: "image", width: 1000, height: 300 }),
  );
});

test("a trade on a hand-arranged board keeps each place's centre and weight", () => {
  const elements: SceneElement[] = [
    { id: "el-0", type: "image", fileId: "ref:a", x: 0, y: 0, width: 400, height: 300 },
    { id: "el-1", type: "image", fileId: "ref:b", x: 600, y: 600, width: 200, height: 200 },
  ];

  const { elements: after, traded } = swapOnBoard({
    elements,
    layout: null,
    swaps: [{ takeOff: "a", putOn: "b" }],
    sizeOf: sizes({ a: [1000, 2000], b: [1000, 500] }),
  });

  /// No slots to name: the director put both of these where they are, and the
  /// trade is about the two places rather than about the template.
  assert.deepEqual(traded, [{ takeOff: "a", putOn: "b" }]);
  const [into, out] = [boxOf(after[0]!), boxOf(after[1]!)] as {
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
  assert.equal(into!.width / into!.height, 2);
  assert.ok(Math.abs(into!.width * into!.height - 400 * 300) / (400 * 300) < 0.01);
  assert.ok(Math.abs(into!.x + into!.width / 2 - 200) <= 1);
  /// Within a rounded pixel of the portrait's own shape, as the box is whole
  /// units on both axes.
  assert.ok(Math.abs(out!.width / out!.height - 0.5) < 0.01);
  assert.ok(Math.abs(out!.width * out!.height - 200 * 200) / (200 * 200) < 0.01);
  assert.ok(Math.abs(out!.y + out!.height / 2 - 700) <= 1);
});

test("a trade leaves every other picture on the board exactly where it was", () => {
  const elements = seated(
    [
      ["a", "img-1", 1000, 300],
      ["b", "img-2", 300, 1000],
    ],
    [{ id: "caption", type: "text", x: 10, y: 10, width: 200, height: 40, text: "Act two" }],
  );

  const { elements: after } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "b" }],
    sizeOf: sizes({ a: [1000, 300], b: [300, 1000] }),
  });

  assert.equal(after.length, 3);
  assert.deepEqual(after[2], elements[2]);
  assert.deepEqual(
    after.map((element) => element.id),
    ["el-0", "el-1", "caption"],
  );
});

test("a picture named twice in one call is refused rather than traded back", () => {
  const elements = seated([
    ["a", "img-1", 1000, 300],
    ["b", "img-2", 300, 1000],
  ]);

  const { traded, alreadyOnBoard, notOnBoard } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [
      { takeOff: "a", putOn: "b" },
      { takeOff: "b", putOn: "a" },
    ],
    sizeOf: sizes({ a: [1000, 300], b: [300, 1000] }),
  });

  /// The second pair is the first one undone. Both elements are spent, so it is
  /// refused rather than quietly putting the board back as it was.
  assert.equal(traded.length, 1);
  assert.deepEqual([alreadyOnBoard, notOnBoard], [[], ["b"]]);
});

test("a picture put on twice in one call is named rather than moved again", () => {
  const elements = seated([
    ["a", "img-1", 1000, 300],
    ["b", "img-2", 300, 1000],
  ]);

  const { swapped, traded, alreadyOnBoard } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [
      { takeOff: "a", putOn: "cut" },
      { takeOff: "b", putOn: "cut" },
    ],
    sizeOf: sizes({ cut: [1600, 900], b: [300, 1000] }),
  });

  /// The second pair would drag the cut out of the slot it has just landed in
  /// and leave the first place empty — a trade with itself. It is refused, and
  /// `alreadyOnBoard` is what says so.
  assert.equal(swapped.length, 1);
  assert.deepEqual([traded, alreadyOnBoard], [[], ["cut"]]);
});

test("a picture the board does not hold cannot be traded for one it does", () => {
  const elements = seated([["a", "img-1", 1000, 300]]);

  const { elements: after, traded, notOnBoard } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "ghost", putOn: "a" }],
    sizeOf: sizes({ a: [1000, 300] }),
  });

  /// The fault worth naming is the picture that is not there, not the one that
  /// is: only the director knows which frame was meant.
  assert.deepEqual(traded, []);
  assert.deepEqual(notOnBoard, ["ghost"]);
  assert.deepEqual(after, elements);
});

test("two exchanges of the same picture do not both land on the one element", () => {
  const elements = seated([["a", "img-1", 1000, 300]]);

  const { elements: after, swapped, notOnBoard } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [
      { takeOff: "a", putOn: "first" },
      { takeOff: "a", putOn: "second" },
    ],
    sizeOf: sizes({ first: [1600, 900], second: [1600, 900] }),
  });

  assert.deepEqual(
    swapped.map((swap) => swap.putOn),
    ["first"],
  );
  /// The second pair is honestly a miss: after the first exchange there is no
  /// element carrying `a` any more.
  assert.deepEqual(notOnBoard, ["a"]);
  assert.equal(after[0]!.fileId, "ref:first");
});

test("several exchanges in one call each go to their own slot", () => {
  const elements = seated([
    ["a", "img-1", 1000, 300],
    ["b", "img-2", 300, 1000],
  ]);

  const { elements: after, swapped } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [
      { takeOff: "a", putOn: "cut-a" },
      { takeOff: "b", putOn: "cut-b" },
    ],
    sizeOf: sizes({ "cut-a": [1600, 900], "cut-b": [1600, 900] }),
  });

  assert.deepEqual(swapped, [
    { takeOff: "a", putOn: "cut-a", slotId: "img-1" },
    { takeOff: "b", putOn: "cut-b", slotId: "img-2" },
  ]);
  assert.deepEqual(
    after.map((element) => element.fileId),
    ["ref:cut-a", "ref:cut-b"],
  );
});

test("a pair that names the same picture both ways changes nothing", () => {
  const elements = seated([["a", "img-1", 1000, 300]]);

  const { elements: after, swapped, notOnBoard, alreadyOnBoard } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "a" }],
    sizeOf: sizes({ a: [1000, 300] }),
  });

  assert.deepEqual([swapped, notOnBoard, alreadyOnBoard], [[], [], []]);
  assert.deepEqual(after, elements);
});
