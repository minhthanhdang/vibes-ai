import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LAYOUT_IDS,
  LAYOUT_MAX_BLOCKS,
  LAYOUT_MIN_BLOCKS,
  MOODBOARD_LAYOUTS,
  composeLayoutElements,
  fitInSlot,
  imageSlots,
  layoutBrief,
  layoutById,
  layoutForBoard,
  planAssignments,
  resolveLayout,
  seatUnplaced,
  slotFontSize,
  textSlots,
  type LayoutSlot,
  type MoodboardLayout,
} from "./moodboard-layouts";
import { referenceFileId } from "./moodboard-scene";

/// The table in tech-spec §III.4, as the test reads it: image slots, then text
/// slots. `RANDOM` resolves on the total, which is why both halves matter.
const SPEC = {
  SPLIT: { images: 2, texts: 0, page: [1920, 1080] },
  TRIPTYCH: { images: 3, texts: 0, page: [1920, 1080] },
  FILMSTRIP: { images: 4, texts: 0, page: [1920, 1080] },
  GOLDEN_RATIO: { images: 5, texts: 0, page: [2048, 2048] },
  POLAROID_SCATTER: { images: 5, texts: 1, page: [2048, 2048] },
  HERO_LEFT: { images: 5, texts: 1, page: [1920, 1080] },
  MASONRY: { images: 7, texts: 0, page: [1080, 1920] },
  EDITORIAL_SPREAD: { images: 5, texts: 2, page: [1920, 1080] },
  MOSAIC: { images: 8, texts: 0, page: [2048, 2048] },
  GRID_3X3: { images: 9, texts: 0, page: [2048, 2048] },
} as const;

function overlaps(a: LayoutSlot, b: LayoutSlot) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function layout(id: keyof typeof SPEC): MoodboardLayout {
  const found = layoutById(id);
  assert.ok(found, `${id} is missing from the table`);
  return found;
}

test("every layout in the spec table exists, at the size and slot count it says", () => {
  assert.deepEqual([...LAYOUT_IDS].sort(), Object.keys(SPEC).sort());

  for (const [id, expected] of Object.entries(SPEC)) {
    const found = layout(id as keyof typeof SPEC);
    assert.deepEqual([found.page.width, found.page.height], [...expected.page], id);
    assert.equal(imageSlots(found).length, expected.images, `${id} image slots`);
    assert.equal(textSlots(found).length, expected.texts, `${id} text slots`);
  }
});

test("slot ids are unique within a layout", () => {
  for (const found of MOODBOARD_LAYOUTS) {
    const ids = found.slots.map((slot) => slot.id);
    assert.equal(new Set(ids).size, ids.length, found.id);
  }
});

test("every slot is on the page it belongs to", () => {
  for (const found of MOODBOARD_LAYOUTS) {
    for (const slot of found.slots) {
      assert.ok(slot.width > 0 && slot.height > 0, `${found.id}/${slot.id} has no area`);
      assert.ok(slot.x >= 0 && slot.y >= 0, `${found.id}/${slot.id} starts off the page`);
      assert.ok(
        slot.x + slot.width <= found.page.width + 0.001,
        `${found.id}/${slot.id} runs off the right`,
      );
      assert.ok(
        slot.y + slot.height <= found.page.height + 0.001,
        `${found.id}/${slot.id} runs off the bottom`,
      );
    }
  }
});

/// The scatter is the one template whose photos are meant to sit on top of each
/// other; everywhere else two slots overlapping is a template that draws one
/// image over another with no way for the director to see the loser.
test("slots do not overlap, except in the scatter", () => {
  for (const found of MOODBOARD_LAYOUTS) {
    if (found.id === "POLAROID_SCATTER") continue;
    for (let i = 0; i < found.slots.length; i += 1) {
      for (let j = i + 1; j < found.slots.length; j += 1) {
        assert.ok(
          !overlaps(found.slots[i]!, found.slots[j]!),
          `${found.id}: ${found.slots[i]!.id} overlaps ${found.slots[j]!.id}`,
        );
      }
    }
  }
});

test("the mosaic is full bleed — no margin, no gutter", () => {
  const found = layout("MOSAIC");
  const area = found.slots.reduce((sum, slot) => sum + slot.width * slot.height, 0);
  assert.equal(area, found.page.width * found.page.height);
});

test("a named layout is taken as given, whatever the block count", () => {
  assert.equal(resolveLayout({ blockCount: 9, requested: "SPLIT" }).id, "SPLIT");
  assert.equal(resolveLayout({ blockCount: 2, requested: "GRID_3X3" }).id, "GRID_3X3");
});

test("RANDOM resolves by block count, clamped at both ends", () => {
  const pick = () => 0;
  assert.equal(resolveLayout({ blockCount: 3, requested: "RANDOM", pick }).id, "TRIPTYCH");
  assert.equal(resolveLayout({ blockCount: 4, pick }).id, "FILMSTRIP");
  assert.equal(resolveLayout({ blockCount: 9, pick }).id, "GRID_3X3");
  /// One photo is not a board and thirty is a contact sheet; both get the
  /// nearest template rather than a refusal.
  assert.equal(resolveLayout({ blockCount: 1, pick }).slots.length, LAYOUT_MIN_BLOCKS);
  assert.equal(resolveLayout({ blockCount: 30, pick }).slots.length, LAYOUT_MAX_BLOCKS);
  assert.equal(resolveLayout({ blockCount: Number.NaN, pick }).slots.length, LAYOUT_MIN_BLOCKS);
});

test("every count between the ends resolves to a layout of exactly that many slots", () => {
  for (let count = LAYOUT_MIN_BLOCKS; count <= LAYOUT_MAX_BLOCKS; count += 1) {
    assert.equal(resolveLayout({ blockCount: count, pick: () => 0 }).slots.length, count);
  }
});

test("the two ties break both ways, and only on chance", () => {
  assert.equal(resolveLayout({ blockCount: 6, pick: () => 0 }).id, "POLAROID_SCATTER");
  assert.equal(resolveLayout({ blockCount: 6, pick: () => 0.99 }).id, "HERO_LEFT");
  assert.equal(resolveLayout({ blockCount: 7, pick: () => 0 }).id, "MASONRY");
  assert.equal(resolveLayout({ blockCount: 7, pick: () => 0.99 }).id, "EDITORIAL_SPREAD");
});

/// A rebuild asks a different question than a new board does. `resolveLayout`
/// answers "which template suits this many blocks"; a board that already exists
/// wants "is the one it is on still good", because the director is looking at it.
const images = (count: number) => Array.from({ length: count }, () => ({ kind: "image" as const }));

test("a rebuild keeps the template the board is already on", () => {
  const kept = layoutForBoard({ stored: "GOLDEN_RATIO", blocks: images(5), pick: () => 0 });
  assert.equal(kept.layout.id, "GOLDEN_RATIO");
  assert.equal(kept.reason, "kept");

  /// Even with a slot standing empty. A board the director recognises with a gap
  /// in it beats one silently reshaped because they took a picture off.
  const shrunk = layoutForBoard({ stored: "GRID_3X3", blocks: images(4), pick: () => 0 });
  assert.equal(shrunk.layout.id, "GRID_3X3");
  assert.equal(shrunk.reason, "kept");
});

/// The case the stored template exists for: two templates hold six blocks and
/// two hold seven, so before this a rebuild that changed nothing could flip the
/// board on a coin.
test("a six-block board does not change shape on a rebuild that changed nothing", () => {
  for (const pick of [() => 0, () => 0.99]) {
    assert.equal(layoutForBoard({ stored: "HERO_LEFT", blocks: images(5), pick }).layout.id, "HERO_LEFT");
  }
});

test("a template that can no longer hold the blocks gives way, and says so", () => {
  const grown = layoutForBoard({ stored: "SPLIT", blocks: images(4), pick: () => 0 });
  assert.equal(grown.layout.id, "FILMSTRIP");
  assert.equal(grown.reason, "outgrew");
});

/// Counted per kind: a caption cannot be seated in an image slot, so a template
/// with no text slot does not hold a board that has one.
test("room is counted per kind, not on the total", () => {
  const captioned = [...images(3), { kind: "text" as const }];
  const gave = layoutForBoard({ stored: "FILMSTRIP", blocks: captioned, pick: () => 0 });
  assert.equal(gave.reason, "outgrew");
  assert.equal(gave.layout.id, "FILMSTRIP");

  const holds = layoutForBoard({ stored: "HERO_LEFT", blocks: captioned, pick: () => 0 });
  assert.equal(holds.reason, "kept");
});

test("a named template wins over the board's own, and RANDOM asks for a new one", () => {
  const named = layoutForBoard({ stored: "GRID_3X3", requested: "SPLIT", blocks: images(2) });
  assert.equal(named.layout.id, "SPLIT");
  assert.equal(named.reason, "requested");

  const rechosen = layoutForBoard({
    stored: "GRID_3X3",
    requested: "RANDOM",
    blocks: images(3),
    pick: () => 0,
  });
  assert.equal(rechosen.layout.id, "TRIPTYCH");
  assert.equal(rechosen.reason, "chosen");
});

test("a board with no template of its own is chosen for by count", () => {
  const fresh = layoutForBoard({ blocks: images(3), pick: () => 0 });
  assert.equal(fresh.layout.id, "TRIPTYCH");
  assert.equal(fresh.reason, "chosen");

  /// A board dragged together by hand has no stored template either, and a
  /// misspelt one is not a template — neither is a reason to refuse a rebuild.
  const dragged = layoutForBoard({ stored: null, blocks: images(2), pick: () => 0 });
  assert.equal(dragged.reason, "chosen");
  assert.equal(layoutForBoard({ stored: "GRID_4X4", blocks: images(2) }).reason, "chosen");
});

test("an unknown layout name is not a layout", () => {
  assert.equal(layoutById("RANDOM"), null);
  assert.equal(layoutById("GRID_4X4"), null);
  assert.equal(layoutById(undefined), null);
  /// And falls back to the count, rather than throwing at the model's spelling.
  assert.equal(resolveLayout({ blockCount: 2, requested: "SPLIT_SCREEN" }).id, "SPLIT");
});

test("the brief carries shape and share, never coordinates", () => {
  const brief = layoutBrief(layout("HERO_LEFT"));
  assert.equal(brief.layout, "HERO_LEFT");
  assert.equal(brief.page, "1920x1080");
  assert.equal(brief.slots.length, 6);

  const hero = brief.slots[0]!;
  assert.equal(hero.id, "img-1");
  assert.equal(hero.kind, "image");
  assert.equal(hero.shape, "1.12:1");
  /// The hero's share is what tells the model it is the hero.
  assert.ok(hero.share > brief.slots[1]!.share * 4);
  assert.deepEqual(Object.keys(hero).sort(), ["id", "kind", "shape", "share"]);
});

const BLOCKS = [
  { id: "ref-a", kind: "image" as const, width: 4000, height: 3000 },
  { id: "ref-b", kind: "image" as const, width: 3000, height: 4000 },
  { id: "note", kind: "text" as const, text: "act two, the hallway" },
];

test("an assignment is held against the layout and the blocks", () => {
  const plan = planAssignments(
    layout("HERO_LEFT"),
    [
      { blockId: "ref-a", slotId: "img-1" },
      { blockId: "ref-b", slotId: "img-2" },
      { blockId: "note", slotId: "text-1" },
    ],
    BLOCKS,
  );

  assert.deepEqual(
    plan.placed.map(({ slot, block }) => [block.id, slot.id]),
    [
      ["ref-a", "img-1"],
      ["ref-b", "img-2"],
      ["note", "text-1"],
    ],
  );
  assert.deepEqual(plan.unplaced, []);
  assert.deepEqual(plan.unknownBlocks, []);
  assert.deepEqual(plan.unknownSlots, []);
  assert.deepEqual(plan.mismatched, []);
});

test("ids that answer to nothing are named, not dropped", () => {
  const plan = planAssignments(
    layout("SPLIT"),
    [
      { blockId: "ref-a", slotId: "img-1" },
      { blockId: "ref-gone", slotId: "img-2" },
      { blockId: "ref-b", slotId: "img-9" },
    ],
    BLOCKS,
  );

  assert.deepEqual(plan.placed.map(({ block }) => block.id), ["ref-a"]);
  assert.deepEqual(plan.unknownBlocks, ["ref-gone"]);
  assert.deepEqual(plan.unknownSlots, ["img-9"]);
  assert.deepEqual(plan.unplaced.sort(), ["note", "ref-b"]);
});

/// Iteration 15, from a real turn: asked to add a second photograph to a
/// two-slot board, the compositor placed one and left the other off. On a
/// rebuild that is a deletion, so the room that is left is code's decision and
/// not the model's.
test("a block the compositor dropped is seated in the room that was left", () => {
  const split = layout("SPLIT");
  const plan = planAssignments(split, [{ blockId: "ref-a", slotId: "img-2" }], BLOCKS);
  const seated = seatUnplaced(split, plan, BLOCKS);

  assert.deepEqual(
    seated.placed.map(({ slot, block }) => [block.id, slot.id]),
    [
      ["ref-a", "img-2"],
      ["ref-b", "img-1"],
    ],
  );
  assert.deepEqual(seated.seated, ["ref-b"]);
  /// The text block had nowhere of its kind to go, so it is still unplaced —
  /// and still said.
  assert.deepEqual(seated.unplaced, ["note"]);
});

test("seating never puts a block in a slot of the wrong kind", () => {
  const hero = layout("HERO_LEFT");
  const plan = planAssignments(hero, [{ blockId: "ref-a", slotId: "img-1" }], BLOCKS);
  const seated = seatUnplaced(hero, plan, BLOCKS);

  for (const { slot, block } of seated.placed) assert.equal(slot.kind, block.kind);
  assert.deepEqual(seated.seated.sort(), ["note", "ref-b"]);
});

test("surplus stays unplaced — seating fills room, it does not make room", () => {
  const split = layout("SPLIT");
  const blocks = [
    ...BLOCKS.filter((block) => block.kind === "image"),
    { id: "ref-c", kind: "image" as const, width: 100, height: 100 },
  ];
  const plan = planAssignments(split, [{ blockId: "ref-a", slotId: "img-1" }], blocks);
  const seated = seatUnplaced(split, plan, blocks);

  assert.equal(seated.placed.length, 2);
  assert.deepEqual(seated.seated, ["ref-b"]);
  assert.deepEqual(seated.unplaced, ["ref-c"]);
});

test("a plan that placed nothing is not rescued into a board nobody composed", () => {
  const split = layout("SPLIT");
  const plan = planAssignments(split, [{ blockId: "ghost", slotId: "img-1" }], BLOCKS);
  const seated = seatUnplaced(split, plan, BLOCKS);

  assert.deepEqual(seated.placed, []);
  assert.deepEqual(seated.seated, []);
  assert.deepEqual(seated.unplaced.sort(), ["note", "ref-a", "ref-b"]);
});

test("a full board is left exactly as it was composed", () => {
  const split = layout("SPLIT");
  const plan = planAssignments(
    split,
    [
      { blockId: "ref-a", slotId: "img-1" },
      { blockId: "ref-b", slotId: "img-2" },
    ],
    BLOCKS,
  );
  const seated = seatUnplaced(split, plan, BLOCKS);

  assert.deepEqual(seated.placed, plan.placed);
  assert.deepEqual(seated.seated, []);
  assert.deepEqual(seated.unplaced, ["note"]);
});

test("a slot is filled once and a block is placed once — the first answer wins", () => {
  const plan = planAssignments(
    layout("TRIPTYCH"),
    [
      { blockId: "ref-a", slotId: "img-1" },
      { blockId: "ref-b", slotId: "img-1" },
      { blockId: "ref-a", slotId: "img-2" },
    ],
    BLOCKS,
  );

  assert.deepEqual(
    plan.placed.map(({ slot, block }) => [block.id, slot.id]),
    [["ref-a", "img-1"]],
  );
  assert.deepEqual(plan.unplaced.sort(), ["note", "ref-b"]);
});

test("a photograph in a text slot is a mismatch, and the slot stays empty", () => {
  const plan = planAssignments(
    layout("HERO_LEFT"),
    [
      { blockId: "ref-a", slotId: "text-1" },
      { blockId: "note", slotId: "img-1" },
    ],
    BLOCKS,
  );

  assert.deepEqual(plan.placed, []);
  assert.deepEqual(plan.mismatched.length, 2);
  assert.deepEqual(plan.unplaced.sort(), ["note", "ref-a", "ref-b"]);
});

test("leaving a block off the board is an answer, not an error", () => {
  const plan = planAssignments(
    layout("SPLIT"),
    [{ blockId: "ref-b", slotId: "img-2" }],
    BLOCKS,
  );
  assert.deepEqual(plan.placed.map(({ block }) => block.id), ["ref-b"]);
  assert.deepEqual(plan.unplaced.sort(), ["note", "ref-a"]);
  assert.deepEqual(plan.mismatched, []);
});

test("an image keeps its own shape inside the slot, centred", () => {
  const slot = { id: "img-1", kind: "image" as const, x: 100, y: 200, width: 400, height: 400 };

  const wide = fitInSlot(slot, { id: "a", kind: "image", width: 4000, height: 2000 });
  assert.deepEqual(wide, { x: 100, y: 300, width: 400, height: 200 });

  const tall = fitInSlot(slot, { id: "b", kind: "image", width: 2000, height: 4000 });
  assert.deepEqual(tall, { x: 200, y: 200, width: 200, height: 400 });
});

test("a reference with no recorded size takes the whole slot rather than a guessed shape", () => {
  const slot = { id: "img-1", kind: "image" as const, x: 0, y: 0, width: 300, height: 500 };
  assert.deepEqual(fitInSlot(slot, { id: "a", kind: "image" }), {
    x: 0,
    y: 0,
    width: 300,
    height: 500,
  });
  assert.deepEqual(fitInSlot(slot, { id: "a", kind: "image", width: 0, height: 10 }), {
    x: 0,
    y: 0,
    width: 300,
    height: 500,
  });
});

test("text is sized off its slot, within readable bounds", () => {
  assert.equal(slotFontSize({ id: "t", kind: "text", x: 0, y: 0, width: 900, height: 120 }), 72);
  assert.equal(slotFontSize({ id: "t", kind: "text", x: 0, y: 0, width: 900, height: 4 }), 12);
  assert.equal(slotFontSize({ id: "t", kind: "text", x: 0, y: 0, width: 900, height: 900 }), 96);
});

test("a plan comes out as excalidraw skeletons pointing at their references", () => {
  const plan = planAssignments(
    layout("HERO_LEFT"),
    [
      { blockId: "ref-a", slotId: "img-1" },
      { blockId: "note", slotId: "text-1" },
    ],
    BLOCKS,
  );
  const elements = composeLayoutElements(plan.placed, { x: 1000, y: 500 });

  const [image, text] = elements as unknown as Record<string, unknown>[];
  assert.ok(image && text);
  assert.equal(image.type, "image");
  assert.equal(image.fileId, referenceFileId("ref-a"));
  assert.equal(image.status, "saved");
  /// 4000×3000 contained in the 1104×984 hero, centred, and moved to the origin.
  assert.equal(image.width, 1104);
  assert.equal(image.height, 828);
  assert.equal(image.x, 1048);
  assert.equal(image.y, 626);

  assert.equal(text.type, "text");
  assert.equal(text.text, "act two, the hallway");
  assert.equal(text.fontSize, 58);
  assert.equal(text.x, 2176);
});

test("only the scatter's elements carry an angle", () => {
  const scatter = layout("POLAROID_SCATTER");
  const plan = planAssignments(
    scatter,
    [{ blockId: "ref-a", slotId: "img-1" }],
    BLOCKS,
  );
  const [tilted] = composeLayoutElements(plan.placed) as unknown as Record<string, unknown>[];
  assert.ok(tilted);
  assert.equal(tilted.angle, scatter.slots[0]!.angle);

  const straight = planAssignments(
    layout("SPLIT"),
    [{ blockId: "ref-a", slotId: "img-1" }],
    BLOCKS,
  );
  const [flat] = composeLayoutElements(straight.placed) as unknown as Record<string, unknown>[];
  assert.ok(flat);
  assert.ok(!("angle" in flat));
});
