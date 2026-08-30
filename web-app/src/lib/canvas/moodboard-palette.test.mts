import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_PALETTE_LIMIT,
  DARK_INK,
  LIGHT_INK,
  mergedPalette,
  paletteAnchor,
  paletteSwatches,
  PALETTE_OFFSET,
  readableInk,
  SWATCH_GAP,
  SWATCH_HEIGHT,
  SWATCH_WIDTH,
} from "@/lib/canvas/moodboard-palette";
import { persistableElements } from "@/lib/scene/moodboard-scene";

const AT = { x: 0, y: 0 };

test("one reference's palette is its own colours, normalized", () => {
  assert.deepEqual(mergedPalette([["#FFF", " #FFCC00 ", "112233"]]), [
    "#ffffff",
    "#ffcc00",
    "#112233",
  ]);
});

test("a colour several references share leads the merged palette", () => {
  const merged = mergedPalette([
    ["#111111", "#c8a165"],
    ["#222222", "#c8a165"],
    ["#333333", "#c8a165"],
  ]);

  assert.equal(merged[0], "#c8a165");
  assert.deepEqual(merged, ["#c8a165", "#111111", "#222222", "#333333"]);
});

test("colours shared by as many references keep the order they were found in", () => {
  assert.deepEqual(mergedPalette([["#aaaaaa", "#bbbbbb"], ["#cccccc"]]), [
    "#aaaaaa",
    "#bbbbbb",
    "#cccccc",
  ]);
});

test("a colour repeated inside one palette is not a shared colour", () => {
  const merged = mergedPalette([
    ["#aaaaaa", "#aaaaaa", "#aaaaaa"],
    ["#bbbbbb", "#cccccc"],
    ["#bbbbbb", "#dddddd"],
  ]);

  assert.equal(merged[0], "#bbbbbb");
});

test("the merged palette stops at a length that still reads as a palette", () => {
  const many = Array.from({ length: 30 }, (_, index) => `#0000${index.toString(16).padStart(2, "0")}`);
  assert.equal(mergedPalette([many]).length, BOARD_PALETTE_LIMIT);
});

test("anything that is not a colour we can paint drops out", () => {
  assert.deepEqual(mergedPalette([["burnt sienna", "", null, 42, "#ggg"]]), []);
  assert.deepEqual(mergedPalette([]), []);
});

test("a hex label is set in whichever ink can be read on its own swatch", () => {
  assert.equal(readableInk("#ffffff"), DARK_INK);
  assert.equal(readableInk("#ffcc00"), DARK_INK);
  assert.equal(readableInk("#000000"), LIGHT_INK);
  assert.equal(readableInk("#101010"), LIGHT_INK);
  assert.equal(readableInk("#00bb00"), DARK_INK);
  assert.equal(readableInk("#0000bb"), LIGHT_INK);
});

test("the bar is centred on the point it is placed at", () => {
  const swatches = paletteSwatches(["#111111", "#222222", "#333333"], { x: 500, y: 200 }, "g");
  const left = Math.min(...swatches.map((swatch) => swatch.x));
  const right = Math.max(...swatches.map((swatch) => swatch.x + swatch.width));

  assert.equal((left + right) / 2, 500);
  assert.equal(swatches[0]!.y + SWATCH_HEIGHT / 2, 200);
});

test("the chips sit side by side in palette order, each one labelled with its hex", () => {
  const colors = ["#c8a165", "#1b2a3c", "#f4f1ea"];
  const swatches = paletteSwatches(colors, AT, "group-1");

  assert.equal(swatches.length, colors.length);
  swatches.forEach((swatch, index) => {
    assert.equal(swatch.backgroundColor, colors[index]);
    assert.equal(swatch.label.text, colors[index]!.toUpperCase());
    assert.equal(swatch.width, SWATCH_WIDTH);
    if (index === 0) return;
    assert.equal(swatch.x, swatches[index - 1]!.x + SWATCH_WIDTH + SWATCH_GAP);
    assert.equal(swatch.y, swatches[index - 1]!.y);
  });
});

test("the whole bar is one group, so a palette moves as the one object it is", () => {
  const swatches = paletteSwatches(["#111111", "#222222"], AT, "group-1");
  assert.deepEqual(
    swatches.map((swatch) => swatch.groupIds),
    [["group-1"], ["group-1"]],
  );
});

test("a swatch is flat and unoutlined — it is a measurement, not a drawing", () => {
  const [swatch] = paletteSwatches(["#111111"], AT, "g");
  assert.equal(swatch!.roughness, 0);
  assert.equal(swatch!.fillStyle, "solid");
  assert.equal(swatch!.strokeColor, "transparent");
});

test("nothing to paint places nothing", () => {
  assert.deepEqual(paletteSwatches([], AT, "g"), []);
  assert.deepEqual(paletteSwatches(["not a colour"], AT, "g"), []);
});

test("the bar lands under the selection it was asked for, centred on it", () => {
  const at = paletteAnchor([100, 40, 500, 300]);
  assert.equal(at.x, 300);
  assert.equal(at.y - SWATCH_HEIGHT / 2, 300 + PALETTE_OFFSET);
});

test("swatches are ordinary elements the scene document keeps", () => {
  const swatches = paletteSwatches(["#c8a165", "#1b2a3c"], AT, "g").map((swatch, index) => ({
    ...swatch,
    id: `swatch-${index}`,
  }));

  const kept = persistableElements(swatches);
  assert.equal(kept.length, 2);
  assert.deepEqual(
    kept.map((element) => element.backgroundColor),
    ["#c8a165", "#1b2a3c"],
  );
});
