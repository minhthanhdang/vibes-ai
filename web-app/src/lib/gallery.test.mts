import { test } from "node:test";
import assert from "node:assert/strict";

import { neighborId } from "./gallery";

const GALLERY = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("steps forward and back in gallery order", () => {
  assert.equal(neighborId(GALLERY, "b", 1), "c");
  assert.equal(neighborId(GALLERY, "b", -1), "a");
});

test("wraps at both ends", () => {
  assert.equal(neighborId(GALLERY, "c", 1), "a");
  assert.equal(neighborId(GALLERY, "a", -1), "c");
});

/// Both cases close the viewer: nothing is left to show.
test("has no neighbour in a one-image gallery", () => {
  assert.equal(neighborId([{ id: "a" }], "a", 1), null);
});

test("has no neighbour for an id that is not in the gallery", () => {
  assert.equal(neighborId(GALLERY, "gone", 1), null);
  assert.equal(neighborId(GALLERY, null, 1), null);
});
