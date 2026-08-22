import { test } from "node:test";
import assert from "node:assert/strict";

import {
  blockHeight,
  flooredType,
  setsToItsBox,
  setWidth,
  wrapToWidth,
} from "@/lib/render/text-set";
import { LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";

test("a string sets by its glyphs, not by its length — capitals wider, spaces narrower", () => {
  assert.ok(setWidth("ABCD", 10) > setWidth("abcd", 10), "capitals set wider than lowercase");
  assert.ok(setWidth("mmmm", 10) > setWidth("ABCD", 10), "and the widest glyphs wider still");
  assert.ok(setWidth("illi", 10) < setWidth("abcd", 10), "the narrow glyphs set narrower");
  assert.ok(setWidth("a a", 10) < setWidth("aaa", 10), "a space is narrower than a letter");
  /// Twice the type size is twice the width: the measure is in ems.
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
  /// Nothing is lost and nothing is added: the words back in order.
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

/// A break somebody typed is a break they meant. The soft breaks a width put in
/// are taken out before a re-wrap (`object-restyle`, `typedWords`); these are
/// the ones that survive it.
test("a newline in the words is a break that survives the wrap", () => {
  assert.deepEqual(wrapToWidth("ACT ONE\nACT TWO", 4000, 20), ["ACT ONE", "ACT TWO"]);
  /// And each run is still broken to the width on its own.
  const lines = wrapToWidth("Winter menu\nRoasted to order every morning of the week", 200, 20);
  assert.equal(lines[0], "Winter menu");
  assert.ok(lines.length > 2, "the second run is wider than the box and breaks");
  for (const line of lines) assert.ok(setWidth(line, 20) <= 200, `over the width: ${line}`);
});

test("a run with nothing in it is not a line of its own", () => {
  assert.deepEqual(wrapToWidth("one\n\ntwo", 400, 20), ["one", "two"]);
});

/// The one field that separates a block whose width is a decision from one
/// whose width is a measurement of the string it already carries. Every text
/// element on the development database is pinned — 440 of 440 — because the
/// compose, the dropped line and the put all write it; a block a person types
/// into the editor is the other case.
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

/// The floor, and the two doors that take it. `transform_on_canvas` and the
/// board's tidy both scale a unit by one number, so a block's type follows its
/// box down until the box goes somewhere no type can follow.
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

/// A block that sizes itself has a width nobody chose and a bound label's box
/// belongs to the container that draws it — both take the floor, neither is
/// re-broken.
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
