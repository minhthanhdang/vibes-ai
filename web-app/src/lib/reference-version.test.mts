import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CROP_BOX_SCALE,
  CROP_MIN_SIDE,
  EDIT_INTENT_LIMIT,
  cropBoxColumns,
  cropBoxOf,
  cropBoxOfRegion,
  cropPlan,
  cropRegionOfBox,
  editIntent,
  versionCountIndex,
  versionCountLabel,
  versionCredit,
  versionLabel,
} from "./reference-version";
import { croppedPixels } from "./moodboard-crop";

/// Gemini's ordering, spelled out once: y before x, mins before maxes.
const box = (ymin: number, xmin: number, ymax: number, xmax: number) => [ymin, xmin, ymax, xmax];

test("a box is read in Gemini's order, y before x", () => {
  assert.deepEqual(cropBoxOf(box(100, 250, 600, 750)), {
    ymin: 100,
    xmin: 250,
    ymax: 600,
    xmax: 750,
  });
});

test("a box survives the row it is stored in", () => {
  const read = cropBoxOf(box(100, 250, 600, 750))!;
  assert.deepEqual(cropBoxOf(cropBoxColumns(read)), read);
});

test("corners written the other way round name the same rectangle", () => {
  /// A swapped pair is the model writing the corners in the other order, not a
  /// different region — refusing it would throw away a usable crop.
  assert.deepEqual(cropBoxOf(box(600, 750, 100, 250)), cropBoxOf(box(100, 250, 600, 750)));
});

test("a box that overruns the frame is clamped into it, not refused", () => {
  /// A few units past the edge is the model rounding. The frame is the limit of
  /// what can be cut either way.
  assert.deepEqual(cropBoxOf(box(-20, 0, 1004, 1000)), {
    ymin: 0,
    xmin: 0,
    ymax: CROP_BOX_SCALE,
    xmax: CROP_BOX_SCALE,
  });
});

test("what is not a rectangle at all is no box", () => {
  for (const value of [
    null,
    undefined,
    {},
    "0,0,500,500",
    box(0, 0, 500, 500).slice(0, 3),
    [...box(0, 0, 500, 500), 500],
    [0, 0, "500", 500],
    [0, 0, Number.NaN, 500],
    /// Entirely outside the frame: there is nothing left of it to clamp to.
    box(1000, 0, 1400, 500),
    box(-400, 0, 0, 500),
  ]) {
    assert.equal(cropBoxOf(value), null, `${JSON.stringify(value)} should read as no box`);
  }
});

test("a box crosses as fractions of the frame, so it cuts the same region out of any copy", () => {
  const region = cropRegionOfBox(cropBoxOf(box(250, 250, 750, 750))!)!;
  assert.deepEqual(region, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });

  /// The point of the fractions: the same answer against the original and
  /// against the 640px copy the board happened to load.
  assert.deepEqual(croppedPixels(region, { width: 5568, height: 3712 }), {
    x: 1392,
    y: 928,
    width: 2784,
    height: 1856,
  });
  assert.deepEqual(croppedPixels(region, { width: 640, height: 427 }), {
    x: 160,
    y: 107,
    width: 320,
    height: 214,
  });
});

test("a box that trims nothing is not a crop", () => {
  /// It is the photograph the project already holds; cutting it would buy a
  /// second copy of it and file that as a version.
  assert.equal(cropRegionOfBox(cropBoxOf(box(0, 0, 1000, 1000))!), null);
  assert.equal(cropRegionOfBox(cropBoxOf(box(1, 2, 999, 998))!), null);
});

test("trimming one edge is a crop, even when the other is untouched", () => {
  const region = cropRegionOfBox(cropBoxOf(box(0, 200, 1000, 800))!);
  assert.deepEqual(region, { x: 0.2, y: 0, width: 0.6, height: 1 });
});

test("a sliver is a misread, not a shot", () => {
  const sliver = Math.round(CROP_MIN_SIDE * CROP_BOX_SCALE) - 1;
  assert.equal(cropRegionOfBox(cropBoxOf(box(500, 500, 500 + sliver, 900))!), null);
  assert.equal(cropRegionOfBox(cropBoxOf(box(500, 500, 900, 500 + sliver))!), null);
  /// A collapsed box is the same answer by the same rule.
  assert.equal(cropRegionOfBox(cropBoxOf(box(500, 500, 500, 900))!), null);
});

test("a tight close on one face is still a crop", () => {
  const region = cropRegionOfBox(cropBoxOf(box(120, 430, 260, 520))!);
  assert.deepEqual(region, { x: 0.43, y: 0.12, width: 0.09, height: 0.14 });
});

test("an intent is a label, so it is one line and bounded", () => {
  assert.equal(editIntent("  the hands\non the wheel,\tnothing else  "), "the hands on the wheel, nothing else");
  assert.equal(editIntent("x".repeat(EDIT_INTENT_LIMIT + 40)).length, EDIT_INTENT_LIMIT);
  assert.equal(editIntent("   "), "");
});

test("a plan is the cut, the name it is filed under, and the box it came from", () => {
  const plan = cropPlan({
    box: cropBoxOf(box(120, 430, 260, 520))!,
    intent: "  just the\thands  ",
    sourceTitle: "Hallway, night",
  });

  assert.deepEqual(plan, {
    region: { x: 0.43, y: 0.12, width: 0.09, height: 0.14 },
    /// Named after the photograph, exactly as a crop kept off the board is: the
    /// director looks for the frame, not for the agent that cut it.
    title: "Hallway, night (crop)",
    editIntent: "just the hands",
    cropBox: [120, 430, 260, 520],
  });
});

test("cropping a crop counts up rather than stacking suffixes", () => {
  const plan = cropPlan({
    box: cropBoxOf(box(0, 200, 1000, 800))!,
    intent: "the sign",
    sourceTitle: "Hallway, night (crop)",
  });
  assert.equal(plan?.title, "Hallway, night (crop 2)");
});

test("there is no plan when the frame is already the shot", () => {
  /// Same judgement as `cropRegionOfBox`, carried one step further: nothing to
  /// cut means no version to make, not a version of nothing.
  assert.equal(
    cropPlan({ box: cropBoxOf(box(0, 0, 1000, 1000))!, intent: "all of it", sourceTitle: "Wide" }),
    null,
  );
  assert.equal(
    cropPlan({ box: cropBoxOf(box(500, 500, 505, 900))!, intent: "a sliver", sourceTitle: "Wide" }),
    null,
  );
});

test("a version with no intent is still a version", () => {
  /// The cropper falls back to the director's own words, but a row filed with
  /// neither is a crop of a frame that simply says nothing about why.
  const plan = cropPlan({ box: cropBoxOf(box(0, 200, 1000, 800))!, intent: "", sourceTitle: "Wide" });
  assert.equal(plan?.editIntent, "");
});

test("a version is listed by what it was asked for, not by its title", () => {
  /// Every cut of one frame is "<the frame> (crop N)", so the titles are the
  /// column that does not distinguish them.
  assert.equal(
    versionLabel({ editIntent: "just the hands", title: "Hallway, night (crop 2)" }),
    "just the hands",
  );
});

test("a version with nothing to say falls back to its title, then to a word", () => {
  assert.equal(versionLabel({ editIntent: "", title: "Hallway, night (crop)" }), "Hallway, night (crop)");
  assert.equal(versionLabel({ editIntent: null, title: null }), "Crop");
  assert.equal(versionLabel({ editIntent: "   ", title: "  " }), "Crop");
});

test("a listed intent is one line however it was written", () => {
  assert.equal(versionLabel({ editIntent: " just\n the  hands ", title: "" }), "just the hands");
});

test("a photograph has nothing to credit", () => {
  /// A reference the director brought in came from outside the app: there is no
  /// frame it is a piece of, so the board says nothing rather than "cropped".
  assert.equal(versionCredit({ editIntent: "", source: null }), null);
  /// And a read that never asked for the frame credits nothing rather than
  /// guessing from the "(crop N)" in a title.
  assert.equal(versionCredit({}), null);
});

test("a cut is credited to the frame first and to the asking second", () => {
  /// On a board the cut is among photographs with nothing beside it, so which
  /// photograph it is a piece of is the thing to say — the reverse of the
  /// versions list, where the frame is the thing already on screen.
  assert.equal(
    versionCredit({ editIntent: "just the hands", source: { title: "Hallway, night" } }),
    "Cropped from “Hallway, night” — just the hands",
  );
});

test("a cut nobody said anything about is still credited to its frame", () => {
  assert.equal(
    versionCredit({ editIntent: "", source: { title: "Hallway, night" } }),
    "Cropped from “Hallway, night”",
  );
  assert.equal(
    versionCredit({ editIntent: "  ", source: { title: "Hallway, night" } }),
    "Cropped from “Hallway, night”",
  );
});

test("a frame with no title is still the frame this was cut from", () => {
  assert.equal(
    versionCredit({ editIntent: "the sign", source: { title: "   " } }),
    "Cropped from the original — the sign",
  );
  assert.equal(versionCredit({ source: { title: null } }), "Cropped from the original");
});

test("a credited intent is one line however it was written", () => {
  assert.equal(
    versionCredit({ editIntent: " just\n the  hands ", source: { title: "Wide" } }),
    "Cropped from “Wide” — just the hands",
  );
});

test("a region the director drew crosses into the model's own numbers", () => {
  assert.deepEqual(cropBoxOfRegion({ x: 0.25, y: 0.1, width: 0.5, height: 0.5 }), {
    ymin: 100,
    xmin: 250,
    ymax: 600,
    xmax: 750,
  });
});

test("a hand-drawn box and the agent's box are the same rectangle", () => {
  /// Both crop paths file the same row shape, so a box out of a region has to
  /// read back through the same door the model's box comes in.
  const drawn = cropBoxOfRegion({ x: 0.25, y: 0.1, width: 0.5, height: 0.5 })!;
  assert.deepEqual(cropBoxOf(cropBoxColumns(drawn)), drawn);
  assert.deepEqual(cropRegionOfBox(drawn), { x: 0.25, y: 0.1, width: 0.5, height: 0.5 });
});

test("a sliver the director drew is kept, where a model's would be a misread", () => {
  /// `CROP_MIN_SIDE` judges an answer nobody looked at. A director dragging a
  /// thin band drew the band they wanted.
  const sliver = cropBoxOfRegion({ x: 0.5, y: 0, width: 0.001, height: 1 })!;
  assert.equal(sliver.xmax - sliver.xmin, 1);
  assert.equal(cropRegionOfBox(sliver), null);
});

test("a region is refused only when it is not a rectangle", () => {
  assert.equal(cropBoxOfRegion({ x: 0, y: 0, width: 0, height: 0.5 }), null);
  assert.equal(cropBoxOfRegion({ x: 0, y: 0, width: -0.5, height: 0.5 }), null);
  assert.equal(cropBoxOfRegion({ x: Number.NaN, y: 0, width: 0.5, height: 0.5 }), null);
});

test("a region running to the frame's edge stays inside it", () => {
  assert.deepEqual(cropBoxOfRegion({ x: 0.5, y: 0.5, width: 0.6, height: 0.6 }), {
    ymin: 500,
    xmin: 500,
    ymax: CROP_BOX_SCALE,
    xmax: CROP_BOX_SCALE,
  });
});

test("a frame that was never cropped says nothing about its cuts", () => {
  /// Most photos of a project have never been cropped: a zero on every tile
  /// hides the tiles carrying a one.
  assert.equal(versionCountLabel(0), null);
  assert.equal(versionCountLabel(undefined), null);
  assert.equal(versionCountLabel(Number.NaN), null);
  assert.equal(versionCountLabel(-1), null);
});

test("a frame says how many cuts of it there are", () => {
  assert.equal(versionCountLabel(1), "1 crop");
  assert.equal(versionCountLabel(4), "4 crops");
});

test("the counts of a project are read by frame", () => {
  const index = versionCountIndex([
    { referenceId: "hallway", count: 2 },
    { referenceId: "wide", count: 1 },
  ]);
  assert.equal(index.get("hallway"), 2);
  assert.equal(index.get("wide"), 1);
  /// A frame the read never mentioned has no cuts — the query only returns the
  /// frames something was cut from.
  assert.equal(index.get("street"), undefined);
});

test("a frame counted at nothing is a frame with no cuts", () => {
  /// The gallery list and this read are two queries, and a count that arrived
  /// as zero must not turn into a badge saying so.
  assert.equal(versionCountIndex([{ referenceId: "hallway", count: 0 }]).has("hallway"), false);
});
