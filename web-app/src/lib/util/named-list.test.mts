import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizedTitle, withTitle } from "./named-list";

test("a rename is one line, cut to the limit rather than refused", () => {
  assert.equal(normalizedTitle("  two   words  ", 60), "two words");
  assert.equal(normalizedTitle("x".repeat(300), 200), "x".repeat(200));
});

test("an empty edit is a cancelled rename rather than a row with no name", () => {
  assert.equal(normalizedTitle("", 60), null);
  assert.equal(normalizedTitle("   \n ", 60), null);
});

test("a cut that lands on a space does not keep it", () => {
  assert.equal(normalizedTitle("ab cd", 3), "ab");
});

test("only the renamed row changes, and the rest keep their identity", () => {
  const rows = [
    { id: "a", title: "first" },
    { id: "b", title: "second" },
  ];
  const next = withTitle(rows, "b", "renamed");
  assert.deepEqual(next.map((row) => row.title), ["first", "renamed"]);
  assert.equal(next[0], rows[0]);
  assert.notEqual(next[1], rows[1]);
});

test("an id the list does not hold changes nothing", () => {
  const rows = [{ id: "a", title: "first" }];
  assert.deepEqual(withTitle(rows, "gone", "renamed"), rows);
});

test("fields beside the title ride through untouched", () => {
  const rows = [{ id: "a", title: "first", pages: 3 }];
  assert.deepEqual(withTitle(rows, "a", "renamed"), [{ id: "a", title: "renamed", pages: 3 }]);
});
