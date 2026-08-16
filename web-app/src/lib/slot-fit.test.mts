import { test } from "node:test";
import assert from "node:assert/strict";

import { SLOT_FILL_FLOOR, looseFits, nearestCropAspect, slotFill } from "./slot-fit";
import type { LayoutBlock, LayoutSlot, Placement } from "./moodboard-layouts";
import { MOODBOARD_LAYOUTS } from "./moodboard-layouts";
import { CROP_ASPECTS } from "./reference-version";

function slot(id: string, width: number, height: number, kind: "image" | "text" = "image"): LayoutSlot {
  return { id, kind, x: 0, y: 0, width, height };
}

function block(id: string, width: number | null, height: number | null): LayoutBlock {
  return { id, kind: "image", width, height };
}

function placement(s: LayoutSlot, b: LayoutBlock): Placement {
  return { slot: s, block: b };
}

test("a picture at its slot's own shape fills all of it", () => {
  assert.equal(slotFill(slot("img-1", 1600, 900), block("ref-1", 3200, 1800)), 1);
});

test("a portrait in a wide slot covers the share of it the two shapes allow", () => {
  /// 2:3 in a 16:9 slot: the picture is scaled to the slot's height and covers
  /// (2/3) / (16/9) of its area.
  const fill = slotFill(slot("img-1", 1600, 900), block("ref-1", 2000, 3000));
  assert.ok(fill !== null);
  assert.ok(Math.abs(fill - (2 / 3) / (16 / 9)) < 1e-9);
});

test("fill is the same whichever way round the mismatch runs", () => {
  const wideInTall = slotFill(slot("a", 900, 1600), block("ref-1", 1600, 900));
  const tallInWide = slotFill(slot("b", 1600, 900), block("ref-1", 900, 1600));
  assert.deepEqual(wideInTall, tallInWide);
});

test("a picture whose size was never recorded has no fill to measure", () => {
  assert.equal(slotFill(slot("img-1", 1600, 900), block("ref-1", null, null)), null);
  assert.equal(slotFill(slot("img-1", 1600, 900), block("ref-1", 1600, 0)), null);
});

test("the nearest shape to a slot is one the director can ask a crop to be", () => {
  assert.equal(nearestCropAspect(16 / 9), "16:9");
  assert.equal(nearestCropAspect(1), "1:1");
  assert.equal(nearestCropAspect(0.55), "9:16");
  assert.equal(nearestCropAspect(3), "2.39:1");
  assert.equal(nearestCropAspect(0), null);
});

test("nearest is measured multiplicatively, not by subtraction", () => {
  /// The geometric mean of 4:3 and 1:1 is 1.1547. Linearly it sits nearer 4:3
  /// (0.179 vs 0.155), so a subtraction here would answer the wrong one.
  const mean = Math.sqrt((4 / 3) * 1);
  assert.equal(nearestCropAspect(mean * 1.001), "4:3");
  assert.equal(nearestCropAspect(mean * 0.999), "1:1");
});

test("a board whose pictures fit their slots reports nothing", () => {
  const fits = looseFits([
    placement(slot("img-1", 1600, 900), block("ref-1", 3840, 2160)),
    placement(slot("img-2", 1600, 900), block("ref-2", 1500, 1000)),
  ]);
  assert.deepEqual(fits, []);
});

test("a portrait in a wide slot is named with the cut that would close the gap", () => {
  const [loose, ...rest] = looseFits([
    placement(slot("img-1", 1600, 900), block("ref-1", 2000, 3000)),
  ]);

  assert.deepEqual(rest, []);
  assert.equal(loose.referenceId, "ref-1");
  assert.equal(loose.slotId, "img-1");
  assert.equal(loose.cropTo, "16:9");
  assert.equal(loose.fills, 38);
  assert.equal(loose.fillsCropped, 100);
});

test("the worst fit is named first", () => {
  const fits = looseFits([
    placement(slot("img-1", 1600, 900), block("ref-1", 1000, 1400)),
    placement(slot("img-2", 1600, 900), block("ref-2", 1000, 3000)),
  ]);

  assert.deepEqual(
    fits.map((fit) => fit.referenceId),
    ["ref-2", "ref-1"],
  );
});

test("a text slot is not a fit anybody can crop", () => {
  assert.deepEqual(
    looseFits([
      placement(slot("text-1", 1600, 200, "text"), { id: "caption-1", kind: "text", text: "Act two" }),
    ]),
    [],
  );
});

test("a picture with no recorded size is left alone rather than guessed at", () => {
  assert.deepEqual(looseFits([placement(slot("img-1", 1600, 900), block("ref-1", null, null))]), []);
});

test("a cut that would not fit better than the picture already does is not offered", () => {
  /// A slot at 2.7:1 is off the wide end of the list, so the nearest shape is
  /// 2.39:1. A picture already at 2.5:1 covers more of that slot than the cut
  /// would, and suggesting it would buy a photograph read for a worse board.
  const fits = looseFits([placement(slot("img-1", 2700, 1000), block("ref-1", 2500, 1000))], {
    floor: 0.99,
  });
  assert.deepEqual(fits, []);
});

test("a slot no shape can close is offered its cut once and not again", () => {
  /// HERO_LEFT's supporting strips are 3.52:1 — wider than 2.39:1, the widest
  /// shape a crop can be asked to be. A portrait in one is worth cutting; the
  /// cut of it is not worth cutting again, or every rebuild of that board would
  /// offer the same crop of the same picture forever.
  const strip = slot("img-2", 3520, 1000);
  const first = looseFits([placement(strip, block("ref-1", 1000, 1500))]);
  assert.equal(first.length, 1);
  assert.equal(first[0].cropTo, "2.39:1");
  assert.ok(first[0].fillsCropped < 80);

  assert.deepEqual(looseFits([placement(strip, block("ref-1", 2390, 1000))]), []);
});

test("the floor sits above ordinary breathing room and under a real mismatch", () => {
  const threeTwoInWide = slotFill(slot("img-1", 1600, 900), block("ref-1", 3000, 2000));
  const portraitInWide = slotFill(slot("img-1", 1600, 900), block("ref-1", 2000, 3000));
  assert.ok(threeTwoInWide !== null && portraitInWide !== null);
  assert.ok(threeTwoInWide > SLOT_FILL_FLOOR);
  assert.ok(portraitInWide < SLOT_FILL_FLOOR);
});

test("every image slot in every template names a shape a crop can be asked to be", () => {
  /// And that shape all but closes it, everywhere except HERO_LEFT's supporting
  /// column: those strips are 3.52:1, off the wide end of the list, so the best
  /// reachable cut still leaves page showing. Recorded rather than asserted
  /// away, because it is what `SLOT_FILL_GAIN` exists to stop being a loop.
  const unclosable: string[] = [];
  for (const layout of MOODBOARD_LAYOUTS) {
    for (const opening of layout.slots.filter((s) => s.kind === "image")) {
      const cropTo = nearestCropAspect(opening.width / opening.height);
      assert.ok(cropTo, `${layout.id}/${opening.id} has no nearest shape`);
      const fill = slotFill(opening, { width: CROP_ASPECTS[cropTo], height: 1 });
      assert.ok(fill !== null);
      if (fill < 0.75) unclosable.push(`${layout.id}/${opening.id}`);
    }
  }

  assert.deepEqual(unclosable, ["HERO_LEFT/img-2", "HERO_LEFT/img-3", "HERO_LEFT/img-4", "HERO_LEFT/img-5"]);
});
