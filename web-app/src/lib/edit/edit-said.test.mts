import { test } from "node:test";
import assert from "node:assert/strict";

import { editSaid, editedReferenceTitle } from "@/lib/edit/edit-said";
import type { EditOp } from "@/lib/edit/edit-ops";

const CROP: EditOp = { op: "crop", box: [100, 100, 900, 900] };
const GRADE: EditOp = {
  op: "grade",
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 30,
  hue: 0,
};

test("a title says what was done to it", () => {
  assert.equal(editedReferenceTitle("Stairwell", [CROP]), "Stairwell (crop)");
  assert.equal(editedReferenceTitle("Stairwell", [{ op: "turn", turn: "left" }]), "Stairwell (turned)");
  assert.equal(
    editedReferenceTitle("Stairwell", [{ op: "flip", axis: "horizontal" }]),
    "Stairwell (flipped)",
  );
  assert.equal(editedReferenceTitle("Stairwell", [GRADE]), "Stairwell (graded)");
  assert.equal(editedReferenceTitle("Stairwell", [CROP, GRADE]), "Stairwell (edit)");
});

test("no ops at all still reads as a crop, which is what every version was", () => {
  assert.equal(editedReferenceTitle("Stairwell"), "Stairwell (crop)");
});

test("an edit of an edit counts on from the old suffix, whatever it said", () => {
  assert.equal(editedReferenceTitle("Stairwell (crop)", [CROP]), "Stairwell (crop 2)");
  assert.equal(editedReferenceTitle("Stairwell (crop 2)", [CROP]), "Stairwell (crop 3)");
  assert.equal(editedReferenceTitle("Stairwell (crop)", [GRADE]), "Stairwell (graded 2)");
  assert.equal(editedReferenceTitle("Stairwell (graded 2)", [CROP]), "Stairwell (crop 3)");
});

test("a title of nothing is still filed under something", () => {
  assert.equal(editedReferenceTitle("   ", [CROP]), "Reference (crop)");
  assert.equal(editedReferenceTitle("(crop)", [CROP]), "Reference (crop 2)");
});

test("a long title is cut to leave room for the suffix", () => {
  const long = editedReferenceTitle("x".repeat(400), [CROP]);
  assert.ok(long.length <= 200);
  assert.ok(long.endsWith(" (crop)"));
});

test("what was done reads as a sentence the orchestrator can say back", () => {
  assert.equal(editSaid([CROP]), "cropped it");
  assert.equal(editSaid([{ op: "crop", box: [0, 0, 900, 900], shape: "16:9" }]), "cropped it to 16:9");
  assert.equal(editSaid([{ op: "turn", turn: "upside-down" }]), "turned it upside down");
  assert.equal(editSaid([{ op: "flip", axis: "vertical" }]), "flipped it top to bottom");
  assert.equal(editSaid([GRADE]), "warmed it up");
  assert.equal(editSaid([]), "");
});

test("a grade names each knob it turned, and which way", () => {
  assert.equal(
    editSaid([{ op: "grade", brightness: -10, contrast: 20, saturation: 0, warmth: 0, hue: 0 }]),
    "darkened it and put more contrast in it",
  );
});

test("several edits read as a list", () => {
  assert.equal(
    editSaid([CROP, { op: "flip", axis: "horizontal" }, GRADE]),
    "cropped it, flipped it left to right and warmed it up",
  );
});

test("a crop that trims nothing does not make a grade read as a mixed edit", () => {
  const whole: EditOp = { op: "crop", box: [0, 0, 1000, 1000] };
  assert.equal(editedReferenceTitle("Negroni", [whole, GRADE]), "Negroni (graded)");
  assert.equal(editedReferenceTitle("Negroni", [whole]), "Negroni (crop)");
  assert.equal(editedReferenceTitle("Negroni", [CROP, GRADE]), "Negroni (edit)");
});
