import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_CROP_INTENT,
  BOARD_SOURCE_EDGE,
  CROP_ASPECT_IDS,
  CROP_BOX_SCALE,
  CROP_MIN_SIDE,
  EDIT_INTENT_LIMIT,
  EDIT_RATIONALE_LIMIT,
  cropAspectOf,
  cropAspectRatio,
  cropShapeAt,
  cropShapeMeasured,
  cropShapeOf,
  looseShapeOf,
  shapeAsked,
  cropBoxAtAspect,
  cropBoxColumns,
  cropBoxOf,
  cropBoxOfRegion,
  cropBoxOutline,
  cropCoverageLabel,
  cropPixelSize,
  cropRegionOfBox,
  cropSizeLabel,
  cropSoftOnBoard,
  editIntent,
  editRationale,
  priorCropNote,
  referenceCaption,
  refinedIntent,
  relabeledIntent,
  sameCut,
  versionCountIndex,
  versionCountLabel,
  versionDescendants,
  versionLabel,
  versionNote,
  versionOrigin,
} from "@/lib/references/reference-version";
import { ReferenceOrigin } from "@/generated/prisma/enums";
import { CAPTION_MAX_LENGTH, captionText } from "@/lib/canvas/moodboard-caption";
import { croppedPixels } from "@/lib/canvas/moodboard-crop";

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
  assert.deepEqual(cropBoxOf(box(600, 750, 100, 250)), cropBoxOf(box(100, 250, 600, 750)));
});

test("a box that overruns the frame is clamped into it, not refused", () => {
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
    box(1000, 0, 1400, 500),
    box(-400, 0, 0, 500),
  ]) {
    assert.equal(cropBoxOf(value), null, `${JSON.stringify(value)} should read as no box`);
  }
});

test("a box crosses as fractions of the frame, so it cuts the same region out of any copy", () => {
  const region = cropRegionOfBox(cropBoxOf(box(250, 250, 750, 750))!)!;
  assert.deepEqual(region, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });

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

test("a rationale is a sentence, so it is one line and bounded", () => {
  assert.equal(editRationale(" why\tthis  box\nis the box "), "why this box is the box");
  assert.equal(editRationale("x".repeat(EDIT_RATIONALE_LIMIT + 100)).length, EDIT_RATIONALE_LIMIT);
  assert.ok(EDIT_RATIONALE_LIMIT > EDIT_INTENT_LIMIT);
});

test("a version is listed by what it was asked for, not by its title", () => {
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

test("a cut says why it is where it is, under what it was asked for", () => {
  assert.equal(
    versionNote({
      editIntent: "the clock",
      editRationale: " No clock in this frame — this is the\nwall it would hang on. ",
    }),
    "No clock in this frame — this is the wall it would hang on.",
  );
});

test("a cut nobody reasoned about in words has no second line", () => {
  assert.equal(versionNote({ editIntent: "Cropped on the board" }), null);
  assert.equal(versionNote({ editIntent: "just the hands", editRationale: "   " }), null);
});

test("a rationale that repeats the label is not shown twice", () => {
  assert.equal(
    versionNote({ editIntent: "just the hands", editRationale: "Just the hands." }),
    null,
  );
  assert.equal(
    versionNote({ editIntent: "", title: "Hallway, night (crop)", editRationale: "hallway night (crop)" }),
    null,
  );
});

test("a photograph is captioned with the title the user gave it", () => {
  assert.equal(referenceCaption({ title: "Hallway, night", source: null }), "Hallway, night");
  assert.equal(referenceCaption({ title: "Hallway, night (crop 2)" }), "Hallway, night (crop 2)");
});

test("a cut is captioned with the frame and what it keeps, not with “(crop 2)”", () => {
  assert.equal(
    referenceCaption({
      title: "Hallway, night (crop 2)",
      editIntent: "just the hands",
      source: { title: "Hallway, night" },
    }),
    "Hallway, night — just the hands",
  );
});

test("a cut nobody described is captioned as the frame it is a piece of", () => {
  assert.equal(
    referenceCaption({
      title: "Hallway, night (crop)",
      editIntent: BOARD_CROP_INTENT,
      source: { title: "Hallway, night" },
    }),
    "Hallway, night",
  );
  assert.equal(
    referenceCaption({ title: "Hallway, night (crop)", source: { title: "Hallway, night" } }),
    "Hallway, night",
  );
  assert.equal(
    referenceCaption({ title: "Reference (crop)", editIntent: " ", source: { title: "  " } }),
    "Reference (crop)",
  );
});

test("a cut of an untitled frame is captioned by what it keeps", () => {
  assert.equal(
    referenceCaption({ title: "Reference (crop)", editIntent: "the sign", source: {} }),
    "the sign",
  );
  assert.equal(
    referenceCaption({
      title: "The sign (crop)",
      editIntent: "The sign.",
      source: { title: "The sign" },
    }),
    "The sign.",
  );
});

test("the frame gives way first when the caption will not fit", () => {
  const frame = "A very long title for a photograph nobody wanted to name twice";
  const shortened = referenceCaption({
    title: `${frame} (crop)`,
    editIntent: "just the hands",
    source: { title: frame },
  });
  assert.ok(shortened.length <= CAPTION_MAX_LENGTH, shortened);
  assert.ok(shortened.endsWith("… — just the hands"), shortened);
  assert.equal(captionText(shortened), shortened);

  const asked = "the hands on the rail, everything above the wrist cut away";
  assert.equal(
    referenceCaption({ title: `${frame} (crop)`, editIntent: asked, source: { title: frame } }),
    asked,
  );
});

test("a region the user drew crosses into the model's own numbers", () => {
  assert.deepEqual(cropBoxOfRegion({ x: 0.25, y: 0.1, width: 0.5, height: 0.5 }), {
    ymin: 100,
    xmin: 250,
    ymax: 600,
    xmax: 750,
  });
});

test("a hand-drawn box and the agent's box are the same rectangle", () => {
  const drawn = cropBoxOfRegion({ x: 0.25, y: 0.1, width: 0.5, height: 0.5 })!;
  assert.deepEqual(cropBoxOf(cropBoxColumns(drawn)), drawn);
  assert.deepEqual(cropRegionOfBox(drawn), { x: 0.25, y: 0.1, width: 0.5, height: 0.5 });
});

test("a sliver the user drew is kept, where a model's would be a misread", () => {
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
  assert.equal(versionCountLabel(0), null);
  assert.equal(versionCountLabel(undefined), null);
  assert.equal(versionCountLabel(Number.NaN), null);
  assert.equal(versionCountLabel(-1), null);
});

test("a frame says how many cuts of it there are", () => {
  assert.equal(versionCountLabel(1), "1 version");
  assert.equal(versionCountLabel(4), "4 versions");
});

test("the cuts of a project are counted by the frame they were cut from", () => {
  const index = versionCountIndex([
    { id: "hands", sourceReferenceId: "hallway" },
    { id: "door", sourceReferenceId: "hallway" },
    { id: "sign", sourceReferenceId: "wide" },
  ]);
  assert.equal(index.get("hallway"), 2);
  assert.equal(index.get("wide"), 1);
  assert.equal(index.get("street"), undefined);
});

test("a cut of a cut counts under the cut it was made from", () => {
  const index = versionCountIndex([
    { id: "hands", sourceReferenceId: "hallway" },
    { id: "knuckles", sourceReferenceId: "hands" },
  ]);
  assert.equal(index.get("hallway"), 1);
  assert.equal(index.get("hands"), 1);
});

test("deleting a frame takes every cut below it, however deep", () => {
  const links = [
    { id: "hands", sourceReferenceId: "hallway" },
    { id: "door", sourceReferenceId: "hallway" },
    { id: "knuckles", sourceReferenceId: "hands" },
    { id: "sign", sourceReferenceId: "wide" },
  ];
  assert.deepEqual(versionDescendants(links, "hallway").sort(), ["door", "hands", "knuckles"]);
  assert.deepEqual(versionDescendants(links, "hands"), ["knuckles"]);
  assert.deepEqual(versionDescendants(links, "street"), []);
});

test("a cut that names itself does not hang the walk", () => {
  const links = [
    { id: "hallway", sourceReferenceId: "hallway" },
    { id: "hands", sourceReferenceId: "hallway" },
    { id: "hallway-again", sourceReferenceId: "hands" },
  ];
  assert.deepEqual(versionDescendants(links, "hallway").sort(), ["hallway-again", "hands"]);
});

test("a cut is outlined where it sits in the frame", () => {
  assert.deepEqual(cropBoxOutline(box(250, 500, 750, 1000)), {
    left: 50,
    top: 25,
    width: 50,
    height: 50,
  });
});

test("a photograph is outlined nowhere", () => {
  assert.equal(cropBoxOutline([]), null);
  assert.equal(cropBoxOutline(undefined), null);
  assert.equal(cropBoxOutline([250, 500, 750]), null);
});

test("corners written the other way round outline the same rectangle", () => {
  assert.deepEqual(cropBoxOutline(box(750, 1000, 250, 500)), cropBoxOutline(box(250, 500, 750, 1000)));
});

test("a box that keeps no width is not a region of the frame", () => {
  assert.equal(cropBoxOutline(box(250, 500, 750, 500)), null);
  assert.equal(cropBoxOutline(box(250, 500, 250, 1000)), null);
});

test("an outline lands on the frame at whatever size it is shown", () => {
  const whole = cropBoxOutline(box(0, 0, CROP_BOX_SCALE, CROP_BOX_SCALE));
  assert.deepEqual(whole, { left: 0, top: 0, width: 100, height: 100 });
  assert.deepEqual(cropBoxOutline(box(0, 333, 1000, 666)), {
    left: 33.3,
    top: 0,
    width: 33.3,
    height: 100,
  });
});

test("a proposal says how much of the frame it keeps", () => {
  assert.equal(
    cropCoverageLabel(box(0, 0, CROP_BOX_SCALE, CROP_BOX_SCALE)),
    "Keeps 100% of the frame",
  );
  assert.equal(cropCoverageLabel(box(0, 0, 500, 500)), "Keeps 25% of the frame");
  assert.equal(cropCoverageLabel(box(250, 250, 750, 750)), "Keeps 25% of the frame");
});

test("a crop too tight to round is warned about rather than called zero", () => {
  assert.equal(cropCoverageLabel(box(0, 0, 60, 60)), "Keeps under 1% of the frame");
});

test("coverage is measured off the same box the outline is drawn from", () => {
  assert.equal(cropCoverageLabel(box(750, 1000, 250, 500)), cropCoverageLabel(box(250, 500, 750, 1000)));
});

test("there is nothing to say about a frame that stores no box", () => {
  assert.equal(cropCoverageLabel(null), null);
  assert.equal(cropCoverageLabel([]), null);
  assert.equal(cropCoverageLabel(box(250, 500, 250, 1000)), null);
});

test("a proposal says how big the cut will be in the frame's own pixels", () => {
  assert.deepEqual(cropPixelSize(box(250, 250, 750, 750), { width: 4000, height: 3000 }), {
    width: 2000,
    height: 1500,
  });
  assert.equal(
    cropSizeLabel(box(250, 250, 750, 750), { width: 4000, height: 3000 }),
    "About 2000 × 1500 px",
  );
  assert.equal(
    cropSizeLabel(box(250, 250, 750, 750), { width: 800, height: 600 }),
    "About 400 × 300 px",
  );
});

test("the size shown before the cut is the size the cut is made at", () => {
  const frame = { width: 855, height: 427 };
  const region = cropRegionOfBox(cropBoxOf(box(0, 0, 500, 500))!)!;
  const cut = croppedPixels(region, frame);
  assert.deepEqual(cropPixelSize(box(0, 0, 500, 500), frame), {
    width: cut.width,
    height: cut.height,
  });
});

test("a cut too small for the board to draw is warned about, and one that is not is not", () => {
  assert.equal(BOARD_SOURCE_EDGE, 640);
  assert.equal(cropSoftOnBoard(box(0, 0, 200, 200), { width: 6000, height: 4000 }), false);
  assert.equal(cropSoftOnBoard(box(0, 0, 200, 200), { width: 800, height: 600 }), true);
  assert.equal(cropSoftOnBoard(box(0, 0, 1000, 200), { width: 1000, height: 900 }), false);
});

test("nothing is measured or warned about when the frame's size is unknown", () => {
  assert.equal(cropPixelSize(box(0, 0, 100, 100), { width: null, height: null }), null);
  assert.equal(cropSizeLabel(box(0, 0, 100, 100), {}), null);
  assert.equal(cropSoftOnBoard(box(0, 0, 100, 100), { width: 0, height: 0 }), false);
  assert.equal(cropSizeLabel(null, { width: 4000, height: 3000 }), null);
});

test("a shape is looked up by the name a user says it in, and nothing else is a shape", () => {
  assert.equal(cropAspectRatio("16:9"), 16 / 9);
  assert.equal(cropAspectRatio("1:1"), 1);
  assert.equal(cropAspectRatio(""), null);
  assert.equal(cropAspectRatio("21:9"), null);
  assert.equal(cropAspectRatio(undefined), null);
  assert.deepEqual(CROP_ASPECT_IDS[0], "2.39:1");
});

test("the shape a cut was filed at is read back off its column, or is no shape", () => {
  assert.equal(cropAspectOf("2.39:1"), "2.39:1");
  assert.equal(cropAspectOf(""), null);
  assert.equal(cropAspectOf("21:9"), null);
  assert.equal(cropAspectOf(null), null);
  assert.equal(cropAspectOf(undefined), null);
  for (const id of CROP_ASPECT_IDS) {
    assert.equal(cropAspectOf(id), id);
    assert.ok((cropAspectRatio(id) ?? 0) > 0);
  }
});

test("a box is opened up to reach the shape rather than trimmed to it", () => {
  const fitted = cropBoxAtAspect(box(200, 400, 800, 600), { width: 1000, height: 1000 }, 16 / 9);
  assert.deepEqual(fitted, { ymin: 219, xmin: 0, ymax: 781, xmax: 1000 });
});

test("the shape is the shape of the pixels, not of the units", () => {
  const fitted = cropBoxAtAspect(box(200, 300, 800, 500), { width: 1600, height: 900 }, 1);
  assert.deepEqual(fitted, { ymin: 200, xmin: 231, ymax: 800, xmax: 569 });
  const cut = cropPixelSize(cropBoxColumns(fitted!), { width: 1600, height: 900 })!;
  assert.ok(Math.abs(cut.width / cut.height - 1) < 0.01);
});

test("a box against the edge of the frame slides inside it instead of being squashed", () => {
  const fitted = cropBoxAtAspect(box(400, 0, 600, 200), { width: 1000, height: 1000 }, 16 / 9);
  assert.deepEqual(fitted, { ymin: 400, xmin: 0, ymax: 600, xmax: 356 });
  const cut = cropPixelSize(cropBoxColumns(fitted!), { width: 1000, height: 1000 })!;
  assert.ok(Math.abs(cut.width / cut.height - 16 / 9) < 0.02);
});

test("a portrait shape out of a wide box takes height and gives up width", () => {
  const fitted = cropBoxAtAspect(box(400, 200, 600, 800), { width: 1000, height: 1000 }, 9 / 16);
  assert.deepEqual(fitted, { ymin: 0, xmin: 219, ymax: 1000, xmax: 781 });
});

test("a box already at the shape is left where it is", () => {
  const columns = box(0, 0, 500, 500);
  assert.deepEqual(cropBoxAtAspect(columns, { width: 1000, height: 1000 }, 1), cropBoxOf(columns));
});

test("a crop cannot be held to a shape the frame's pixels are unknown to", () => {
  assert.equal(cropBoxAtAspect(box(200, 200, 800, 800), {}, 16 / 9), null);
  assert.equal(cropBoxAtAspect(box(200, 200, 800, 800), { width: 1000, height: null }, 1), null);
  assert.equal(cropBoxAtAspect(null, { width: 1000, height: 1000 }, 1), null);
  assert.equal(cropBoxAtAspect(box(200, 200, 800, 800), { width: 1000, height: 1000 }, 0), null);
});

test("an adjustment that did not move the box says so", () => {
  const filed = box(500, 200, 900, 700);
  assert.equal(sameCut(box(501, 199, 899, 702), filed), true);
  assert.equal(sameCut(filed, filed), true);
  assert.equal(sameCut(box(560, 260, 860, 660), filed), false);
});

test("boxes that are not rectangles have not moved and have not stayed", () => {
  assert.equal(sameCut(null, box(500, 200, 900, 700)), false);
  assert.equal(sameCut(box(500, 200, 900, 700), []), false);
});

test("the box being adjusted is said back to the cropper in its own numbers", () => {
  assert.equal(
    priorCropNote({ cropBox: box(120, 200, 800, 900), editIntent: "just the hands" }),
    "Your previous box for this image was [ymin 120, xmin 200, ymax 800, xmax 900] out of 1000, " +
      "which you called “just the hands”.",
  );
  assert.equal(
    priorCropNote({ cropBox: box(120, 200, 800, 900), editIntent: "  " }),
    "Your previous box for this image was [ymin 120, xmin 200, ymax 800, xmax 900] out of 1000.",
  );
});

test("a label carried back into the ask is one bounded line", () => {
  const note = priorCropNote({
    cropBox: box(0, 0, 500, 500),
    editIntent: `the hands\non the rail ${"x".repeat(EDIT_INTENT_LIMIT)}`,
  });
  assert.ok(note);
  assert.ok(note.includes("the hands on the rail"));
  assert.ok(note.length < EDIT_INTENT_LIMIT * 2);
});

test("there is nothing to adjust without a rectangle to adjust", () => {
  assert.equal(priorCropNote({ cropBox: null }), null);
  assert.equal(priorCropNote({ cropBox: [1, 2, 3], editIntent: "the hands" }), null);
});

test("an adjusted cut keeps the label of the box that was moved", () => {
  assert.equal(
    refinedIntent({ answered: "the hands, tighter", previous: "just the hands", asked: "tighter" }),
    "the hands, tighter",
  );
  assert.equal(
    refinedIntent({ answered: "", previous: "just the hands", asked: "tighter" }),
    "just the hands — tighter",
  );
});

test("an adjustment the cropper named the same way still says how it moved", () => {
  assert.equal(
    refinedIntent({ answered: "Just the hands.", previous: "just the hands", asked: "tighter" }),
    "just the hands — tighter",
  );
});

test("a nudge the label already carries is not said twice", () => {
  assert.equal(
    refinedIntent({ answered: "", previous: "just the hands — tighter", asked: "Tighter." }),
    "just the hands — tighter",
  );
  assert.equal(
    refinedIntent({ answered: "", previous: "just the hands", asked: "just the hands" }),
    "just the hands",
  );
});

test("an adjusted label is still one bounded line", () => {
  const long = refinedIntent({
    answered: "",
    previous: "x".repeat(EDIT_INTENT_LIMIT),
    asked: "wider",
  });
  assert.equal(long.length, EDIT_INTENT_LIMIT);
  assert.ok(!long.includes("\n"));
});

test("a first ask with nothing behind it is filed under what was asked for", () => {
  assert.equal(refinedIntent({ answered: "", asked: "just the hands" }), "just the hands");
  assert.equal(
    refinedIntent({ answered: " ", previous: " ", asked: "just  the\nhands" }),
    "just the hands",
  );
});

test("a cut renamed by the user is filed under the words they typed", () => {
  assert.equal(
    relabeledIntent("the sign over the door", { editIntent: BOARD_CROP_INTENT }),
    "the sign over the door",
  );
  assert.equal(
    relabeledIntent("  the  sign\nover the door ", { editIntent: "the hands" }),
    "the sign over the door",
  );
});

test("an emptied rename files nothing", () => {
  assert.equal(relabeledIntent("", { editIntent: "just the hands" }), null);
  assert.equal(relabeledIntent("   \n ", { editIntent: "just the hands" }), null);
  assert.equal(relabeledIntent(" ", { editIntent: "" }), null);
});

test("a name re-typed as it stands is not a write", () => {
  assert.equal(relabeledIntent("just the hands", { editIntent: "just the hands" }), null);
  assert.equal(relabeledIntent(" just  the hands ", { editIntent: "just the hands" }), null);
  assert.equal(relabeledIntent("just the hands", {}), "just the hands");
});

test("a rename that only changes case or punctuation is still a rename", () => {
  assert.equal(relabeledIntent("Just the hands", { editIntent: "just the hands" }), "Just the hands");
  assert.equal(
    relabeledIntent("just the hands.", { editIntent: "just the hands" }),
    "just the hands.",
  );
});

test("a typed label is one bounded line", () => {
  const long = relabeledIntent(`${"x".repeat(EDIT_INTENT_LIMIT)} and more`, { editIntent: "" });
  assert.equal(long?.length, EDIT_INTENT_LIMIT);
});

test("a ratio near one of the six names is said by that name, and cut at it", () => {
  assert.deepEqual(cropShapeAt(1.75), { label: "16:9", ratio: 16 / 9 });
  assert.deepEqual(cropShapeAt(1), { label: "1:1", ratio: 1 });
  assert.deepEqual(cropShapeAt(2.39), { label: "2.39:1", ratio: 2.39 });
});

test("a ratio no name is near keeps its own number", () => {
  assert.deepEqual(cropShapeAt(3.52), { label: "3.52:1", ratio: 3.52 });
  assert.deepEqual(cropShapeAt(1.3), { label: "1.30:1", ratio: 1.3 });
});

test("a shape is two decimal places, so the label and the ratio agree", () => {
  const shape = cropShapeAt(3.5238095);
  assert.deepEqual(shape, { label: "3.52:1", ratio: 3.52 });
  assert.deepEqual(cropShapeOf(shape!.label), shape);
});

test("nothing that is not a shape is one", () => {
  assert.equal(cropShapeAt(0), null);
  assert.equal(cropShapeAt(-2), null);
  assert.equal(cropShapeAt(Number.NaN), null);
  assert.equal(cropShapeAt(Number.POSITIVE_INFINITY), null);
  assert.equal(cropShapeAt(400), null);
  assert.equal(cropShapeAt(0.0025), null);
});

test("a shape reads back off the column, whether it was named or measured", () => {
  assert.deepEqual(cropShapeOf("16:9"), { label: "16:9", ratio: 16 / 9 });
  assert.deepEqual(cropShapeOf("3.52:1"), { label: "3.52:1", ratio: 3.52 });
  assert.equal(cropShapeOf(""), null);
  assert.equal(cropShapeOf("scope"), null);
  assert.equal(cropShapeOf("16:9:1"), null);
  assert.equal(cropShapeOf("3.52"), null);
  assert.equal(cropShapeOf(3.52), null);
  assert.equal(cropShapeOf(undefined), null);
});

test("a shape said as width:height is that shape", () => {
  assert.deepEqual(cropShapeOf("5:4"), { label: "1.25:1", ratio: 1.25 });
  assert.deepEqual(cropShapeOf("3:2"), { label: "1.50:1", ratio: 1.5 });
  assert.deepEqual(cropShapeOf("4:5"), { label: "0.80:1", ratio: 0.8 });
  const said = cropShapeOf("5:4")!;
  assert.deepEqual(cropShapeOf(said.label), said);
});

test("a pair near one of the names comes back under the name", () => {
  assert.equal(cropShapeOf("1920:1080")?.label, "16:9");
  assert.equal(cropShapeOf("2:2")?.label, "1:1");
  assert.equal(cropShapeOf("2048:2048")?.ratio, 1);
});

test("a pair that is not a ratio is not a shape", () => {
  assert.equal(cropShapeOf("1:0"), null);
  assert.equal(cropShapeOf("0:1"), null);
  assert.equal(cropShapeOf("5x4"), null);
  assert.equal(cropShapeOf(":"), null);
  assert.equal(cropShapeOf("400:1"), null);
});

test("a measured label that is one of the names comes back as the name", () => {
  assert.equal(cropShapeOf("1.00:1")?.label, "1:1");
  assert.equal(cropShapeAt(1600 / 900)?.label, "16:9");
});

test("a loose shape is a word, and every ratio is not one", () => {
  assert.equal(looseShapeOf("square")?.id, "square");
  assert.equal(looseShapeOf("  Landscape ")?.id, "landscape");
  assert.equal(looseShapeOf("PORTRAIT")?.id, "portrait");
  assert.equal(looseShapeOf("rectangle")?.id, "rectangle");

  for (const said of ["1:1", "5:4", "2.39:1", "squarish", "", " ", undefined, 1]) {
    assert.equal(looseShapeOf(said), null, `${String(said)} is not a loose shape`);
  }
  assert.equal(cropShapeOf("square"), null);
});

test("a loose shape is a band, not a point", () => {
  const holds = (id: string, ratio: number) => looseShapeOf(id)!.holds(ratio);

  assert.ok(holds("square", 1));
  assert.ok(holds("square", 1.1));
  assert.ok(holds("square", 1 / 1.1));
  assert.ok(!holds("square", 4 / 3));

  assert.ok(holds("landscape", 16 / 9));
  assert.ok(!holds("landscape", 1));
  assert.ok(!holds("landscape", 9 / 16));

  assert.ok(holds("portrait", 9 / 16));
  assert.ok(!holds("portrait", 1));

  assert.ok(holds("rectangle", 16 / 9));
  assert.ok(holds("rectangle", 9 / 16));
  assert.ok(!holds("rectangle", 1.05));
});

test("a missed loose shape names the shape the box came out and the one asked for", () => {
  assert.match(looseShapeOf("square")!.missed(16 / 9), /that box is 16:9/);
  assert.match(looseShapeOf("square")!.missed(16 / 9), /roughly square/);
  assert.match(looseShapeOf("portrait")!.missed(1), /that box is 1:1/);
  assert.match(looseShapeOf("portrait")!.missed(1), /taller than it is wide/);
});

test("a shape asked for reads whichever way it was said", () => {
  assert.deepEqual(shapeAsked("16:9"), {
    label: "16:9",
    shape: { label: "16:9", ratio: 16 / 9 },
    loose: null,
  });
  assert.equal(shapeAsked("5:4")?.label, "1.25:1");
  assert.equal(shapeAsked("5:4")?.shape?.ratio, 1.25);
  assert.equal(shapeAsked("5:4")?.loose, null);

  assert.equal(shapeAsked("square")?.label, "Roughly square");
  assert.equal(shapeAsked("square")?.loose?.id, "square");
  assert.equal(shapeAsked("square")?.shape, null);
  assert.equal(shapeAsked(" Portrait ")?.loose?.id, "portrait");
});

test("nothing that is neither vocabulary is a shape asked for", () => {
  for (const said of ["", " ", "scope", "squarish", "16:9:1", "1:0", "400:1", undefined, 1.5]) {
    assert.equal(shapeAsked(said), null, `${String(said)} is not a shape`);
  }
});

test("the shape a box came out is measured off the frame's pixels", () => {
  assert.equal(cropShapeMeasured([0, 0, 1000, 500], { width: 1000, height: 1000 }), "0.50:1");
  assert.equal(cropShapeMeasured([0, 0, 1000, 563], { width: 1920, height: 1080 }), "1:1");
  assert.equal(cropShapeMeasured([0, 0, 1000, 500], {}), null);
  assert.equal(cropShapeMeasured("not a box", { width: 1000, height: 1000 }), null);
});

test("a cut is filed under wherever its frame's bytes came from", () => {
  assert.equal(versionOrigin({ origin: ReferenceOrigin.GENERATED }), ReferenceOrigin.GENERATED);
  assert.equal(versionOrigin({ origin: ReferenceOrigin.IMPORTED }), ReferenceOrigin.IMPORTED);
  assert.equal(versionOrigin({ origin: ReferenceOrigin.UPLOADED }), ReferenceOrigin.UPLOADED);
});

test("a frame read without the column claims nothing, and neither does its cut", () => {
  assert.equal(versionOrigin({}), ReferenceOrigin.UPLOADED);
  assert.equal(versionOrigin({ origin: null }), ReferenceOrigin.UPLOADED);
});
