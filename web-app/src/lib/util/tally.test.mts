import { test } from "node:test";
import assert from "node:assert/strict";

import { finiteInt, mostFirst } from "./tally";

test("the biggest count leads", () => {
  const rows = [
    { name: "b", runs: 1 },
    { name: "a", runs: 9 },
  ];
  assert.deepEqual(
    [...rows].sort(mostFirst((row) => row.runs, (row) => row.name)).map((row) => row.name),
    ["a", "b"],
  );
});

test("equal counts come back in name order, every time", () => {
  const rows = [
    { name: "zeta", runs: 3 },
    { name: "alpha", runs: 3 },
    { name: "mid", runs: 3 },
  ];
  assert.deepEqual(
    [...rows].sort(mostFirst((row) => row.runs, (row) => row.name)).map((row) => row.name),
    ["alpha", "mid", "zeta"],
  );
});

test("a whole count comes back rounded", () => {
  assert.equal(finiteInt(3), 3);
  assert.equal(finiteInt(3.6), 4);
  assert.equal(finiteInt(0), 0);
});

test("anything that is not a count at all is null", () => {
  for (const nothing of [null, undefined, "4", NaN, Infinity, -1, {}]) {
    assert.equal(finiteInt(nothing), null, `${String(nothing)} read as a count`);
  }
});

test("zero is a count and not an absence", () => {
  assert.equal(finiteInt(0), 0);
  assert.equal(finiteInt(0) ?? 0, 0);
  assert.equal(finiteInt(-0.4) ?? 0, 0);
});

test("the floor is the rule, and it is nameable", () => {
  assert.equal(finiteInt(-5, { min: -10 }), -5);
  assert.equal(finiteInt(-5), null);
});
