import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SET, SET_EXCALIFONT, SET_LIBERATION } from "@/lib/render/font-set";
import {
  blockHeight,
  flooredType,
  setsToItsBox,
  setWidth,
  wrapToWidth,
} from "@/lib/render/text-set";
import { FONT_FAMILIES } from "@/lib/canvas-objects/object-style";
import { renderFont } from "@/lib/render/render-plan";
import { LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";

test("a string sets by its glyphs, not by its length — capitals wider, spaces narrower", () => {
  assert.ok(setWidth("ABCD", 10) > setWidth("abcd", 10), "capitals set wider than lowercase");
  assert.ok(setWidth("mmmm", 10) > setWidth("ABCD", 10), "and the widest glyphs wider still");
  assert.ok(setWidth("illi", 10) < setWidth("abcd", 10), "the narrow glyphs set narrower");
  assert.ok(setWidth("a a", 10) < setWidth("aaa", 10), "a space is narrower than a letter");
  assert.equal(setWidth("Hello there", 40), setWidth("Hello there", 20) * 2);
});

test("words that fit the width are left as one line", () => {
  const words = "Roasted to order";
  assert.deepEqual(wrapToWidth(words, setWidth(words, 20) + 1, 20), [words]);
});

test("a paragraph is broken at spaces, and every line fits the width it was given", () => {
  const copy =
    "Each lot is test-profiled in three-kilo micro-batches to isolate origin character before it is released to the counter.";
  const lines = wrapToWidth(copy, 475, 14);

  assert.ok(lines.length > 1, "a sentence in a card-wide box is more than one line");
  for (const line of lines) assert.ok(setWidth(line, 14) <= 475, `over the width: ${line}`);
  assert.equal(lines.join(" "), copy);
});

test("a word wider than the whole box keeps its own line rather than being cut", () => {
  const lines = wrapToWidth("see lanterncoffee.com/subscriptions now", 60, 20);

  assert.deepEqual(lines, ["see", "lanterncoffee.com/subscriptions", "now"]);
});

test("nothing to set is no lines, and a box with no width is one", () => {
  assert.deepEqual(wrapToWidth("   ", 400, 20), []);
  assert.deepEqual(wrapToWidth("a b c", 0, 20), ["a b c"]);
  assert.deepEqual(wrapToWidth("a b c", 400, 0), ["a b c"]);
});

test("a newline in the words is a break that survives the wrap", () => {
  assert.deepEqual(wrapToWidth("ACT ONE\nACT TWO", 4000, 20), ["ACT ONE", "ACT TWO"]);
  const lines = wrapToWidth("Winter menu\nRoasted to order every morning of the week", 200, 20);
  assert.equal(lines[0], "Winter menu");
  assert.ok(lines.length > 2, "the second run is wider than the box and breaks");
  for (const line of lines) assert.ok(setWidth(line, 20) <= 200, `over the width: ${line}`);
});

test("a run with nothing in it is not a line of its own", () => {
  assert.deepEqual(wrapToWidth("one\n\ntwo", 400, 20), ["one", "two"]);
});

test("a block sets to its box only when it is pinned to one", () => {
  assert.equal(setsToItsBox({ autoResize: false, width: 400 }), true);
  assert.equal(setsToItsBox({ autoResize: true, width: 400 }), false);
  assert.equal(setsToItsBox({ width: 400 }), false, "no field is excalidraw's own default: auto");
  assert.equal(setsToItsBox({ autoResize: false, width: 0 }), false, "no width is no box");
  assert.equal(setsToItsBox({ autoResize: false }), false);
});

test("a block stands to its lines, and never to less than one", () => {
  assert.equal(blockHeight(3, 20), Math.round(3 * 20 * TEXT_LINE_HEIGHT));
  assert.equal(blockHeight(0, 20), Math.round(20 * TEXT_LINE_HEIGHT));
});

test("type above the floor is left entirely alone", () => {
  assert.equal(
    flooredType({ type: "text", autoResize: false, width: 400, text: "Winter" }, {
      width: 200,
      fontSize: LAYOUT_TEXT_MIN_FONT,
    }),
    null,
  );
  assert.equal(flooredType({ type: "text" }, { width: 200 }), null, "no size asked is no floor");
  assert.equal(
    flooredType({ type: "image", width: 400 }, { width: 20, fontSize: 2 }),
    null,
    "a photograph has no type to floor",
  );
});

test("a block pinned to a box takes the floor and breaks again to the narrower box", () => {
  const floored = flooredType(
    {
      type: "text",
      autoResize: false,
      width: 600,
      originalText: "Roasted to order every morning of the week",
      text: "Roasted to order every morning of the week",
    },
    { width: 120, fontSize: 3 },
  )!;

  assert.equal(floored.fontSize, LAYOUT_TEXT_MIN_FONT);
  const lines = floored.text!.split("\n");
  assert.ok(lines.length > 1, "the words no longer fit one line of the narrower box");
  for (const line of lines) assert.ok(setWidth(line, LAYOUT_TEXT_MIN_FONT) <= 120);
  assert.equal(floored.height, blockHeight(lines.length, LAYOUT_TEXT_MIN_FONT));
});

test("a block with no box of its own takes the floor without new breaks", () => {
  const selfSizing = flooredType(
    { type: "text", autoResize: true, width: 600, text: "ACT ONE\nACT TWO" },
    { width: 120, fontSize: 3 },
  )!;
  assert.equal(selfSizing.fontSize, LAYOUT_TEXT_MIN_FONT);
  assert.equal(selfSizing.text, undefined);
  assert.equal(selfSizing.height, blockHeight(2, LAYOUT_TEXT_MIN_FONT));

  const label = flooredType(
    { type: "text", autoResize: false, width: 600, containerId: "plate", text: "#2C3234" },
    { width: 30, fontSize: 1 },
  )!;
  assert.equal(label.fontSize, LAYOUT_TEXT_MIN_FONT);
  assert.equal(label.text, undefined);
});

test("the face nothing names is the face the renderer draws — not the one the table used to assume", () => {
  assert.deepEqual(DEFAULT_SET, renderFont(undefined).set);
  assert.deepEqual(DEFAULT_SET, SET_EXCALIFONT);
  assert.notDeepEqual(SET_EXCALIFONT, SET_LIBERATION);
});

test("a monospace sets wider than a sans on prose, not narrower", () => {
  const words = "made by hand in small batches";
  const mono = setWidth(words, 20, renderFont(FONT_FAMILIES.mono).set);
  const sans = setWidth(words, 20, renderFont(FONT_FAMILIES.sans).set);
  assert.ok(mono > sans * 1.1, `${mono} is not comfortably over ${sans}`);
  assert.ok(
    setWidth("SPRING 2026", 20, renderFont(FONT_FAMILIES.mono).set) <
      setWidth("SPRING 2026", 20, renderFont(FONT_FAMILIES.sans).set),
  );
});

test("one advance for every class is what a monospace is", () => {
  const mono = renderFont(FONT_FAMILIES.mono).set;
  assert.equal(new Set(Object.values(mono)).size, 1);
  assert.equal(setWidth("WWWWW", 10, mono), setWidth("iiiii", 10, mono));
});

test("the same words in the same box break in different places in different faces", () => {
  const words = "Warm linen, soft clay, and the light of a slow morning";
  const box = setWidth(words, 24, renderFont(FONT_FAMILIES.sans).set) / 2;
  const lines = (name: keyof typeof FONT_FAMILIES) =>
    wrapToWidth(words, box, 24, renderFont(FONT_FAMILIES[name]).set);

  for (const name of ["hand", "sans", "mono", "display"] as const) {
    for (const line of lines(name)) {
      assert.ok(
        setWidth(line, 24, renderFont(FONT_FAMILIES[name]).set) <= box,
        `${name}: ${line}`,
      );
    }
  }
  assert.ok(lines("mono").length > lines("display").length);
});

test("a block floored under the readable size re-breaks in its own face", () => {
  const block = {
    type: "text",
    autoResize: false,
    width: 200,
    text: "Made by hand in small batches",
    originalText: "Made by hand in small batches",
  };
  const placement = { width: 200, fontSize: 4 };

  const mono = flooredType(block, placement, renderFont(FONT_FAMILIES.mono).set)!;
  const display = flooredType(block, placement, renderFont(FONT_FAMILIES.display).set)!;
  assert.equal(mono.fontSize, LAYOUT_TEXT_MIN_FONT);
  assert.ok(
    (mono.text ?? "").split("\n").length > (display.text ?? "").split("\n").length,
    `${mono.text} against ${display.text}`,
  );
  assert.ok(mono.height > display.height);
});
