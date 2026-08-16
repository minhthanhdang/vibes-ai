import { test } from "node:test";
import assert from "node:assert/strict";

import { inGalleryOrder, neighborId, withFavorite } from "./gallery";

const GALLERY = [{ id: "a" }, { id: "b" }, { id: "c" }];

const at = (day: number) => new Date(Date.UTC(2026, 0, day));
const UNSORTED = [
  { id: "old-plain", isFavorite: false, createdAt: at(1) },
  { id: "new-fav", isFavorite: true, createdAt: at(4) },
  { id: "new-plain", isFavorite: false, createdAt: at(3) },
  { id: "old-fav", isFavorite: true, createdAt: at(2) },
];
const ids = (references: { id: string }[]) => references.map((reference) => reference.id);

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

test("orders favorites first, newest first within each group", () => {
  assert.deepEqual(ids(inGalleryOrder(UNSORTED)), ["new-fav", "old-fav", "new-plain", "old-plain"]);
});

/// superjson revives createdAt as a Date, but a hand-hydrated cache entry can
/// carry the wire string — both have to sort the same way.
test("orders serialized dates the same as Date instances", () => {
  const serialized = UNSORTED.map((reference) => ({
    ...reference,
    createdAt: reference.createdAt.toISOString(),
  }));
  assert.deepEqual(ids(inGalleryOrder(serialized)), ids(inGalleryOrder(UNSORTED)));
});

test("leaves the caller's array untouched", () => {
  const before = ids(UNSORTED);
  inGalleryOrder(UNSORTED);
  assert.deepEqual(ids(UNSORTED), before);
});

test("favoriting moves a reference above every non-favorite", () => {
  const promoted = withFavorite(UNSORTED, "old-plain", true);
  assert.deepEqual(ids(promoted), ["new-fav", "old-fav", "old-plain", "new-plain"]);
  assert.equal(promoted.find((reference) => reference.id === "old-plain")?.isFavorite, true);
});

test("unfavoriting drops a reference back into date order", () => {
  assert.deepEqual(ids(withFavorite(UNSORTED, "new-fav", false)), [
    "old-fav",
    "new-fav",
    "new-plain",
    "old-plain",
  ]);
});

test("favoriting an unknown id reorders nothing", () => {
  assert.deepEqual(ids(withFavorite(UNSORTED, "gone", true)), ids(inGalleryOrder(UNSORTED)));
});
