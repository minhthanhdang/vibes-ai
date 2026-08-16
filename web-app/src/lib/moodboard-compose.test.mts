import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMPOSE_BLOCK_LIMIT,
  COMPOSED_TITLE_LIMIT,
  composedBoardTitle,
  composedScene,
  layoutBlocks,
} from "./moodboard-compose";
import { layoutById, planAssignments, type MoodboardLayout } from "./moodboard-layouts";
import { persistableElements, referenceFileId, sceneReferenceIds } from "./moodboard-scene";

/// A run of ids, so a test can say which element got which without reaching for
/// randomness — the same trick `resolveLayout`'s `pick` uses.
function counter(prefix = "el") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

const HERO_LEFT = layoutById("HERO_LEFT") as MoodboardLayout;

function placementsOn(layout: MoodboardLayout, pairs: [string, string][], blocks = layoutBlocks([])) {
  return planAssignments(
    layout,
    pairs.map(([blockId, slotId]) => ({ blockId, slotId })),
    blocks,
  ).placed;
}

test("a composed element is one the board's own writer would accept", () => {
  const blocks = layoutBlocks([{ id: "ref-1", width: 1000, height: 1000 }]);
  const placed = placementsOn(HERO_LEFT, [["ref-1", "img-1"]], blocks);
  const elements = composedScene(placed, { makeId: counter() });

  assert.equal(elements.length, 1);
  assert.deepEqual(persistableElements(elements), elements);
  assert.deepEqual(sceneReferenceIds(elements), ["ref-1"]);
  assert.equal(elements[0]!.fileId, referenceFileId("ref-1"));
  assert.equal(elements[0]!.status, "saved");
});

test("text is drawn over the photographs it captions, whatever order it was assigned in", () => {
  const blocks = layoutBlocks([{ id: "ref-1", width: 1000, height: 1000 }], ["Act one"]);
  const placed = placementsOn(
    HERO_LEFT,
    [
      ["caption-1", "text-1"],
      ["ref-1", "img-1"],
    ],
    blocks,
  );
  const elements = composedScene(placed, { makeId: counter() });

  assert.deepEqual(
    elements.map((element) => element.type),
    ["image", "text"],
  );
});

test("a text block keeps the slot's width rather than shrinking to its string", () => {
  const blocks = layoutBlocks([], ["Act one"]);
  const placed = placementsOn(HERO_LEFT, [["caption-1", "text-1"]], blocks);
  const [element] = composedScene(placed, { makeId: counter() });

  const slot = HERO_LEFT.slots.find((entry) => entry.id === "text-1")!;
  assert.equal(element!.width, slot.width);
  assert.equal(element!.autoResize, false);
  assert.equal(element!.text, "Act one");
  assert.equal(element!.originalText, "Act one");
});

test("every element is given an id, because a scene is stored by id", () => {
  const blocks = layoutBlocks(
    [
      { id: "ref-1", width: 1000, height: 1000 },
      { id: "ref-2", width: 1000, height: 1000 },
    ],
    ["Act one"],
  );
  const placed = placementsOn(
    HERO_LEFT,
    [
      ["ref-1", "img-1"],
      ["ref-2", "img-2"],
      ["caption-1", "text-1"],
    ],
    blocks,
  );
  const ids = composedScene(placed, { makeId: counter() }).map((element) => element.id);

  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
});

test("a caption's id cannot be read as a slot's", () => {
  const blocks = layoutBlocks([], ["Act one", "Act two"]);
  assert.deepEqual(
    blocks.map((block) => block.id),
    ["caption-1", "caption-2"],
  );
  assert.equal(
    HERO_LEFT.slots.some((slot) => blocks.some((block) => block.id === slot.id)),
    false,
  );
});

test("blank lines are not blocks — an empty text slot is worse than no text slot", () => {
  assert.deepEqual(layoutBlocks([], ["  ", "\n", "Act one"]).length, 1);
});

test("a caption's whitespace is collapsed before it is ever set", () => {
  assert.equal(layoutBlocks([], ["  Act   one\n"])[0]!.text, "Act one");
});

test("past the block limit the photographs are dropped, never the title", () => {
  const references = Array.from({ length: COMPOSE_BLOCK_LIMIT + 4 }, (_, index) => ({
    id: `ref-${index}`,
  }));
  const blocks = layoutBlocks(references, ["Act one"]);

  assert.equal(blocks.length, COMPOSE_BLOCK_LIMIT);
  assert.equal(blocks[0]!.kind, "text");
});

test("a reference with no recorded size still becomes a block", () => {
  const [block] = layoutBlocks([{ id: "ref-1" }]);
  assert.deepEqual(block, { id: "ref-1", kind: "image", width: null, height: null });
});

test("a board is named by what the director asked for", () => {
  assert.equal(composedBoardTitle("  low-key   hallways "), "low-key hallways");
  assert.equal(composedBoardTitle("   "), "Composed board");
  assert.equal(composedBoardTitle("x".repeat(COMPOSED_TITLE_LIMIT + 20)).length, COMPOSED_TITLE_LIMIT);
});
