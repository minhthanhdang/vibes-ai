import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boardLayout,
  customLayoutColumns,
  layoutFromBoxes,
  pagePresetForAspect,
  storedCustomLayout,
} from "@/lib/layout/custom-layout";
import { COMPOSE_BLOCK_LIMIT } from "@/lib/layout/moodboard-compose";
import { PAGE_PRESETS, type MoodboardLayout } from "@/lib/layout/moodboard-layouts";

/// The reader's deterministic half (tech-spec §III.4): boxes in, a page and slots
/// out — or the sentence the re-prompt appends. Every fault here is one the model
/// is asked to fix, so what these assert is that each says what to do differently.

const WIDE = { width: 1920, height: 1080 };

const box = (kind: "image" | "text", ...box: unknown[]) => ({ kind, box });

const laid = (boxes: unknown, image = WIDE, composition?: string) =>
  layoutFromBoxes({ boxes, image, composition });

const faultOf = (boxes: unknown, image = WIDE) => {
  const attempt = laid(boxes, image);
  return "fault" in attempt ? attempt.fault : null;
};

const layoutOf = (boxes: unknown, image = WIDE, composition?: string) => {
  const attempt = laid(boxes, image, composition);
  assert.ok("layout" in attempt, `expected a layout, got ${JSON.stringify(attempt)}`);
  return attempt.layout;
};

test("boxes become a page of slots at the preset nearest the image's shape", () => {
  const layout = layoutOf([box("image", 100, 100, 500, 400), box("image", 100, 500, 500, 900)]);

  assert.equal(layout.id, "CUSTOM");
  assert.deepEqual(layout.page, PAGE_PRESETS.LANDSCAPE_HD);
  assert.deepEqual(
    layout.slots.map((slot) => ({ id: slot.id, kind: slot.kind })),
    [
      { id: "img-1", kind: "image" },
      { id: "img-2", kind: "image" },
    ],
  );
  /// A share of each edge of the page, not letterboxed into it: the picture that
  /// was handed in *is* the page.
  assert.deepEqual(
    { ...layout.slots[0] },
    { id: "img-1", kind: "image", x: 192, y: 108, width: 576, height: 432 },
  );
});

test("the image's aspect picks the page, by ratio rather than by difference", () => {
  assert.equal(pagePresetForAspect({ width: 1600, height: 900 }), "LANDSCAPE_HD");
  assert.equal(pagePresetForAspect({ width: 1200, height: 2000 }), "PORTRAIT_HD");
  assert.equal(pagePresetForAspect({ width: 900, height: 940 }), "SQUARE");
  /// A 4:5 page is nearer square than it is 9:16, which is what "nearest by
  /// ratio" means and what subtracting the two aspects would get wrong.
  assert.equal(pagePresetForAspect({ width: 2400, height: 3000 }), "SQUARE");
  /// A screenshot with no recorded size still has to land somewhere, and most
  /// pages handed in are wider than they are tall.
  assert.equal(pagePresetForAspect({ width: 0, height: null }), "LANDSCAPE_HD");
});

/// §V.4's rule, and the reason ids are not the order the model emitted boxes in:
/// `img-1` is the opening image to the compositor, which is told nothing about
/// where a slot sits beyond its shape and share.
test("slots are numbered in reading order — banded by y, then left to right", () => {
  const layout = layoutOf([
    box("image", 500, 100, 900, 400),
    box("image", 100, 600, 400, 900),
    box("image", 100, 100, 400, 400),
    box("text", 920, 100, 980, 900),
  ]);

  assert.deepEqual(
    layout.slots.map((slot) => [slot.id, slot.x]),
    [
      ["img-1", 192],
      ["img-2", 1152],
      ["img-3", 192],
      ["text-1", 192],
    ],
  );
  /// Numbered per kind: the text area is `text-1` even though it is read last.
  assert.equal(layout.slots.at(-1)?.kind, "text");
});

test("the reader's own line becomes the composition, and a page without one still has a sentence", () => {
  const said = layoutOf([box("image", 100, 100, 500, 900)], WIDE, "  A single full-bleed plate.  ");
  assert.equal(said.composition, "A single full-bleed plate.");

  const silent = layoutOf([box("image", 100, 100, 500, 500), box("text", 600, 100, 700, 900)]);
  assert.match(silent.composition, /1 image placeholder and 1 text area/);
});

test("an answer that is not a rectangle names the format the model is owed", () => {
  for (const answer of [[box("image", 100, 200, 800)], [box("image", 100, "x", 800, 900)]]) {
    const fault = faultOf(answer);
    assert.ok(fault);
    assert.match(fault, /\[ymin, xmin, ymax, xmax\]/);
  }
});

/// The commonest wrong answer on a layout image: the rules *around* the boxes
/// read as boxes. Named as a rule rather than as a bad rectangle, so the
/// re-prompt tells the model what it drew a box around.
test("a box too thin to hold anything is reported as a rule, with which edge", () => {
  const thin = faultOf([box("image", 500, 100, 512, 900)]);
  assert.ok(thin);
  assert.match(thin, /12\/1000 of the page's height/);
  assert.match(thin, /ruled line rather than a placeholder/);
});

test("a page with only text areas on it is refused", () => {
  const fault = faultOf([box("text", 100, 100, 200, 900), box("text", 300, 100, 400, 900)]);
  assert.ok(fault);
  assert.match(fault, /no image placeholder/);
});

test("an untagged box is told the two tags there are", () => {
  const fault = faultOf([{ box: [100, 100, 500, 500], kind: "photo" }]);
  assert.ok(fault);
  assert.match(fault, /"image".*"text"/);
});

test("a page with nothing on it, and one with more placeholders than a board holds", () => {
  assert.match(faultOf([]) ?? "", /no placeholders/);
  assert.match(faultOf("the whole page") ?? "", /no placeholders/);

  const crowded = Array.from({ length: COMPOSE_BLOCK_LIMIT + 1 }, () =>
    box("image", 100, 100, 500, 500),
  );
  const fault = faultOf(crowded);
  assert.ok(fault);
  assert.match(fault, new RegExp(`${COMPOSE_BLOCK_LIMIT + 1} placeholders`));
  assert.match(fault, new RegExp(`board holds ${COMPOSE_BLOCK_LIMIT}`));
});

test("a layout survives the round trip through the column that stores it", () => {
  const layout = layoutOf(
    [box("image", 100, 100, 500, 500), box("text", 700, 100, 800, 900)],
    { width: 2048, height: 2048 },
    "Plate above, caption under it.",
  );
  assert.deepEqual(layout.page, PAGE_PRESETS.SQUARE);

  const stored = storedCustomLayout({ layoutSlots: customLayoutColumns(layout) });
  assert.deepEqual(stored, layout);
});

test("a column that is not a whole layout reads as no layout at all", () => {
  const whole = customLayoutColumns(layoutOf([box("image", 100, 100, 500, 500)]));

  for (const broken of [
    null,
    undefined,
    "CUSTOM",
    {},
    { ...whole, page: { width: 0, height: 1080 } },
    { ...whole, slots: [] },
    { ...whole, slots: [{ ...whole.slots[0], width: -10 }] },
    { ...whole, slots: [{ ...whole.slots[0], kind: "photo" }] },
    { ...whole, slots: [{ ...whole.slots[0], id: "" }] },
    { ...whole, slots: [{ ...whole.slots[0], kind: "text" }] },
  ]) {
    assert.equal(storedCustomLayout({ layoutSlots: broken }), null, JSON.stringify(broken));
  }
  assert.equal(storedCustomLayout(null), null);
  assert.equal(storedCustomLayout({}), null);
});

test("a board resolves its own layout, template or custom", () => {
  const custom: MoodboardLayout = layoutOf([box("image", 100, 100, 500, 500)]);
  const slots = customLayoutColumns(custom);

  assert.deepEqual(boardLayout({ layout: "CUSTOM", layoutSlots: slots }), custom);
  assert.equal(boardLayout({ layout: "SPLIT", layoutSlots: slots })?.id, "SPLIT");
  assert.equal(boardLayout({ layout: null, layoutSlots: null }), null);
  /// A `CUSTOM` row whose geometry is gone is a board nobody can rebuild onto the
  /// page it was composed at — answered null, so the rebuild picks a template
  /// rather than composing onto slots that are not there.
  assert.equal(boardLayout({ layout: "CUSTOM", layoutSlots: null }), null);
  assert.equal(boardLayout(null), null);
});
