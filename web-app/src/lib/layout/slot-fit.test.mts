import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SLOT_FILL_FLOOR,
  looseFits,
  nearestCropAspect,
  scenePlacements,
  slotFill,
  slotShape,
  slotShapeFor,
  standsAsComposed,
} from "@/lib/layout/slot-fit";
import type { BoardItem } from "@/lib/boards/board-contents";
import type { LayoutBlock, LayoutSlot, MoodboardLayout, Placement } from "@/lib/layout/moodboard-layouts";
import { MOODBOARD_LAYOUTS, fitInSlot, layoutById } from "@/lib/layout/moodboard-layouts";
import { CROP_ASPECTS } from "@/lib/references/reference-version";

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
  /// A picture at 2.5:1 already covers 93% of a 2.7:1 slot. The cut is held to
  /// the slot itself, so it would close the last 7% — and a photograph read for
  /// seven points of a slot is the spend `SLOT_FILL_GAIN` exists to refuse.
  const fits = looseFits([placement(slot("img-1", 2700, 1000), block("ref-1", 2500, 1000))], {
    floor: 0.99,
  });
  assert.deepEqual(fits, []);
});

test("a slot no name can close is still closed by a cut, and then left alone", () => {
  /// HERO_LEFT's supporting strips are 3.52:1 — wider than 2.39:1, the widest
  /// shape a director can *name*. The cut is held to the opening rather than to
  /// the name, so it fills it: the model is told to ask at the nearest name and
  /// the executor refines. A picture cut to the strip is then above the floor
  /// and never mentioned again, which is what stops this being a loop.
  const strip = slot("img-2", 3520, 1000);
  const first = looseFits([placement(strip, block("ref-1", 1000, 1500))]);
  assert.equal(first.length, 1);
  assert.equal(first[0].cropTo, "2.39:1");
  assert.equal(first[0].fillsCropped, 100);

  /// Cut to the nearest name and put back, it is still loose — and honestly so,
  /// since 3.52:1 closes what 2.39:1 left. Cut to the slot, it is done.
  assert.equal(looseFits([placement(strip, block("ref-1", 2390, 1000))]).length, 1);
  assert.deepEqual(looseFits([placement(strip, block("ref-1", 3520, 1000))]), []);
});

test("the floor sits above ordinary breathing room and under a real mismatch", () => {
  const threeTwoInWide = slotFill(slot("img-1", 1600, 900), block("ref-1", 3000, 2000));
  const portraitInWide = slotFill(slot("img-1", 1600, 900), block("ref-1", 2000, 3000));
  assert.ok(threeTwoInWide !== null && portraitInWide !== null);
  assert.ok(threeTwoInWide > SLOT_FILL_FLOOR);
  assert.ok(portraitInWide < SLOT_FILL_FLOOR);
});

test("every image slot in every template has a shape, and its own shape closes it", () => {
  /// The four HERO_LEFT strips are the ones no *name* closes — 3.52:1, off the
  /// wide end of the list — and they are why the cut is held to the opening
  /// rather than to the name. Recorded rather than asserted away: it is the
  /// measurement this refinement was built for.
  const unclosableByName: string[] = [];
  for (const layout of MOODBOARD_LAYOUTS) {
    for (const opening of layout.slots.filter((s) => s.kind === "image")) {
      const cropTo = nearestCropAspect(opening.width / opening.height);
      assert.ok(cropTo, `${layout.id}/${opening.id} has no nearest shape`);
      const named = slotFill(opening, { width: CROP_ASPECTS[cropTo], height: 1 });
      assert.ok(named !== null);
      if (named < 0.75) unclosableByName.push(`${layout.id}/${opening.id}`);

      /// The opening's own shape, which is what the cut is actually made to.
      /// Not quite 100% everywhere: a shape within 2% of one of the six names is
      /// said by that name and cut to it, so GOLDEN_RATIO's 1.75:1 accent is cut
      /// at 16:9. That is the whole cost of a label a director can read, and it
      /// is an order of magnitude under the gap it closes.
      const shape = slotShape(opening);
      assert.ok(shape, `${layout.id}/${opening.id} has no shape of its own`);
      const exact = slotFill(opening, { width: shape.ratio, height: 1 });
      assert.ok(exact !== null && exact > 0.97, `${layout.id}/${opening.id} is not closed by its own shape`);
    }
  }

  assert.deepEqual(unclosableByName, ["HERO_LEFT/img-2", "HERO_LEFT/img-3", "HERO_LEFT/img-4", "HERO_LEFT/img-5"]);
});

/// The way back from a board that already exists: elements in, placements out.
/// A compose has its placements in hand; a board composed an hour ago has only
/// a scene and the template it was composed at.

function seated(layout: MoodboardLayout, slotId: string, referenceId: string, size: { width: number; height: number }, moved: Partial<BoardItem> = {}): BoardItem {
  const opening = layout.slots.find((s) => s.id === slotId)!;
  const box = fitInSlot(opening, { id: referenceId, kind: "image", ...size });
  return {
    kind: "image",
    referenceId,
    text: null,
    ...box,
    ...(opening.angle ? { angle: opening.angle } : {}),
    ...moved,
  };
}

const SPLIT = layoutById("SPLIT")!;
const SCATTER = layoutById("POLAROID_SCATTER")!;

test("a picture still where the template put it is paired with the slot it is in", () => {
  const placements = scenePlacements([seated(SPLIT, "img-2", "ref-1", { width: 900, height: 1600 })], SPLIT);

  assert.equal(placements.length, 1);
  assert.equal(placements[0].slot.id, "img-2");
  assert.equal(placements[0].block.id, "ref-1");
  /// The element's own box carries the photograph's aspect ratio — a contained
  /// fit preserves it — so the fill is measurable without the reference's pixels.
  const fill = slotFill(placements[0].slot, placements[0].block);
  assert.ok(fill !== null && Math.abs(fill - slotFill(placements[0].slot, { width: 900, height: 1600 })!) < 1e-9);
});

test("a portrait sitting in a wide slot reads as loose off the scene alone", () => {
  const loose = looseFits(
    scenePlacements([seated(SPLIT, "img-1", "ref-1", { width: 1000, height: 1500 })], SPLIT),
  );

  assert.equal(loose.length, 1);
  assert.equal(loose[0].referenceId, "ref-1");
  assert.equal(loose[0].slotId, "img-1");
  assert.ok(loose[0].fillsCropped > loose[0].fills);
});

test("a picture the director dragged is not measured against the slot it has left", () => {
  const moved = seated(SPLIT, "img-1", "ref-1", { width: 1000, height: 1500 });
  assert.deepEqual(scenePlacements([{ ...moved, x: moved.x + 90 }], SPLIT), []);
});

test("a picture the director resized is their arrangement, not a fit to report", () => {
  const shrunk = seated(SPLIT, "img-1", "ref-1", { width: 1000, height: 1500 });
  assert.deepEqual(
    scenePlacements([{ ...shrunk, width: shrunk.width / 2, height: shrunk.height / 2 }], SPLIT),
    [],
  );
});

test("a tilted slot keeps its picture, and a picture turned by hand loses it", () => {
  const tilted = seated(SCATTER, "img-1", "ref-1", { width: 1000, height: 1500 });
  assert.equal(scenePlacements([tilted], SCATTER)[0]?.slot.id, "img-1");
  assert.deepEqual(scenePlacements([{ ...tilted, angle: 0.4 }], SCATTER), []);
});

test("one slot holds one picture, however many are stacked on it", () => {
  const one = seated(SPLIT, "img-1", "ref-1", { width: 1000, height: 1500 });
  const two = { ...one, referenceId: "ref-2" };
  const placements = scenePlacements([one, two], SPLIT);

  assert.equal(placements.length, 1);
  assert.equal(placements[0].block.id, "ref-1");
});

test("an image of nothing the project holds is on the board without being a placement", () => {
  const orphan = { ...seated(SPLIT, "img-1", "ref-1", { width: 1000, height: 1500 }), referenceId: null };
  assert.deepEqual(scenePlacements([orphan], SPLIT), []);
});

test("a board of two pictures reports the placements in the template's own order", () => {
  const right = seated(SPLIT, "img-2", "ref-2", { width: 1600, height: 900 });
  const left = seated(SPLIT, "img-1", "ref-1", { width: 1600, height: 900 });

  assert.deepEqual(
    scenePlacements([right, left], SPLIT).map((p) => [p.slot.id, p.block.id]),
    [["img-1", "ref-1"], ["img-2", "ref-2"]],
  );
});

/// Which name the board goes into the chat under: the template it is standing in,
/// or the page it has become.

test("a board still sitting in its slots is standing as the template composed it", () => {
  const left = seated(SPLIT, "img-1", "ref-1", { width: 1600, height: 900 });
  const right = seated(SPLIT, "img-2", "ref-2", { width: 1600, height: 900 });

  assert.equal(standsAsComposed([left, right], SPLIT), true);
});

test("one picture dragged out of its slot is an arrangement the template no longer names", () => {
  const left = seated(SPLIT, "img-1", "ref-1", { width: 1600, height: 900 });
  const right = seated(SPLIT, "img-2", "ref-2", { width: 1600, height: 900 });

  assert.equal(standsAsComposed([left, { ...right, x: right.x + 120 }], SPLIT), false);
});

test("a picture added to a full board leaves it standing in nothing", () => {
  const left = seated(SPLIT, "img-1", "ref-1", { width: 1600, height: 900 });
  const right = seated(SPLIT, "img-2", "ref-2", { width: 1600, height: 900 });
  const dropped = { ...left, referenceId: "ref-3", x: 40, y: 40, width: 300, height: 200 };

  assert.equal(standsAsComposed([left, right, dropped], SPLIT), false);
});

test("a board the director dragged together, and an empty one, are named by their page", () => {
  const loose = seated(SPLIT, "img-1", "ref-1", { width: 1600, height: 900 });

  /// No template on the row at all — the board was never composed.
  assert.equal(standsAsComposed([loose], null), false);
  /// A template and nothing standing in it.
  assert.equal(standsAsComposed([], SPLIT), false);
  assert.equal(
    standsAsComposed([{ ...loose, referenceId: null, kind: "text", text: "dawn" }], SPLIT),
    false,
  );
});

/// The opening a picture is sitting in, as the shape a cut of it is held to.

test("the shape of the opening a picture is seated in is read off the board", () => {
  const HERO = layoutById("HERO_LEFT")!;
  const found = slotShapeFor(
    [seated(HERO, "img-2", "ref-1", { width: 1000, height: 1500 })],
    HERO,
    "ref-1",
  );

  assert.equal(found?.slotId, "img-2");
  /// The strip no name on the list can close, named exactly.
  assert.equal(found?.shape.label, "3.52:1");
  assert.equal(found?.shape.ratio, 3.52);
});

test("a picture the director dragged out of its slot is in no opening", () => {
  const dragged = seated(SPLIT, "img-1", "ref-1", { width: 900, height: 1600 }, { x: 40, y: 40 });
  assert.equal(slotShapeFor([dragged], SPLIT, "ref-1"), null);
});

test("a picture that is not on the board is in no opening", () => {
  assert.equal(
    slotShapeFor([seated(SPLIT, "img-1", "ref-1", { width: 900, height: 900 })], SPLIT, "ref-2"),
    null,
  );
});

test("a tilted scatter slot still names its shape", () => {
  /// The angle is the slot's, so the picture is seated in it — and a polaroid
  /// is square, which is one of the six names rather than a measured ratio.
  const found = slotShapeFor(
    [seated(SCATTER, "img-1", "ref-1", { width: 1000, height: 1500 })],
    SCATTER,
    "ref-1",
  );
  assert.equal(found?.slotId, "img-1");
  assert.equal(found?.shape.label, "1:1");
});
