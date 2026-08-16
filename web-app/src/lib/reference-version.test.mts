import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CROP_BOX_SCALE,
  CROP_MIN_SIDE,
  EDIT_INTENT_LIMIT,
  cropBoxColumns,
  cropBoxOf,
  cropPlan,
  cropRegionOfBox,
  editIntent,
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
