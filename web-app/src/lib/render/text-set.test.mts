import { test } from "node:test";
import assert from "node:assert/strict";

import { setWidth, wrapToWidth } from "@/lib/render/text-set";

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
