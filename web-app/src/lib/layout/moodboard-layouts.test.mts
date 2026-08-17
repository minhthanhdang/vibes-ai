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
  layoutOnPage,
  planAssignments,
  resolveLayout,
  seatUnplaced,
  slotFontSize,
  textSlots,
  type LayoutSlot,
  type MoodboardLayout,
} from "@/lib/layout/moodboard-layouts";
import { referenceFileId } from "@/lib/scene/moodboard-scene";

/// The table in tech-spec §III.4, as the test reads it: image slots, then text
/// slots. `RANDOM` resolves on what a template can seat per kind, which is why
/// both halves matter.
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

const images = (count: number) => Array.from({ length: count }, () => ({ kind: "image" as const }));
const lines = (count: number) => Array.from({ length: count }, () => ({ kind: "text" as const }));

test("a named layout is taken as given, whatever the blocks", () => {
  assert.equal(resolveLayout({ blocks: images(9), requested: "SPLIT" }).id, "SPLIT");
  assert.equal(resolveLayout({ blocks: images(2), requested: "GRID_3X3" }).id, "GRID_3X3");
});

test("RANDOM resolves to the tightest template that seats them, clamped at both ends", () => {
  const pick = () => 0;
  assert.equal(resolveLayout({ blocks: images(3), requested: "RANDOM", pick }).id, "TRIPTYCH");
  assert.equal(resolveLayout({ blocks: images(4), pick }).id, "FILMSTRIP");
  assert.equal(resolveLayout({ blocks: images(9), pick }).id, "GRID_3X3");
  /// One photo is not a board and thirty is a contact sheet; both get the
  /// nearest template rather than a refusal.
  assert.equal(resolveLayout({ blocks: images(1), pick }).slots.length, LAYOUT_MIN_BLOCKS);
  assert.equal(resolveLayout({ blocks: images(30), pick }).slots.length, LAYOUT_MAX_BLOCKS);
  assert.equal(resolveLayout({ blocks: [], pick }).slots.length, LAYOUT_MIN_BLOCKS);
});

test("every count of photographs between the ends gets a template with room for them", () => {
  for (let count = LAYOUT_MIN_BLOCKS; count <= LAYOUT_MAX_BLOCKS; count += 1) {
    const found = resolveLayout({ blocks: images(count), pick: () => 0 });
    assert.ok(
      imageSlots(found).length >= count,
      `${count} photographs went to ${found.id}, which has ${imageSlots(found).length} image slots`,
    );
  }
});

/// The defect this rule exists for, at the picture end: two templates hold six
/// blocks and both of them hold *five pictures and a line*, so six photographs
/// resolved by count alone landed on a template with five image slots and one of
/// them was dropped.
test("six photographs are not seated on a template with five image slots", () => {
  for (const pick of [() => 0, () => 0.99]) {
    const found = resolveLayout({ blocks: images(6), pick });
    assert.equal(found.id, "MASONRY");
    assert.ok(imageSlots(found).length >= 6);
  }
});

/// And at the text end: only three of the ten templates have a text slot at all,
/// and the smallest has six slots — so a headline on a two-picture board resolved
/// by count to a diptych that could not carry it.
test("a line of text gets a template that has somewhere to put it", () => {
  const scattered = resolveLayout({ blocks: [...images(2), ...lines(1)], pick: () => 0 });
  assert.equal(scattered.id, "POLAROID_SCATTER");
  assert.equal(textSlots(scattered).length >= 1, true);
  assert.equal(imageSlots(scattered).length >= 2, true);

  const hero = resolveLayout({ blocks: [...images(2), ...lines(1)], pick: () => 0.99 });
  assert.equal(hero.id, "HERO_LEFT");
});

/// A mix no template holds is still a board they meant: the one that seats the
/// most of it wins, and the tightest of those, so nine photographs and a headline
/// keep all nine photographs and eight keep the template with no gap in it.
test("a mix no template holds falls back to seating the most of it", () => {
  assert.equal(resolveLayout({ blocks: [...images(9), ...lines(1)], pick: () => 0 }).id, "GRID_3X3");
  assert.equal(resolveLayout({ blocks: [...images(8), ...lines(1)], pick: () => 0 }).id, "MOSAIC");
});

test("the tie the spec names breaks both ways, and only on chance", () => {
  const captioned = [...images(5), ...lines(1)];
  assert.equal(resolveLayout({ blocks: captioned, pick: () => 0 }).id, "POLAROID_SCATTER");
  assert.equal(resolveLayout({ blocks: captioned, pick: () => 0.99 }).id, "HERO_LEFT");
  /// The seven-block tie was never real — MASONRY has no text slot, so it never
  /// held the five-pictures-and-two-lines board it was tied with.
  for (const pick of [() => 0, () => 0.99]) {
    assert.equal(resolveLayout({ blocks: [...images(5), ...lines(2)], pick }).id, "EDITORIAL_SPREAD");
    assert.equal(resolveLayout({ blocks: images(7), pick }).id, "MASONRY");
  }
});

/// A rebuild asks a different question than a new board does. `resolveLayout`
/// answers "which template seats these blocks"; a board that already exists
/// wants "is the one it is on still good", because the director is looking at it.

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
  /// And it gives way to a template that can carry the line. This test used to
  /// assert FILMSTRIP here — the board outgrew its template and was handed the
  /// same one back, because the replacement was picked on the count of four and
  /// no four-slot template has a text slot.
  assert.equal(gave.layout.id, "POLAROID_SCATTER");
  assert.ok(textSlots(gave.layout).length >= 1);

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

/// A board laid out from a layout image stores `CUSTOM`, which names no
/// template this file can look up — so the caller resolves the row's geometry
/// and hands the layout in whole. Kept on exactly the terms a template's is,
/// which is the whole point: a page the director drew survives "add the
/// stairwell" rather than being replaced by a nine-up grid.
test("a rebuild keeps a custom layout handed in already resolved", () => {
  const drawn: MoodboardLayout = {
    id: "CUSTOM",
    page: { width: 1920, height: 1080 },
    composition: "two openings side by side with a line under them",
    slots: [
      { id: "img-1", kind: "image", x: 0, y: 0, width: 900, height: 800 },
      { id: "img-2", kind: "image", x: 960, y: 0, width: 900, height: 800 },
      { id: "text-1", kind: "text", x: 0, y: 860, width: 1860, height: 120 },
    ],
  };

  const kept = layoutForBoard({ stored: drawn, blocks: [...images(2), ...lines(1)] });
  assert.equal(kept.reason, "kept");
  assert.equal(kept.layout, drawn);

  /// Room, not identity: the page the director drew has two openings on it, so a
  /// third photograph is a board it cannot hold and a template takes over.
  const outgrew = layoutForBoard({ stored: drawn, blocks: images(3), pick: () => 0 });
  assert.equal(outgrew.reason, "outgrew");
  assert.equal(outgrew.layout.id, "TRIPTYCH");

  /// And RANDOM overrides it exactly as it overrides a template: "choose me a
  /// new one" is an ask, not a mistake.
  const rechosen = layoutForBoard({ stored: drawn, requested: "RANDOM", blocks: images(2) });
  assert.equal(rechosen.reason, "chosen");
  assert.notEqual(rechosen.layout.id, "CUSTOM");
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
  /// And falls back to the blocks, rather than throwing at the model's spelling.
  assert.equal(resolveLayout({ blocks: images(2), requested: "SPLIT_SCREEN" }).id, "SPLIT");
});

test("a page the template's own size gets the template back untouched", () => {
  const hero = layout("HERO_LEFT");
  assert.equal(layoutOnPage(hero, hero.page), hero);
  /// Which is every board in this app that nobody has resized — the fit is
  /// identity there, not merely equal.
  assert.equal(layoutOnPage(hero, { width: 1920, height: 1080 }), hero);
});

test("a template drawn on a bigger page of the same shape is the same arrangement, scaled", () => {
  const hero = layout("HERO_LEFT");
  const drawn = layoutOnPage(hero, { width: 3840, height: 2160 });

  assert.deepEqual(drawn.page, { width: 3840, height: 2160 });
  assert.equal(drawn.id, hero.id);
  for (const [index, slot] of drawn.slots.entries()) {
    const cut = hero.slots[index]!;
    assert.deepEqual(
      [slot.x, slot.y, slot.width, slot.height],
      [cut.x * 2, cut.y * 2, cut.width * 2, cut.height * 2],
      slot.id,
    );
  }
});

/// The shape is what the compositor is briefed with and what a cut is held to, so
/// a fit that stretched the slots would make every number in the brief a lie
/// about the opening it names.
test("a template fitted to a page of another shape keeps every slot's shape, centred in what is left", () => {
  const hero = layout("HERO_LEFT");
  const drawn = layoutOnPage(hero, { width: 1920, height: 2160 });

  for (const [index, slot] of drawn.slots.entries()) {
    const cut = hero.slots[index]!;
    assert.equal(slot.width, cut.width, slot.id);
    assert.equal(slot.height, cut.height, slot.id);
    /// Scale 1 across, so the leftover height is shared above and below.
    assert.equal(slot.x, cut.x, slot.id);
    assert.equal(slot.y, cut.y + 540, slot.id);
  }
  /// And every slot is still on the page it is drawn on.
  for (const slot of drawn.slots) {
    assert.ok(slot.x >= 0 && slot.y >= 0, slot.id);
    assert.ok(slot.x + slot.width <= 1920 && slot.y + slot.height <= 2160, slot.id);
  }
});

test("a rectangle with no area is not a page, and the template is handed back", () => {
  const hero = layout("HERO_LEFT");
  assert.equal(layoutOnPage(hero, { width: 0, height: 1080 }), hero);
  assert.equal(layoutOnPage(hero, { width: 1920, height: -10 }), hero);
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
