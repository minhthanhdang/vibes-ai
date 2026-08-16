import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CROP_BOX_SCALE,
  CROP_MIN_SIDE,
  EDIT_INTENT_LIMIT,
  EDIT_RATIONALE_LIMIT,
  cropBoxColumns,
  cropBoxOf,
  cropBoxOfRegion,
  cropBoxOutline,
  cropCoverageLabel,
  cropPlan,
  cropRegionOfBox,
  editIntent,
  existingCut,
  editRationale,
  priorCropNote,
  refinedIntent,
  sameCut,
  versionCountIndex,
  versionCountLabel,
  versionCredit,
  versionLabel,
  versionNote,
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
