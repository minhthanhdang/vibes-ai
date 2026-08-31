import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EDIT_OPS_LIMIT,
  EDIT_OP_ORDER,
  QUARTER_TURNS,
  editOps,
  quarterTurned,
  sameEditOps,
  usableEditOps,
  type EditOp,
} from "@/lib/edit/edit-ops";
import { looseShapeOf } from "@/lib/references/reference-version";

const crop = (box = [100, 100, 900, 900], shape?: string) => ({ op: "crop", box, ...(shape && { shape }) });

const opsOf = (value: unknown): EditOp[] => {
  const read = usableEditOps(value);
  assert.ok(!("fault" in read), `expected ops, got ${"fault" in read ? read.fault : ""}`);
  return read.ops;
};

const faultOf = (value: unknown) => {
  const read = usableEditOps(value);
  return "fault" in read ? read.fault : null;
};

test("the vocabulary is four kinds, one of each", () => {
  assert.deepEqual([...EDIT_OP_ORDER], ["crop", "turn", "flip", "grade"]);
  assert.equal(EDIT_OPS_LIMIT, EDIT_OP_ORDER.length);
});

test("a turn is a word and the degrees live in one place", () => {
  assert.deepEqual(QUARTER_TURNS, { left: 270, right: 90, "upside-down": 180 });
});

test("a crop alone comes back as a crop op with the box as columns", () => {
  assert.deepEqual(opsOf([crop([100, 200, 800, 900])]), [
    { op: "crop", box: [100, 200, 800, 900] },
  ]);
});

test("a crop carries the shape it was held to when one was named", () => {
  assert.deepEqual(opsOf([crop([100, 200, 800, 900], "16:9")]), [
    { op: "crop", box: [100, 200, 800, 900], shape: "16:9" },
  ]);
  assert.deepEqual(opsOf([crop([100, 200, 800, 900], "square")]), [
    { op: "crop", box: [100, 200, 800, 900], shape: "square" },
  ]);
  assert.deepEqual(opsOf([crop([100, 200, 800, 900], "sideways")]), [
    { op: "crop", box: [100, 200, 800, 900] },
  ]);
});

test("a grade fills in every knob it was not given", () => {
  assert.deepEqual(opsOf([{ op: "grade", warmth: 30 }]), [
    { op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: 30, hue: 0 },
  ]);
});

test("a knob past its end is turned as far as it goes", () => {
  assert.deepEqual(opsOf([{ op: "grade", warmth: 400, hue: -900 }]), [
    { op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: 100, hue: -180 },
  ]);
});

test("a grade with every knob at 0 is refused rather than filed as nothing", () => {
  const fault = faultOf([{ op: "grade", brightness: 0, warmth: 0 }]);
  assert.ok(fault);
  assert.match(fault, /changes nothing/);
});

test("a knob that is not a number names itself in the fault", () => {
  const fault = faultOf([{ op: "grade", warmth: "warmer" }]);
  assert.ok(fault);
  assert.match(fault, /warmth/);
});

test("a turn or a flip that is not in the vocabulary says what the words are", () => {
  const turn = faultOf([{ op: "turn", turn: "45 degrees" }]);
  assert.ok(turn);
  assert.match(turn, /left, right, upside-down/);

  const flip = faultOf([{ op: "flip", axis: "sideways" }]);
  assert.ok(flip);
  assert.match(flip, /horizontal, vertical, both/);
});

test("the words are read however they were cased", () => {
  assert.deepEqual(opsOf([{ op: "turn", turn: " Left " }]), [{ op: "turn", turn: "left" }]);
  assert.deepEqual(opsOf([{ op: "flip", axis: "Horizontal" }]), [
    { op: "flip", axis: "horizontal" },
  ]);
});

test("an op nobody has heard of is a fault that lists the ones there are", () => {
  const fault = faultOf([{ op: "sharpen" }]);
  assert.ok(fault);
  assert.match(fault, /crop, turn, flip, grade/);
});

test("what is not a list, and a list of nothing, are both faults", () => {
  assert.ok(faultOf(undefined));
  assert.ok(faultOf({ op: "crop", box: [0, 0, 1000, 1000] }));
  const empty = faultOf([]);
  assert.ok(empty);
  assert.match(empty, /empty/);
});

test("two edits of one kind are refused rather than composed", () => {
  const fault = faultOf([{ op: "grade", warmth: 20 }, { op: "grade", contrast: 20 }]);
  assert.ok(fault);
  assert.match(fault, /two grade edits/);
});

test("a crop after anything else is refused, because its box would be of a picture nobody saw", () => {
  const fault = faultOf([{ op: "turn", turn: "right" }, crop()]);
  assert.ok(fault);
  assert.match(fault, /first edit/);
});

test("a shuffled list is put in the canonical order rather than refused", () => {
  const ops = opsOf([{ op: "grade", warmth: 20 }, { op: "turn", turn: "upside-down" }]);
  assert.deepEqual(
    ops.map((op) => op.op),
    ["turn", "grade"],
  );
});

test("a flip before a quarter turn comes back as a turn then the other axis", () => {
  assert.deepEqual(opsOf([{ op: "flip", axis: "horizontal" }, { op: "turn", turn: "right" }]), [
    { op: "turn", turn: "right" },
    { op: "flip", axis: "vertical" },
  ]);
  assert.deepEqual(opsOf([{ op: "flip", axis: "vertical" }, { op: "turn", turn: "left" }]), [
    { op: "turn", turn: "left" },
    { op: "flip", axis: "horizontal" },
  ]);
});

test("a half turn commutes, so the axis is left where it was", () => {
  assert.deepEqual(
    opsOf([{ op: "flip", axis: "horizontal" }, { op: "turn", turn: "upside-down" }]),
    [{ op: "turn", turn: "upside-down" }, { op: "flip", axis: "horizontal" }],
  );
});

test("a flip already after the turn is left exactly as it was written", () => {
  assert.deepEqual(opsOf([{ op: "turn", turn: "right" }, { op: "flip", axis: "horizontal" }]), [
    { op: "turn", turn: "right" },
    { op: "flip", axis: "horizontal" },
  ]);
});

test("a loose shape held against a frame is checked on the crop op", () => {
  const held = { loose: looseShapeOf("square")!, frame: { width: 1000, height: 1000 } };
  const read = usableEditOps([crop([0, 0, 200, 900])], held);
  assert.ok("fault" in read);
  assert.match(read.fault, /roughly square/);
});

test("only a left or a right turn swaps the edges", () => {
  assert.ok(quarterTurned([{ op: "turn", turn: "left" }]));
  assert.ok(quarterTurned([{ op: "turn", turn: "right" }]));
  assert.ok(!quarterTurned([{ op: "turn", turn: "upside-down" }]));
  assert.ok(!quarterTurned([{ op: "flip", axis: "both" }]));
});

test("a stored list is read tolerantly, dropping what cannot be read", () => {
  assert.deepEqual(
    editOps([crop([100, 200, 800, 900]), { op: "wobble" }, { op: "turn", turn: "left" }]),
    [{ op: "crop", box: [100, 200, 800, 900] }, { op: "turn", turn: "left" }],
  );
  assert.deepEqual(editOps(null), []);
  assert.deepEqual(editOps("[]"), []);
  assert.deepEqual(editOps([]), []);
});

test("two lists are the same when every op in them is", () => {
  const ops = opsOf([crop([100, 200, 800, 900]), { op: "grade", warmth: 20 }]);
  assert.ok(sameEditOps(ops, editOps(JSON.parse(JSON.stringify(ops)))));
  assert.ok(!sameEditOps(ops, opsOf([crop([100, 200, 800, 900])])));
  assert.ok(!sameEditOps(ops, opsOf([crop([100, 200, 800, 901]), { op: "grade", warmth: 20 }])));
  assert.ok(!sameEditOps(ops, opsOf([crop([100, 200, 800, 900]), { op: "grade", warmth: 21 }])));
});
