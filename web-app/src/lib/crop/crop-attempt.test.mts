import { test } from "node:test";
import assert from "node:assert/strict";

import { sameCropAnswer, usableCropBox } from "@/lib/crop/crop-attempt";
import { looseShapeOf } from "@/lib/references/reference-version";

const faultOf = (value: unknown) => {
  const attempt = usableCropBox(value);
  return "fault" in attempt ? attempt.fault : null;
};

test("a box of the frame is usable and comes back as a rectangle", () => {
  assert.deepEqual(usableCropBox([100, 200, 800, 900]), {
    box: { ymin: 100, xmin: 200, ymax: 800, xmax: 900 },
  });
});

test("what is not a rectangle at all is a fault the model is told how to fix", () => {
  for (const answer of [undefined, "the middle", [100, 200, 800], [100, "x", 800, 900], []]) {
    const fault = faultOf(answer);
    assert.ok(fault, `${JSON.stringify(answer)} should not be usable`);
    assert.match(fault, /\[ymin, xmin, ymax, xmax\]/);
  }
});

test("a strip too thin to be a shot names the edge and how thin it is", () => {
  const thinHeight = faultOf([500, 100, 512, 900]);
  assert.ok(thinHeight);
  assert.match(thinHeight, /12\/1000 of the frame's height/);

  const thinWidth = faultOf([100, 500, 900, 515]);
  assert.ok(thinWidth);
  assert.match(thinWidth, /15\/1000 of the frame's width/);
});

test("the whole frame is not a fault", () => {
  assert.equal(faultOf([0, 0, 1000, 1000]), null);
});

test("a box exactly at the threshold is a shot, one unit under it is not", () => {
  assert.equal(faultOf([0, 0, 20, 1000]), null);
  assert.ok(faultOf([0, 0, 19, 1000]));
});

test("the same box answered twice is the same answer, whatever it was written as", () => {
  assert.ok(sameCropAnswer([500, 100, 512, 900], [500, 100, 512, 900]));
  assert.ok(sameCropAnswer([512, 900, 500, 100], [500, 100, 512, 900]));
  assert.ok(!sameCropAnswer([500, 100, 512, 900], [500, 100, 800, 900]));
});

test("two answers that are not boxes are compared as they were written", () => {
  assert.ok(sameCropAnswer("nope", "nope"));
  assert.ok(!sameCropAnswer("nope", [1, 2, 3]));
});

const looseFaultOf = (value: unknown, id: string, frame = { width: 1000, height: 1000 }) => {
  const loose = looseShapeOf(id);
  assert.ok(loose);
  const attempt = usableCropBox(value, { loose, frame });
  return "fault" in attempt ? attempt.fault : null;
};

test("a box that is the loose shape asked for is usable", () => {
  assert.equal(looseFaultOf([100, 100, 700, 700], "square"), null);
  assert.equal(looseFaultOf([200, 100, 500, 900], "landscape"), null);
  assert.equal(looseFaultOf([100, 400, 900, 600], "portrait"), null);
});

test("a box that is not the loose shape is a fault naming what it is instead", () => {
  const fault = looseFaultOf([400, 100, 600, 900], "square");
  assert.ok(fault);
  assert.match(fault, /that box is 4\.00:1/);
  assert.match(fault, /roughly square/);
});

test("a rectangle refuses a square in both directions of oblong", () => {
  assert.equal(looseFaultOf([100, 100, 400, 900], "rectangle"), null);
  assert.equal(looseFaultOf([100, 400, 900, 700], "rectangle"), null);
  assert.ok(looseFaultOf([100, 100, 700, 700], "rectangle"));
});

test("the shape is measured in the frame's pixels, not in the box's units", () => {
  assert.equal(looseFaultOf([0, 0, 1000, 500], "square", { width: 2000, height: 1000 }), null);
  assert.ok(looseFaultOf([0, 0, 1000, 500], "square", { width: 1000, height: 1000 }));
});

test("a frame whose pixel size was never recorded leaves a loose ask unchecked", () => {
  const loose = looseShapeOf("square");
  assert.ok(loose);
  assert.deepEqual(usableCropBox([400, 100, 600, 900], { loose, frame: {} }), {
    box: { ymin: 400, xmin: 100, ymax: 600, xmax: 900 },
  });
});

test("the shape is asked about after the box is a box", () => {
  const fault = looseFaultOf([500, 100, 512, 900], "square");
  assert.ok(fault);
  assert.match(fault, /strip rather than a shot/);
});
