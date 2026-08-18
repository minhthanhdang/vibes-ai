import { test } from "node:test";
import assert from "node:assert/strict";

const {
  needsDerivedCopy,
  derivationDecidesPlacement,
  derivedWrite,
  filedReferencesOwedCopies,
} = await import("@/lib/intake/reference-derived");
const { THUMBNAIL_MAX_EDGE, thumbnailBox } = await import("@/lib/intake/thumbnail");
const { boardImageVariant } = await import("@/lib/scene/moodboard-resolution");
const { DROPPED_IMAGE_MAX_EDGE } = await import("@/lib/canvas/moodboard-drop");

const big = { width: 4000, height: 3000 };

test("a reference with a thumbnail owes nothing", () => {
  assert.equal(needsDerivedCopy({ ...big, hasThumbnail: true }), false);
  /// Even one whose size was never recorded: the thumbnail is the expensive
  /// half, and re-reading megabytes to learn a width is not worth it.
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
  /// `thumbUrl` and the board's `variant=thumb` both fall back to the original
  /// for these, which is the right answer rather than a gap.
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
  /// The size is known, so the placement is right and the thumbnail can land
  /// behind it.
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
  /// Two tabs reading the same row back at once: the loser's object is in the
  /// bucket with nothing pointing at it.
  assert.deepEqual(derivedWrite({ hasThumbnail: true }, { thumbGcsUri: "gs://b/t.jpg" }), {
    update: {},
    discard: "gs://b/t.jpg",
  });
});

test("a size is written as a pair or not at all", () => {
  assert.deepEqual(derivedWrite({}, { width: 4000 }), { update: {}, discard: null });
  /// A stored half-size is not a size, so the pair still lands.
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
  /// The whole point of the derivation. A photo dropped at board size asks for
  /// the thumbnail, and until the row has one that request is answered with the
  /// original — so `needsDerivedCopy` is exactly the set of references whose
  /// board images are still streaming full-resolution photographs.
  const dropped = { width: DROPPED_IMAGE_MAX_EDGE, height: DROPPED_IMAGE_MAX_EDGE * 0.75 };
  assert.equal(boardImageVariant(dropped), "thumb");
  assert.equal(needsDerivedCopy({ ...big, hasThumbnail: false }), true);
  assert.equal(needsDerivedCopy({ ...big, hasThumbnail: true }), false);
});

test("a picture a turn filed is read back only when it owes a copy", () => {
  const rows = [
    { id: "drawn", ...big, hasThumbnail: false },
    { id: "uploaded", ...big, hasThumbnail: true },
    { id: "shown", ...big, hasThumbnail: false },
  ];
  assert.deepEqual(
    filedReferencesOwedCopies(["drawn", "uploaded"], rows).map((row) => row.id),
    ["drawn"],
  );
});

test("a turn that filed nothing, and a list that has not arrived, ask for nothing", () => {
  const rows = [{ id: "drawn", ...big, hasThumbnail: false }];
  assert.deepEqual(filedReferencesOwedCopies([], rows), []);
  assert.deepEqual(filedReferencesOwedCopies(["drawn"], undefined), []);
  /// The id of a row the list does not hold — a picture discarded in the same
  /// turn that made it — names nothing to read back.
  assert.deepEqual(filedReferencesOwedCopies(["gone"], rows), []);
});
