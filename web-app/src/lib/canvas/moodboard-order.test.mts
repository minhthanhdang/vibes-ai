import { test } from "node:test";
import assert from "node:assert/strict";

import { arrangeChanges, arrangeableUnits, type ArrangeBox } from "@/lib/canvas/moodboard-arrange";
import { colourOrder, hasColourOrder, paletteTone, type BoardPalettes } from "@/lib/canvas/moodboard-order";

/// The board reads left to right, so a row of boxes in this order is also its
/// reading order — which makes every reordering below the colour rule's doing
/// and not the layout's.
function row(ids: readonly string[]): ArrangeBox[] {
  return ids.map((id, index) => ({
    id,
    referenceId: id,
    x: index * 200,
    y: 0,
    width: 100,
    height: 100,
  }));
}

function palettes(entries: Record<string, string[]>): BoardPalettes {
  return new Map(Object.entries(entries));
}

const IDS = (boxes: readonly ArrangeBox[]) => boxes.map((box) => box.id);

test("a photo is filed under the first colour in its palette that has a hue", () => {
  /// The palette is ordered most prominent first, so a night shot that opens on
  /// two near-blacks is still the shot with the neon in it.
  const tone = paletteTone(["#0a0a0c", "#141416", "#ff2f6d", "#8a8a8a"]);

  assert.equal(tone?.kind, "chromatic");
  assert.ok(tone?.kind === "chromatic" && tone.hue > 330 && tone.hue < 350);
});

test("a palette with no colour in it is a tone, not a hue", () => {
  const tone = paletteTone(["#101010", "#4a4a4a", "#909090"]);

  assert.equal(tone?.kind, "neutral");
  assert.ok(tone?.kind === "neutral" && tone.lightness > 0.2 && tone.lightness < 0.45);
});

test("a near-black with a hue on it is still a tone", () => {
  /// #050208 is technically violet and reads as black.
  assert.equal(paletteTone(["#050208"])?.kind, "neutral");
});

test("an unanalyzed reference has no tone at all, which is not the same as neutral", () => {
  assert.equal(paletteTone(undefined), null);
  assert.equal(paletteTone([]), null);
  assert.equal(paletteTone(["not a colour", 7, null]), null);
});

test("the photos come out grouped around the wheel rather than as they were placed", () => {
  const boxes = row(["red", "green", "blue", "orange"]);
  const ordered = colourOrder(
    boxes,
    palettes({
      red: ["#e02020"],
      green: ["#2fbf3f"],
      blue: ["#2050e0"],
      orange: ["#f08a1e"],
    }),
  );

  assert.deepEqual(IDS(ordered), ["red", "orange", "green", "blue"]);
});

test("a cluster straddling red is not cut in half by the start of the wheel", () => {
  /// Hues 348, 6 and 12 are one family of reds. Starting the order at 0° would
  /// put the first of them at one end of the board and the other two at the
  /// other; the run starts after the widest unused arc instead, so the family
  /// comes out adjacent and in hue order however it straddles the wheel.
  const boxes = row(["crimson", "scarlet", "vermilion", "teal"]);
  const ordered = colourOrder(
    boxes,
    palettes({
      crimson: ["#e0002c"],
      scarlet: ["#e01500"],
      vermilion: ["#e02d00"],
      teal: ["#00b3b3"],
    }),
  );

  assert.deepEqual(IDS(ordered), ["crimson", "scarlet", "vermilion", "teal"]);
});

test("the greyscale frames follow the colour run as a dark-to-light ramp", () => {
  const boxes = row(["pale", "amber", "charcoal", "mid"]);
  const ordered = colourOrder(
    boxes,
    palettes({
      pale: ["#efefef"],
      amber: ["#f0a022"],
      charcoal: ["#1a1a1a"],
      mid: ["#7d7d7d"],
    }),
  );

  assert.deepEqual(IDS(ordered), ["amber", "charcoal", "mid", "pale"]);
});

test("a photo the analyzer has not answered on goes to the tail, in reading order", () => {
  const boxes = row(["waiting", "blue", "alsoWaiting", "red"]);
  const ordered = colourOrder(boxes, palettes({ blue: ["#2050e0"], red: ["#e02020"] }));

  assert.deepEqual(IDS(ordered), ["blue", "red", "waiting", "alsoWaiting"]);
});

test("every photo comes out exactly once, whatever is known about it", () => {
  const boxes = row(["a", "b", "c", "d", "e"]);
  const ordered = colourOrder(boxes, palettes({ a: ["#e02020"], c: ["#808080"], d: [] }));

  assert.deepEqual([...IDS(ordered)].sort(), ["a", "b", "c", "d", "e"]);
});

test("an image with no reference behind it is not a colour, it is unknown", () => {
  const boxes: ArrangeBox[] = [
    { id: "drawn", referenceId: null, x: 0, y: 0, width: 100, height: 100 },
    { id: "photo", referenceId: "photo", x: 200, y: 0, width: 100, height: 100 },
  ];

  assert.deepEqual(IDS(colourOrder(boxes, palettes({ photo: ["#e02020"] }))), ["photo", "drawn"]);
});

test("tidying by colour twice moves nothing the second time", () => {
  const board = palettes({
    a: ["#e02020"],
    b: ["#2050e0"],
    c: ["#2fbf3f"],
    d: ["#808080"],
    e: [],
  });
  const order = (boxes: readonly ArrangeBox[]) => colourOrder(boxes, board);

  const boxes = arrangeableUnits(
    ["a", "b", "c", "d", "e"].map((id, index) => ({
      id,
      type: "image",
      fileId: `ref:${id}`,
      x: index * 137,
      y: (index % 2) * 211,
      width: 90 + index * 30,
      height: 120,
    })),
  );

  const first = arrangeChanges(boxes, order);
  assert.ok(first.length > 0);

  const after = boxes.map((box) => first.find((placed) => placed.id === box.id) ?? box);
  assert.deepEqual(arrangeChanges(after, order), []);
});

test("the colour sort is offered only when two photos can actually be sorted", () => {
  const board = palettes({ a: ["#e02020"], b: ["#2050e0"], c: [] });

  assert.equal(hasColourOrder(["a", "b", "c"], board), true);
  assert.equal(hasColourOrder(["a", "c"], board), false);
  assert.equal(hasColourOrder(["a", "a"], board), false);
  assert.equal(hasColourOrder([], board), false);
});

test("a photo dropped from the sidebar is filed under the reference it came from", () => {
  /// The contract the whole feature rests on: `arrangeableUnits` has to recover
  /// the same reference id the analyzer's palette is keyed by, or the board
  /// sorts every photo as unknown and the tidy is the plain one.
  const boxes = arrangeableUnits([
    { id: "el", type: "image", fileId: "ref:abc123", x: 0, y: 0, width: 100, height: 100 },
  ]);

  assert.equal(boxes[0]?.referenceId, "abc123");
  assert.deepEqual(IDS(colourOrder(boxes, palettes({ abc123: ["#e02020"] }))), ["el"]);
});
