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
  cropShapeOf,
  cropBoxAtAspect,
  cropBoxColumns,
  cropBoxOf,
  cropBoxOfRegion,
  cropBoxOutline,
  cropCoverageLabel,
  cropPixelSize,
  cropPlan,
  cropRegionOfBox,
  cropSizeLabel,
  cropSoftOnBoard,
  editIntent,
  existingCut,
  editRationale,
  priorCropNote,
  referenceCaption,
  refinedIntent,
  relabeledIntent,
  sameCut,
  versionCountIndex,
  versionCountLabel,
  versionDescendants,
  versionCredit,
  versionLabel,
  versionNote,
} from "./reference-version";
import { CAPTION_MAX_LENGTH, captionText } from "./moodboard-caption";
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

test("a plan is the cut, the name it is filed under, the box it came from and why", () => {
  const plan = cropPlan({
    box: cropBoxOf(box(120, 430, 260, 520))!,
    intent: "  just the\thands  ",
    rationale: "  Tight on the hands;\n the face reads as a distraction here.  ",
    sourceTitle: "Hallway, night",
  });

  assert.deepEqual(plan, {
    region: { x: 0.43, y: 0.12, width: 0.09, height: 0.14 },
    /// Named after the photograph, exactly as a crop kept off the board is: the
    /// director looks for the frame, not for the agent that cut it.
    title: "Hallway, night (crop)",
    editIntent: "just the hands",
    /// Carried on the plan because the run that holds it names no version: a
    /// plan that drops it hands the browser bytes nobody can ask why about.
    editRationale: "Tight on the hands; the face reads as a distraction here.",
    cropBox: [120, 430, 260, 520],
  });
});

test("a plan from a cropper that reasoned about nothing still files a version", () => {
  const plan = cropPlan({
    box: cropBoxOf(box(0, 200, 1000, 800))!,
    intent: "the sign",
    sourceTitle: "Wide",
  });
  assert.equal(plan?.editRationale, "");
});

test("a rationale is a sentence, so it is one line and bounded", () => {
  assert.equal(editRationale(" why\tthis  box\nis the box "), "why this box is the box");
  assert.equal(editRationale("x".repeat(EDIT_RATIONALE_LIMIT + 100)).length, EDIT_RATIONALE_LIMIT);
  /// Longer than an intent: that is a label, this is the model explaining
  /// itself, and the two are shown one above the other.
  assert.ok(EDIT_RATIONALE_LIMIT > EDIT_INTENT_LIMIT);
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

test("a cut says why it is where it is, under what it was asked for", () => {
  /// The one place a director reads that what they asked for was not in the
  /// frame and this box is the nearest thing that is.
  assert.equal(
    versionNote({
      editIntent: "the clock",
      editRationale: " No clock in this frame — this is the\nwall it would hang on. ",
    }),
    "No clock in this frame — this is the wall it would hang on.",
  );
});

test("a cut nobody reasoned about in words has no second line", () => {
  /// A crop the director drew on the board: there was no model and no sentence.
  assert.equal(versionNote({ editIntent: "Cropped on the board" }), null);
  assert.equal(versionNote({ editIntent: "just the hands", editRationale: "   " }), null);
});

test("a rationale that repeats the label is not shown twice", () => {
  /// A line under the label that says what the label says is noise in a list
  /// whose whole job is telling cuts of one photograph apart.
  assert.equal(
    versionNote({ editIntent: "just the hands", editRationale: "Just the hands." }),
    null,
  );
  assert.equal(
    versionNote({ editIntent: "", title: "Hallway, night (crop)", editRationale: "hallway night (crop)" }),
    null,
  );
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

test("a photograph is captioned with the title the director gave it", () => {
  assert.equal(referenceCaption({ title: "Hallway, night", source: null }), "Hallway, night");
  /// Not a version and not read as one: nothing about "(crop 2)" in a title says
  /// this row is a cut — only the source does.
  assert.equal(referenceCaption({ title: "Hallway, night (crop 2)" }), "Hallway, night (crop 2)");
});

test("a cut is captioned with the frame and what it keeps, not with “(crop 2)”", () => {
  /// The two cuts of one frame carry one title between them, so the caption that
  /// tells them apart under the pictures is the asking.
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
  /// A crop drawn on the board says where it was made — a filing detail in the
  /// versions list, and nothing at all to a reader of the board.
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
  /// An untitled frame leaves only the cut's own derived name to fall back to.
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
  /// And a cut asked for in the frame's own words is not that frame said twice.
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
  /// `captionText` cuts from the end, and the end is the half that says which
  /// cut this is — so the title is shortened here rather than the shot being
  /// truncated away there.
  const frame = "A very long title for a photograph nobody wanted to name twice";
  const shortened = referenceCaption({
    title: `${frame} (crop)`,
    editIntent: "just the hands",
    source: { title: frame },
  });
  assert.ok(shortened.length <= CAPTION_MAX_LENGTH, shortened);
  assert.ok(shortened.endsWith("… — just the hands"), shortened);
  assert.equal(captionText(shortened), shortened);

  /// And an asking long enough to leave no room for a name drops the frame
  /// rather than keeping a syllable of it.
  const asked = "the hands on the rail, everything above the wrist cut away";
  assert.equal(
    referenceCaption({ title: `${frame} (crop)`, editIntent: asked, source: { title: frame } }),
    asked,
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

test("the cuts of a project are counted by the frame they were cut from", () => {
  const index = versionCountIndex([
    { id: "hands", sourceReferenceId: "hallway" },
    { id: "door", sourceReferenceId: "hallway" },
    { id: "sign", sourceReferenceId: "wide" },
  ]);
  assert.equal(index.get("hallway"), 2);
  assert.equal(index.get("wide"), 1);
  /// A frame no cut names has no cuts — the read only carries the rows that
  /// were cut from something.
  assert.equal(index.get("street"), undefined);
});

test("a cut of a cut counts under the cut it was made from", () => {
  /// The one-level-deep reading the tile's number leads to: `reference.versions`
  /// files it under the cut a director went into to make it.
  const index = versionCountIndex([
    { id: "hands", sourceReferenceId: "hallway" },
    { id: "knuckles", sourceReferenceId: "hands" },
  ]);
  assert.equal(index.get("hallway"), 1);
  assert.equal(index.get("hands"), 1);
});

test("deleting a frame takes every cut below it, however deep", () => {
  /// What the row's cascade removes, which is what the removal has to be able to
  /// name before it happens — the second generation is deleted just as silently
  /// as the first.
  const links = [
    { id: "hands", sourceReferenceId: "hallway" },
    { id: "door", sourceReferenceId: "hallway" },
    { id: "knuckles", sourceReferenceId: "hands" },
    { id: "sign", sourceReferenceId: "wide" },
  ];
  assert.deepEqual(versionDescendants(links, "hallway").sort(), ["door", "hands", "knuckles"]);
  /// The frame itself is not in the answer: it is the thing being deleted.
  assert.deepEqual(versionDescendants(links, "hands"), ["knuckles"]);
  assert.deepEqual(versionDescendants(links, "street"), []);
});

test("a cut that names itself does not hang the walk", () => {
  /// Nothing in this app can file such a row, but this walks a graph that came
  /// off the wire.
  const links = [
    { id: "hallway", sourceReferenceId: "hallway" },
    { id: "hands", sourceReferenceId: "hallway" },
    { id: "hallway-again", sourceReferenceId: "hands" },
  ];
  assert.deepEqual(versionDescendants(links, "hallway").sort(), ["hallway-again", "hands"]);
});

test("a cut is outlined where it sits in the frame", () => {
  /// The right half, top to bottom of the middle: the numbers the row has been
  /// storing, as the rectangle to draw over the frame.
  assert.deepEqual(cropBoxOutline(box(250, 500, 750, 1000)), {
    left: 50,
    top: 25,
    width: 50,
    height: 50,
  });
});

test("a photograph is outlined nowhere", () => {
  /// An original stores no box — the column is empty, not a rectangle of the
  /// whole frame — and the panel shows it plain.
  assert.equal(cropBoxOutline([]), null);
  assert.equal(cropBoxOutline(undefined), null);
  assert.equal(cropBoxOutline([250, 500, 750]), null);
});

test("corners written the other way round outline the same rectangle", () => {
  assert.deepEqual(cropBoxOutline(box(750, 1000, 250, 500)), cropBoxOutline(box(250, 500, 750, 1000)));
});

test("a box that keeps no width is not a region of the frame", () => {
  /// Nothing that reaches a row can be this — both crop paths cut a rectangle —
  /// but a zero-wide outline draws as a line across the photograph, which reads
  /// as a claim about where the cut is.
  assert.equal(cropBoxOutline(box(250, 500, 750, 500)), null);
  assert.equal(cropBoxOutline(box(250, 500, 250, 1000)), null);
});

test("an outline lands on the frame at whatever size it is shown", () => {
  /// Percentages, so the same box covers the same part of a 320px panel image
  /// and of a 1200px one — the reason the box is stored 0-1000 of the frame.
  const whole = cropBoxOutline(box(0, 0, CROP_BOX_SCALE, CROP_BOX_SCALE));
  assert.deepEqual(whole, { left: 0, top: 0, width: 100, height: 100 });
  /// A third is a third, not 33.300000000000004 of a percent.
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
  /// Area, not an edge: half the height of half the width is a quarter of the
  /// photograph, which is what the cut will actually be made of.
  assert.equal(cropCoverageLabel(box(0, 0, 500, 500)), "Keeps 25% of the frame");
  assert.equal(cropCoverageLabel(box(250, 250, 750, 750)), "Keeps 25% of the frame");
});

test("a crop too tight to round is warned about rather than called zero", () => {
  /// Under a percent of a phone photo is a few hundred pixels across — the case
  /// the coverage line exists for, and "keeps 0%" would read as a bug.
  assert.equal(cropCoverageLabel(box(0, 0, 60, 60)), "Keeps under 1% of the frame");
});

test("coverage is measured off the same box the outline is drawn from", () => {
  /// Corners the other way round name the same rectangle, so they keep the same
  /// share of the frame.
  assert.equal(cropCoverageLabel(box(750, 1000, 250, 500)), cropCoverageLabel(box(250, 500, 750, 1000)));
});

test("there is nothing to say about a frame that stores no box", () => {
  assert.equal(cropCoverageLabel(null), null);
  assert.equal(cropCoverageLabel([]), null);
  assert.equal(cropCoverageLabel(box(250, 500, 250, 1000)), null);
});

test("a proposal says how big the cut will be in the frame's own pixels", () => {
  /// A quarter of the frame each way out of a 4000×3000 photograph.
  assert.deepEqual(cropPixelSize(box(250, 250, 750, 750), { width: 4000, height: 3000 }), {
    width: 2000,
    height: 1500,
  });
  assert.equal(
    cropSizeLabel(box(250, 250, 750, 750), { width: 4000, height: 3000 }),
    "About 2000 × 1500 px",
  );
  /// The same box against the same fractions of a much smaller frame — the
  /// judgement the coverage line cannot make, since both are 25% of the frame.
  assert.equal(
    cropSizeLabel(box(250, 250, 750, 750), { width: 800, height: 600 }),
    "About 400 × 300 px",
  );
});

test("the size shown before the cut is the size the cut is made at", () => {
  /// Not a second estimate: the panel's number comes off the arithmetic that
  /// will actually take the pixels, so an odd source rounds once rather than
  /// twice in opposite directions.
  const frame = { width: 855, height: 427 };
  const region = cropRegionOfBox(cropBoxOf(box(0, 0, 500, 500))!)!;
  const cut = croppedPixels(region, frame);
  assert.deepEqual(cropPixelSize(box(0, 0, 500, 500), frame), {
    width: cut.width,
    height: cut.height,
  });
});

test("a cut too small for the board to draw is warned about, and one that is not is not", () => {
  /// A drop lands at 320 scene units and a scene unit is two device pixels, so
  /// 640 is the longest edge below which the board is already showing less than
  /// it was given.
  assert.equal(BOARD_SOURCE_EDGE, 640);
  /// 4% of a 6000px photograph is a picture; 4% of an 800px one is a smear —
  /// the same box, the same coverage, and only one of them survives a board.
  assert.equal(cropSoftOnBoard(box(0, 0, 200, 200), { width: 6000, height: 4000 }), false);
  assert.equal(cropSoftOnBoard(box(0, 0, 200, 200), { width: 800, height: 600 }), true);
  /// The longest edge, because that is the edge a drop is scaled to: a tall
  /// slice 200px wide and 900px high is drawn from its height.
  assert.equal(cropSoftOnBoard(box(0, 0, 1000, 200), { width: 1000, height: 900 }), false);
});

test("nothing is measured or warned about when the frame's size is unknown", () => {
  /// A row uploaded before the browser wrote its dimensions. A warning nobody
  /// can check is worse than silence.
  assert.equal(cropPixelSize(box(0, 0, 100, 100), { width: null, height: null }), null);
  assert.equal(cropSizeLabel(box(0, 0, 100, 100), {}), null);
  assert.equal(cropSoftOnBoard(box(0, 0, 100, 100), { width: 0, height: 0 }), false);
  /// And nothing to measure: an original stores no box at all.
  assert.equal(cropSizeLabel(null, { width: 4000, height: 3000 }), null);
});

test("a shape is looked up by the name a director says it in, and nothing else is a shape", () => {
  assert.equal(cropAspectRatio("16:9"), 16 / 9);
  assert.equal(cropAspectRatio("1:1"), 1);
  /// The form's own "any shape", and anything a stale client sends.
  assert.equal(cropAspectRatio(""), null);
  assert.equal(cropAspectRatio("21:9"), null);
  assert.equal(cropAspectRatio(undefined), null);
  assert.deepEqual(CROP_ASPECT_IDS[0], "2.39:1");
});

test("the shape a cut was filed at is read back off its column, or is no shape", () => {
  assert.equal(cropAspectOf("2.39:1"), "2.39:1");
  /// A cut asked for at no shape, an original, and a hand-drawn crop all store
  /// the same empty column — none of them is a crop held to anything.
  assert.equal(cropAspectOf(""), null);
  /// A column written by a client this one no longer agrees with, and one that
  /// is not a string at all: a nudge about such a row is asked unconstrained
  /// rather than at NaN.
  assert.equal(cropAspectOf("21:9"), null);
  assert.equal(cropAspectOf(null), null);
  assert.equal(cropAspectOf(undefined), null);
  /// The two readings of one column agree: a name that is a shape has a ratio.
  for (const id of CROP_ASPECT_IDS) {
    assert.equal(cropAspectOf(id), id);
    assert.ok((cropAspectRatio(id) ?? 0) > 0);
  }
});

test("a box is opened up to reach the shape rather than trimmed to it", () => {
  /// A square frame, so a unit is a unit on both edges. A tall box of a face
  /// asked for as 16:9 keeps every pixel of the face and takes in what is beside
  /// it: the box says what has to be in the shot.
  const fitted = cropBoxAtAspect(box(200, 400, 800, 600), { width: 1000, height: 1000 }, 16 / 9);
  /// 600 units of height needs 1066 of width, which the frame does not have — so
  /// the width goes to the frame's edge and the height gives way to 562.5.
  assert.deepEqual(fitted, { ymin: 219, xmin: 0, ymax: 781, xmax: 1000 });
});

test("the shape is the shape of the pixels, not of the units", () => {
  /// 1600 × 900: a unit of width is 1.6px and a unit of height is 0.9px, so a
  /// square cut is not a square box. This is the whole reason the prompt cannot
  /// be trusted with a ratio — the model is never told the frame's pixels.
  const fitted = cropBoxAtAspect(box(200, 300, 800, 500), { width: 1600, height: 900 }, 1);
  assert.deepEqual(fitted, { ymin: 200, xmin: 231, ymax: 800, xmax: 569 });
  const cut = cropPixelSize(cropBoxColumns(fitted!), { width: 1600, height: 900 })!;
  assert.ok(Math.abs(cut.width / cut.height - 1) < 0.01);
});

test("a box against the edge of the frame slides inside it instead of being squashed", () => {
  /// Growing about the centre would hang 78px off the left of the photograph, and
  /// clamping the overrun would leave a rectangle that is no longer the ratio.
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
  /// A row uploaded before the browser wrote its dimensions: refused rather than
  /// answered, because a cut filed as 16:9 that is not 16:9 is worse than no cut.
  assert.equal(cropBoxAtAspect(box(200, 200, 800, 800), {}, 16 / 9), null);
  assert.equal(cropBoxAtAspect(box(200, 200, 800, 800), { width: 1000, height: null }, 1), null);
  /// And nothing to fit: an original stores no box, and no ratio is no shape.
  assert.equal(cropBoxAtAspect(null, { width: 1000, height: 1000 }, 1), null);
  assert.equal(cropBoxAtAspect(box(200, 200, 800, 800), { width: 1000, height: 1000 }, 0), null);
});

test("a box the frame has already been cut at names the cut it repeats", () => {
  const versions = [
    { id: "sign", cropBox: box(100, 100, 400, 400) },
    { id: "hands", cropBox: box(500, 200, 900, 700) },
  ];
  /// The same ask twice: one prompt, two runs, four numbers a unit or two apart.
  assert.equal(existingCut(box(502, 199, 898, 703), versions)?.id, "hands");
});

test("a box of another part of the frame is a cut of its own", () => {
  const versions = [{ id: "hands", cropBox: box(500, 200, 900, 700) }];
  assert.equal(existingCut(box(100, 100, 400, 400), versions), null);
  /// Overlapping is not repeating: the same subject framed twice as tight is the
  /// second reading a director asked for.
  assert.equal(existingCut(box(550, 250, 850, 650), versions), null);
});

test("the cut a box repeats is the closest one, not the first", () => {
  const near = box(300, 300, 700, 700);
  const versions = [
    { id: "wide", cropBox: box(298, 298, 703, 703) },
    { id: "exact", cropBox: near },
  ];
  assert.equal(existingCut(near, versions)?.id, "exact");
});

test("nothing is repeated when there is no box to compare", () => {
  const versions = [{ id: "hands", cropBox: box(500, 200, 900, 700) }];
  assert.equal(existingCut(null, versions), null);
  assert.equal(existingCut(box(500, 200, 900, 700), undefined), null);
  /// A row with no box of its own — a version filed before the column existed —
  /// is skipped rather than read as matching everything.
  assert.equal(existingCut(box(500, 200, 900, 700), [{ id: "old", cropBox: [] }]), null);
});

test("the cut being adjusted is not the cut the offer repeats", () => {
  const versions = [
    { id: "hands", cropBox: box(500, 200, 900, 700) },
    { id: "sign", cropBox: box(100, 100, 400, 400) },
  ];
  /// A nudge moves the box a little, so it still overlaps the row it was moved
  /// from — naming that row is the review pointing at what the director is
  /// holding.
  assert.equal(existingCut(box(505, 205, 895, 695), versions, { except: "hands" }), null);
  /// Every other cut of the frame is still worth naming: an adjustment can walk
  /// a box onto one.
  assert.equal(
    existingCut(box(102, 98, 398, 402), versions, { except: "hands" })?.id,
    "sign",
  );
  /// Without the exception nothing changes for a first ask.
  assert.equal(existingCut(box(505, 205, 895, 695), versions)?.id, "hands");
});

test("an adjustment that did not move the box says so", () => {
  const filed = box(500, 200, 900, 700);
  /// The model answering with the box it was given, give or take rounding.
  assert.equal(sameCut(box(501, 199, 899, 702), filed), true);
  assert.equal(sameCut(filed, filed), true);
  /// A nudge that actually took.
  assert.equal(sameCut(box(560, 260, 860, 660), filed), false);
});

test("boxes that are not rectangles have not moved and have not stayed", () => {
  /// Nothing to compare is not "unchanged": an offer with no readable box is a
  /// review with nothing to say, not one saying the box held still.
  assert.equal(sameCut(null, box(500, 200, 900, 700)), false);
  assert.equal(sameCut(box(500, 200, 900, 700), []), false);
});

test("the box being adjusted is said back to the cropper in its own numbers", () => {
  assert.equal(
    priorCropNote({ cropBox: box(120, 200, 800, 900), editIntent: "just the hands" }),
    "Your previous box for this image was [ymin 120, xmin 200, ymax 800, xmax 900] out of 1000, " +
      "which you called “just the hands”.",
  );
  /// A cut nobody labelled is still a box worth moving.
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
  /// The model's own words when it gave them — an adjustment is still an answer
  /// about what the box keeps.
  assert.equal(
    refinedIntent({ answered: "the hands, tighter", previous: "just the hands", asked: "tighter" }),
    "the hands, tighter",
  );
  /// And when it gave none, the label of the cut being moved leads — a row
  /// called "tighter" says nothing about which part of the photograph it is —
  /// with the nudge behind it, since the row it was moved from is still in the
  /// list and two rows of the same words tell nobody which cut is which.
  assert.equal(
    refinedIntent({ answered: "", previous: "just the hands", asked: "tighter" }),
    "just the hands — tighter",
  );
});

test("an adjustment the cropper named the same way still says how it moved", () => {
  /// The likeliest collision of all: the model is asked to name what the crop
  /// keeps, and a cut moved tighter on the same subject keeps the same thing —
  /// so its own answer is the label the row it was moved from already holds.
  assert.equal(
    refinedIntent({ answered: "Just the hands.", previous: "just the hands", asked: "tighter" }),
    "just the hands — tighter",
  );
});

test("a nudge the label already carries is not said twice", () => {
  /// Tighter, a look, and tighter again: the same word moving the same box.
  assert.equal(
    refinedIntent({ answered: "", previous: "just the hands — tighter", asked: "Tighter." }),
    "just the hands — tighter",
  );
  /// The whole label repeated back as the nudge is the director re-asking, not
  /// a second description of the cut.
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

test("a cut renamed by the director is filed under the words they typed", () => {
  assert.equal(
    relabeledIntent("the sign over the door", { editIntent: BOARD_CROP_INTENT }),
    "the sign over the door",
  );
  assert.equal(
    relabeledIntent("  the  sign\nover the door ", { editIntent: "the hands" }),
    "the sign over the door",
  );
});

/// A cleared field is a cancel. Filing it would leave the row on its title,
/// which is the frame's name plus "(crop N)" — the words every other cut of that
/// frame carries, and what the label exists to say something other than.
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

/// Unlike the rules that ask whether two *writers* said the same thing, this is
/// the director fixing a label — and a capital or a full stop is a thing they may
/// be fixing.
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

/// The shapes beyond the six names: an opening on a moodboard is whatever ratio
/// the template made it, and a cut asked for that opening is held to it.

test("a ratio near one of the six names is said by that name, and cut at it", () => {
  /// GOLDEN_RATIO's accent slot measures 1.75:1. A director reads that as 16:9
  /// and a `cropAspectOf` reads it as nothing at all, so the label snaps — and
  /// the ratio snaps with it, or a cut called 16:9 would not be 16:9.
  assert.deepEqual(cropShapeAt(1.75), { label: "16:9", ratio: 16 / 9 });
  assert.deepEqual(cropShapeAt(1), { label: "1:1", ratio: 1 });
  assert.deepEqual(cropShapeAt(2.39), { label: "2.39:1", ratio: 2.39 });
});

test("a ratio no name is near keeps its own number", () => {
  /// HERO_LEFT's supporting strips. The whole reason this layer exists: 3.52 is
  /// wider than anything on the list, so naming it is the only way to cut it.
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
  /// Bounded rather than trusted: this arrives from a wire.
  assert.equal(cropShapeAt(400), null);
  assert.equal(cropShapeAt(0.0025), null);
});

test("a shape reads back off the column, whether it was named or measured", () => {
  assert.deepEqual(cropShapeOf("16:9"), { label: "16:9", ratio: 16 / 9 });
  assert.deepEqual(cropShapeOf("3.52:1"), { label: "3.52:1", ratio: 3.52 });
  /// The stored form of a cut nobody held to a format, and the form's own
  /// "any shape" — both are held to nothing rather than to NaN.
  assert.equal(cropShapeOf(""), null);
  assert.equal(cropShapeOf("scope"), null);
  assert.equal(cropShapeOf("16:9:1"), null);
  assert.equal(cropShapeOf("3.52"), null);
  assert.equal(cropShapeOf(3.52), null);
  assert.equal(cropShapeOf(undefined), null);
});

/// The spec's "a specific ratio": 5:4 is a format a director asks for and no
/// name on the list carries it. Both sides are read and divided out, so the
/// shape that comes back has one spelling however it was said.
test("a shape said as width:height is that shape", () => {
  assert.deepEqual(cropShapeOf("5:4"), { label: "1.25:1", ratio: 1.25 });
  assert.deepEqual(cropShapeOf("3:2"), { label: "1.50:1", ratio: 1.5 });
  /// A portrait pair reads the same way — the ratio is width over height either
  /// side of 1.
  assert.deepEqual(cropShapeOf("4:5"), { label: "0.80:1", ratio: 0.8 });
  /// And it round-trips, which is what makes the label safe to store: the column
  /// holds one spelling and reads back the shape it was written from.
  const said = cropShapeOf("5:4")!;
  assert.deepEqual(cropShapeOf(said.label), said);
});

test("a pair near one of the names comes back under the name", () => {
  /// Same rule the slot shapes already snap by: a director says 1920:1080 and
  /// means 16:9, and two spellings of one shape in the column is two shapes to
  /// everything reading it.
  assert.equal(cropShapeOf("1920:1080")?.label, "16:9");
  assert.equal(cropShapeOf("2:2")?.label, "1:1");
  assert.equal(cropShapeOf("2048:2048")?.ratio, 1);
});

test("a pair that is not a ratio is not a shape", () => {
  /// Divided out rather than trusted: a zero on either side is not a shape a box
  /// can be held to, and neither is a word that merely has a colon in it.
  assert.equal(cropShapeOf("1:0"), null);
  assert.equal(cropShapeOf("0:1"), null);
  assert.equal(cropShapeOf("5x4"), null);
  assert.equal(cropShapeOf(":"), null);
  /// Still bounded by `cropShapeAt`, which this now goes through for every pair.
  assert.equal(cropShapeOf("400:1"), null);
});

test("a measured label that is one of the names comes back as the name", () => {
  /// So a slot at exactly 1:1 is stored as "1:1" and not as "1.00:1" — two
  /// spellings of one shape in the column is two shapes to everything reading it.
  assert.equal(cropShapeOf("1.00:1")?.label, "1:1");
  assert.equal(cropShapeAt(1600 / 900)?.label, "16:9");
});
