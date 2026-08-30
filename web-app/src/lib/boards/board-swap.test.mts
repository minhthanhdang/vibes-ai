import { test } from "node:test";
import assert from "node:assert/strict";

import { swapOnBoard } from "@/lib/boards/board-swap";
import { fitInSlot, layoutById, PAGE_GAP } from "@/lib/layout/moodboard-layouts";
import { boardPages, pageFrame } from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

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
  assert.equal(after[0]!.id, "el-0");
  assert.deepEqual(after[1], elements[1]);
  assert.deepEqual(after[2], elements[2]);
});

test("a picture the user moved themselves keeps its centre and its weight", () => {
  const elements: SceneElement[] = [
    { id: "el-0", type: "image", fileId: "ref:a", x: 0, y: 0, width: 400, height: 300 },
  ];

  const { elements: after, swapped } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "tall" }],
    sizeOf: sizes({ tall: [1000, 2000] }),
  });

  assert.deepEqual(swapped, [{ takeOff: "a", putOn: "tall" }]);
  const box = boxOf(after[0]!) as { x: number; y: number; width: number; height: number };
  assert.equal(box.width / box.height, 0.5);
  assert.ok(Math.abs(box.width * box.height - 400 * 300) / (400 * 300) < 0.01);
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

const PAGE_ONE = { x: 0, y: 0, width: SPLIT.page.width, height: SPLIT.page.height };
const PAGE_TWO = { ...PAGE_ONE, x: SPLIT.page.width + PAGE_GAP };

function spread(
  onPageOne: readonly [string, string, number, number][],
  onPageTwo: readonly [string, string, number, number][],
): SceneElement[] {
  const seat = (
    placed: readonly [string, string, number, number][],
    page: typeof PAGE_ONE,
    named: string,
  ) => [
    ...placed.map(([referenceId, slotId, width, height], index) => {
      const box = fitInSlot(slotOf(slotId), { id: referenceId, kind: "image" as const, width, height });
      return {
        id: `${named}-el-${index}`,
        type: "image",
        fileId: `ref:${referenceId}`,
        frameId: named,
        ...box,
        x: box.x + page.x,
      };
    }),
    pageFrame(page, { name: named, makeId: () => named }),
  ];

  return [...seat(onPageOne, PAGE_ONE, "page-1"), ...seat(onPageTwo, PAGE_TWO, "page-2")];
}

const pageTwoOf = (elements: readonly SceneElement[]) =>
  boardPages(elements).find((page) => page.id === "page-2")!;

test("the picture taken off is the copy on the page named, not the first the board carries", () => {
  const elements = spread([["a", "img-1", 1000, 300]], [["a", "img-1", 1000, 300]]);

  const { elements: after, swapped } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "cut" }],
    sizeOf: sizes({ cut: [1600, 900] }),
    onPage: pageTwoOf(elements),
  });

  assert.deepEqual(swapped, [{ takeOff: "a", putOn: "cut", slotId: "img-1" }]);
  assert.deepEqual(
    after.filter((element) => element.type === "image").map((element) => element.fileId),
    ["ref:a", "ref:cut"],
  );
  assert.deepEqual(after[0], elements[0]);
});

test("a picture swapped on page 2 is fitted to that page's own slot", () => {
  const panel = slotOf("img-1");
  const elements = spread([], [["a", "img-1", 1000, 300]]);

  const { elements: after } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "cut" }],
    sizeOf: sizes({ cut: [panel.width, panel.height] }),
    onPage: pageTwoOf(elements),
  });

  assert.deepEqual(boxOf(after.find((element) => element.type === "image")!), {
    x: panel.x + PAGE_TWO.x,
    y: panel.y,
    width: panel.width,
    height: panel.height,
  });
});

test("a picture on another page joins the page named rather than trading across the board", () => {
  const elements = spread([["a", "img-1", 1000, 300]], [["b", "img-2", 300, 1000]]);

  const { elements: after, swapped, traded } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "b", putOn: "a" }],
    sizeOf: sizes({ a: [1000, 300], b: [300, 1000] }),
    onPage: pageTwoOf(elements),
  });

  assert.deepEqual(traded, []);
  assert.deepEqual(swapped, [{ takeOff: "b", putOn: "a", slotId: "img-2" }]);
  assert.deepEqual(after[0], elements[0]);
  assert.equal(after[2]!.fileId, "ref:a");
});

test("a picture the page has not got is reported rather than taken off another page", () => {
  const elements = spread([["a", "img-1", 1000, 300]], [["b", "img-2", 300, 1000]]);

  const { elements: after, swapped, notOnBoard } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "cut" }],
    sizeOf: sizes({ cut: [1600, 900] }),
    onPage: pageTwoOf(elements),
  });

  assert.deepEqual([swapped, notOnBoard], [[], ["a"]]);
  assert.deepEqual(after, elements);
});

test("a picture dragged off the page is not on it however its frameId reads", () => {
  const elements = spread([["a", "img-1", 1000, 300]], []).map((element) =>
    element.type === "image" ? { ...element, frameId: "page-2" } : element,
  );

  const { swapped, notOnBoard } = swapOnBoard({
    elements,
    layout: SPLIT,
    swaps: [{ takeOff: "a", putOn: "cut" }],
    sizeOf: sizes({ cut: [1600, 900] }),
    onPage: pageTwoOf(elements),
  });

  assert.deepEqual([swapped, notOnBoard], [[], ["a"]]);
});
