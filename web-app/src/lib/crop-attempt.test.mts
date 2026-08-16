import { test } from "node:test";
import assert from "node:assert/strict";

import { CROP_MAX_ATTEMPTS, sameCropAnswer, usableCropBox } from "./crop-attempt";

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

/// The fault that matters most, because downstream it is invisible: a sliver and
/// a box that trims nothing both come out of `cropRegionOfBox` as null, and the
/// caller reports that as "the whole frame is the shot" — which of a 12-unit
/// strip is the opposite of what happened.
test("a strip too thin to be a shot names the edge and how thin it is", () => {
  const thinHeight = faultOf([500, 100, 512, 900]);
  assert.ok(thinHeight);
  assert.match(thinHeight, /12\/1000 of the frame's height/);

  const thinWidth = faultOf([100, 500, 900, 515]);
  assert.ok(thinWidth);
  assert.match(thinWidth, /15\/1000 of the frame's width/);
});

/// The whole frame is a legal answer — the cropper is told to give it when the
/// frame is the shot — so it is not a fault here. Whether it is worth cutting is
/// asked once, later, by the caller.
test("the whole frame is not a fault", () => {
  assert.equal(faultOf([0, 0, 1000, 1000]), null);
});

test("a box exactly at the threshold is a shot, one unit under it is not", () => {
  assert.equal(faultOf([0, 0, 20, 1000]), null);
  assert.ok(faultOf([0, 0, 19, 1000]));
});

test("the same box answered twice is the same answer, whatever it was written as", () => {
  assert.ok(sameCropAnswer([500, 100, 512, 900], [500, 100, 512, 900]));
  /// Reversed edges name the same rectangle, and `cropBoxOf` orders them — so a
  /// model that repeated itself with the corners swapped has still repeated
  /// itself, and is not owed another photograph read for it.
  assert.ok(sameCropAnswer([512, 900, 500, 100], [500, 100, 512, 900]));
  assert.ok(!sameCropAnswer([500, 100, 512, 900], [500, 100, 800, 900]));
});

test("two answers that are not boxes are compared as they were written", () => {
  assert.ok(sameCropAnswer("nope", "nope"));
  assert.ok(!sameCropAnswer("nope", [1, 2, 3]));
});

test("three attempts, from the spec", () => {
  assert.equal(CROP_MAX_ATTEMPTS, 3);
});
