import { test } from "node:test";
import assert from "node:assert/strict";

import { clampWords, clipped, collapsed, lineKey } from "./text";

test("a run of any blank space is one space, and the ends are trimmed", () => {
  assert.equal(collapsed("  two   words \n and\ta third  "), "two words and a third");
  assert.equal(collapsed(""), "");
  assert.equal(collapsed("   "), "");
});

test("a line matches past a retyped capital and a doubled space", () => {
  assert.equal(lineKey("Ridge  at Dusk"), lineKey("ridge at dusk"));
  assert.equal(lineKey(" A LINE\n"), "a line");
});

test("a clipped string is never longer than the limit", () => {
  for (const limit of [4, 10, 60]) {
    assert.ok(clipped("x".repeat(200), limit).length <= limit, `limit ${limit} overflowed`);
  }
});

test("a string inside the limit is returned as it stands", () => {
  assert.equal(clipped("short", 60), "short");
  assert.equal(clipped("x".repeat(60), 60), "x".repeat(60));
});

test("a clip never ends on the space it exposed", () => {
  assert.equal(clipped("one two three", 9), "one two…");
});

test("clampWords stops at a word and says that it cut", () => {
  assert.deepEqual(clampWords("one two three", 9), { text: "one two", truncated: true });
  assert.deepEqual(clampWords("one two", 9), { text: "one two", truncated: false });
});

test("a first word longer than the limit is cut inside it rather than left whole", () => {
  assert.deepEqual(clampWords("supercalifragilistic", 8), { text: "supercal", truncated: true });
});
