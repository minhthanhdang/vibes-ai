import { test } from "node:test";
import assert from "node:assert/strict";

import { GRADE_PIVOT, gradeLinear, gradeModulate } from "@/lib/edit/edit-grade";
import type { GradeOp } from "@/lib/edit/edit-ops";

const grade = (knobs: Partial<Omit<GradeOp, "op">> = {}): GradeOp => ({
  op: "grade",
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  hue: 0,
  ...knobs,
});

test("a grade that turns neither contrast nor warmth needs no linear pass", () => {
  assert.equal(gradeLinear(grade({ brightness: 40, saturation: -20, hue: 10 })), null);
});

test("a grade that turns nothing but geometry knobs needs no modulate pass", () => {
  assert.equal(gradeModulate(grade({ contrast: 40, warmth: -20 })), null);
});

test("contrast pivots around mid-grey on every channel", () => {
  for (const contrast of [-100, -50, -1, 1, 25, 100]) {
    for (const warmth of [-100, 0, 60]) {
      const linear = gradeLinear(grade({ contrast, warmth }));
      assert.ok(linear);
      for (let channel = 0; channel < 3; channel += 1) {
        const held = linear.a[channel]! * GRADE_PIVOT + linear.b[channel]!;
        assert.ok(
          Math.abs(held - GRADE_PIVOT) < 1e-3,
          `channel ${channel} moved mid-grey to ${held}`,
        );
      }
    }
  }
});

test("more contrast steepens every channel by the same slope", () => {
  const linear = gradeLinear(grade({ contrast: 50 }));
  assert.deepEqual(linear?.a, [1.5, 1.5, 1.5]);
});

test("less contrast flattens rather than inverting", () => {
  const linear = gradeLinear(grade({ contrast: -100 }));
  assert.ok(linear);
  assert.ok(linear.a.every((slope) => slope > 0));
});

test("warmth lifts red and drops blue, leaving green where it was", () => {
  const warm = gradeLinear(grade({ warmth: 100 }));
  assert.ok(warm);
  assert.ok(warm.a[0] > warm.a[1] && warm.a[1] > warm.a[2]);
  assert.equal(warm.a[1], 1);

  const cool = gradeLinear(grade({ warmth: -100 }));
  assert.ok(cool);
  assert.ok(cool.a[0] < cool.a[1] && cool.a[1] < cool.a[2]);
});

test("every knob at 0 is the identity, so nothing is asked of sharp", () => {
  assert.equal(gradeLinear(grade()), null);
  assert.equal(gradeModulate(grade()), null);
});

test("saturation at its floor is exactly greyscale", () => {
  assert.deepEqual(gradeModulate(grade({ saturation: -100 })), { saturation: 0 });
});

test("brightness and hue are multiplier and degrees", () => {
  assert.deepEqual(gradeModulate(grade({ brightness: 20, hue: -45 })), {
    brightness: 1.2,
    hue: -45,
  });
});

test("brightness never goes to a flat black frame", () => {
  const modulate = gradeModulate(grade({ brightness: -100 }));
  assert.ok(modulate?.brightness);
  assert.ok(modulate.brightness > 0);
});
