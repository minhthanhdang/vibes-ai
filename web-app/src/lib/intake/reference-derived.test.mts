import { test } from "node:test";
import assert from "node:assert/strict";

const {
  needsDerivedCopy,
  derivationDecidesPlacement,
  derivedWrite,
  referencesOwedCopies,
} = await import("@/lib/intake/reference-derived");
const { THUMBNAIL_MAX_EDGE, thumbnailBox } = await import("@/lib/intake/thumbnail");
const { boardImageVariant } = await import("@/lib/scene/moodboard-resolution");
const { DROPPED_IMAGE_MAX_EDGE } = await import("@/lib/canvas/moodboard-drop");

const big = { width: 4000, height: 3000 };

test("a reference with a thumbnail owes nothing", () => {
  assert.equal(needsDerivedCopy({ ...big, hasThumbnail: true }), false);
  assert.equal(needsDerivedCopy({ hasThumbnail: true }), false);
});

test("a web-imported reference — no thumbnail, no size — is worth reading back", () => {
  assert.equal(needsDerivedCopy({ hasThumbnail: false }), true);
  assert.equal(needsDerivedCopy({ width: null, height: null }), true);
});

test("a large original with no thumbnail is worth reading back", () => {
  assert.equal(needsDerivedCopy({ ...big, hasThumbnail: false }), true);
});

test("an original already inside the thumbnail box is not missing one", () => {
  const small = { width: THUMBNAIL_MAX_EDGE, height: THUMBNAIL_MAX_EDGE / 2 };
  assert.equal(thumbnailBox(small.width, small.height).isNeeded, false);
  assert.equal(needsDerivedCopy({ ...small, hasThumbnail: false }), false);
  assert.equal(needsDerivedCopy({ width: THUMBNAIL_MAX_EDGE + 1, height: 10 }), true);
});

test("a half-recorded or nonsense size reads as no size", () => {
  assert.equal(needsDerivedCopy({ width: 4000 }), true);
  assert.equal(needsDerivedCopy({ width: 0, height: 0 }), true);
  assert.equal(needsDerivedCopy({ width: Number.NaN, height: 100 }), true);
});

test("only a missing size makes the derivation decide where the photo lands", () => {
  assert.equal(derivationDecidesPlacement({ hasThumbnail: false }), true);
  assert.equal(derivationDecidesPlacement({ ...big, hasThumbnail: false }), false);
  assert.equal(derivationDecidesPlacement({ hasThumbnail: true }), false);
});

test("the write fills in what is absent", () => {
  assert.deepEqual(derivedWrite({}, { width: 4000, height: 3000, thumbGcsUri: "gs://b/t.jpg" }), {
    update: { width: 4000, height: 3000, thumbGcsUri: "gs://b/t.jpg" },
    discard: null,
  });
});

test("the write never overwrites a stored size", () => {
  const stored = { width: 100, height: 50 };
  assert.deepEqual(derivedWrite(stored, { width: 4000, height: 3000 }), {
    update: {},
    discard: null,
  });
});

test("a thumbnail offered to a row that already has one is thrown away, not written", () => {
  assert.deepEqual(derivedWrite({ hasThumbnail: true }, { thumbGcsUri: "gs://b/t.jpg" }), {
    update: {},
    discard: "gs://b/t.jpg",
  });
});

test("a size is written as a pair or not at all", () => {
  assert.deepEqual(derivedWrite({}, { width: 4000 }), { update: {}, discard: null });
  assert.deepEqual(derivedWrite({ width: 4000 }, { width: 4000, height: 3000 }).update, {
    width: 4000,
    height: 3000,
  });
});

test("nothing offered writes nothing", () => {
  assert.deepEqual(derivedWrite({ ...big, hasThumbnail: true }, {}), {
    update: {},
    discard: null,
  });
});

test("contract: a derived reference stops the board asking for the original", () => {
  const dropped = { width: DROPPED_IMAGE_MAX_EDGE, height: DROPPED_IMAGE_MAX_EDGE * 0.75 };
  assert.equal(boardImageVariant(dropped), "thumb");
  assert.equal(needsDerivedCopy({ ...big, hasThumbnail: false }), true);
  assert.equal(needsDerivedCopy({ ...big, hasThumbnail: true }), false);
});

test("only the pictures that owe a copy are read back", () => {
  const rows = [
    { id: "drawn", ...big, hasThumbnail: false },
    { id: "uploaded", ...big, hasThumbnail: true },
    { id: "imported", ...big, hasThumbnail: false },
  ];
  assert.deepEqual(
    referencesOwedCopies(rows, new Set()).map((row) => row.id),
    ["drawn", "imported"],
  );
});

test("a picture already tried is not read back again", () => {
  const rows = [
    { id: "drawn", ...big, hasThumbnail: false },
    { id: "imported", ...big, hasThumbnail: false },
  ];
  assert.deepEqual(
    referencesOwedCopies(rows, new Set(["drawn"])).map((row) => row.id),
    ["imported"],
  );
});

test("a project with nothing owing, and a list that has not arrived, ask for nothing", () => {
  const shown = [{ id: "uploaded", ...big, hasThumbnail: true }];
  assert.deepEqual(referencesOwedCopies(shown, new Set()), []);
  assert.deepEqual(referencesOwedCopies(undefined, new Set()), []);
  assert.deepEqual(referencesOwedCopies([], new Set()), []);
});
