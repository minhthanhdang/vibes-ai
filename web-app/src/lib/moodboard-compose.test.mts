import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMPOSE_BLOCK_LIMIT,
  COMPOSED_TITLE_LIMIT,
  boardSelection,
  changesContentsOnly,
  composedBoardTitle,
  composedScene,
  layoutBlocks,
  lineSelection,
  renamesOnly,
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

/// The model is primed with a board's id, title and page size and nothing else,
/// so an edit to what is on it has to be expressed as a change rather than as a
/// set. These are the rules that make the change safe to apply blind.

test("a picture added to a board joins the ones already on it", () => {
  const edit = boardSelection({ onBoard: ["a", "b"], add: ["c"] });

  assert.deepEqual(edit.selection, ["a", "b", "c"]);
  assert.deepEqual(edit.added, ["c"]);
  assert.deepEqual(edit.removed, []);
});

test("a picture already on the board is said so rather than placed twice", () => {
  const edit = boardSelection({ onBoard: ["a", "b"], add: ["b", "c"] });

  assert.deepEqual(edit.selection, ["a", "b", "c"]);
  assert.deepEqual(edit.added, ["c"]);
  assert.deepEqual(edit.alreadyOn, ["b"]);
});

/// An id removed that was never there is the model having meant a different
/// picture — the one thing about this path only the director can settle.
test("a removal names what it took off and what was never on", () => {
  const edit = boardSelection({ onBoard: ["a", "b", "c"], remove: ["b", "z"] });

  assert.deepEqual(edit.selection, ["a", "c"]);
  assert.deepEqual(edit.removed, ["b"]);
  assert.deepEqual(edit.notOnBoard, ["z"]);
});

test("naming referenceIds replaces the board's selection outright", () => {
  const edit = boardSelection({ onBoard: ["a", "b"], requested: ["c", "d"], add: ["e"] });

  assert.deepEqual(edit.selection, ["c", "d", "e"]);
  /// `b` is gone, but nobody asked for it to go — a replacement is not a
  /// removal, and reporting it as one would put a sentence in the reply about a
  /// picture the director never mentioned.
  assert.deepEqual(edit.removed, []);
});

test("removing everything leaves nothing, and says what it took", () => {
  const edit = boardSelection({ onBoard: ["a", "b"], remove: ["a", "b"] });

  assert.deepEqual(edit.selection, []);
  assert.deepEqual(edit.removed, ["a", "b"]);
});

test("an id both added and removed in one call ends up off the board", () => {
  const edit = boardSelection({ onBoard: ["a"], add: ["b"], remove: ["b"] });

  assert.deepEqual(edit.selection, ["a"]);
  assert.deepEqual(edit.added, []);
  assert.deepEqual(edit.removed, ["b"]);
});

test("a board's own duplicates are not two blocks", () => {
  assert.deepEqual(boardSelection({ onBoard: ["a", "a", "b"] }).selection, ["a", "b"]);
});

/// The lines of text are the same kind of set as the pictures, and were the one
/// half of a board a rebuild used to overwrite from the call alone.

test("a rebuild with no captions keeps the lines the board already carries", () => {
  const text = lineSelection({ onBoard: ["Act two exteriors", "dusk, no fill"] });

  assert.deepEqual(text.lines, ["Act two exteriors", "dusk, no fill"]);
  assert.deepEqual(text.added, []);
  assert.deepEqual(text.removed, []);
});

test("a line added joins the ones already set", () => {
  const text = lineSelection({ onBoard: ["Act two exteriors"], add: ["dusk, no fill"] });

  assert.deepEqual(text.lines, ["Act two exteriors", "dusk, no fill"]);
  assert.deepEqual(text.added, ["dusk, no fill"]);
});

/// The model quotes a line back out of `inspect_board` to say which one it
/// means, so the match has to survive a retyped capital and a doubled space.
test("a line is taken off by its words rather than by how they were typed", () => {
  const text = lineSelection({
    onBoard: ["Act two exteriors", "dusk, no fill"],
    remove: ["  act two   EXTERIORS "],
  });

  assert.deepEqual(text.lines, ["dusk, no fill"]);
  assert.deepEqual(text.removed, ["act two EXTERIORS"]);
  assert.deepEqual(text.notOnBoard, []);
});

/// A wording the board does not carry is the model quoting the director rather
/// than the board — the mistake worth a sentence, since only they can say which
/// line was meant.
test("a line taken off that was never set is named rather than swallowed", () => {
  const text = lineSelection({ onBoard: ["Act two exteriors"], remove: ["the headline"] });

  assert.deepEqual(text.lines, ["Act two exteriors"]);
  assert.deepEqual(text.removed, []);
  assert.deepEqual(text.notOnBoard, ["the headline"]);
});

test("a line already set is said so rather than set twice", () => {
  const text = lineSelection({ onBoard: ["Act two exteriors"], add: ["act two exteriors"] });

  assert.deepEqual(text.lines, ["Act two exteriors"]);
  assert.deepEqual(text.added, []);
  assert.deepEqual(text.alreadyOn, ["act two exteriors"]);
});

test("captions replace the board's lines outright without reporting a removal", () => {
  const text = lineSelection({ onBoard: ["Act two exteriors"], requested: ["Act three"] });

  assert.deepEqual(text.lines, ["Act three"]);
  assert.deepEqual(text.removed, []);
});

test("blank and repeated lines are one line each and no empty block", () => {
  const text = lineSelection({ onBoard: ["  ", "Act two", "act  two"] });

  assert.deepEqual(text.lines, ["Act two"]);
});

/// The call that has nothing for the compositor to decide. Read off the call
/// rather than off the resolved selection, which comes back full either way.
test("a title on its own, on a board they already have, is a rename", () => {
  assert.equal(renamesOnly({ title: "Act two, exteriors" }), true);
  /// Whitespace in the lists is the model sending an empty array by another
  /// name, not a change to the board.
  assert.equal(
    renamesOnly({ title: "Act two", referenceIds: [], addCaptions: ["  "] }),
    true,
  );
});

test("a call with no name in it is never a rename", () => {
  assert.equal(renamesOnly({}), false);
  assert.equal(renamesOnly({ title: "   " }), false);
});

/// Anything that changes what is on the board, or what shape it is, is a compose:
/// the assignment is open again and only the compositor can close it.
test("a name given alongside a change to the board is not a rename", () => {
  const title = "Act two, exteriors";

  assert.equal(renamesOnly({ title, layout: "GRID_3X3" }), false);
  assert.equal(renamesOnly({ title, layout: "RANDOM" }), false);
  assert.equal(renamesOnly({ title, referenceIds: ["a"] }), false);
  assert.equal(renamesOnly({ title, addReferenceIds: ["a"] }), false);
  assert.equal(renamesOnly({ title, removeReferenceIds: ["a"] }), false);
  assert.equal(renamesOnly({ title, captions: ["dusk"] }), false);
  assert.equal(renamesOnly({ title, addCaptions: ["dusk"] }), false);
  assert.equal(renamesOnly({ title, removeCaptions: ["dusk"] }), false);
});

/// The call that must not reach the compositor when the board is one the
/// director arranged by hand: a rebuild of a board with no template picks one
/// from the block count and writes it over their arrangement.
test("a picture put on or taken off, and nothing else, is a change to the contents", () => {
  assert.equal(changesContentsOnly({ addReferenceIds: ["c"] }), true);
  assert.equal(changesContentsOnly({ removeReferenceIds: ["c"] }), true);
  assert.equal(changesContentsOnly({ addReferenceIds: ["c"], removeReferenceIds: ["a"] }), true);
  /// A new name alongside is still one, because writing it is a column and not
  /// a composition.
  assert.equal(changesContentsOnly({ addReferenceIds: ["c"], captions: ["  "] }), true);
});

/// The half iteration 31 left live: a headline added to a hand-arranged board
/// reached the compositor, which had no template to reflow into and invented one.
test("a line put on or taken off, and nothing else, is a change to the contents", () => {
  assert.equal(changesContentsOnly({ addCaptions: ["Act two"] }), true);
  assert.equal(changesContentsOnly({ removeCaptions: ["Act two"] }), true);
  assert.equal(changesContentsOnly({ addCaptions: ["Act two"], removeCaptions: ["Act one"] }), true);
  /// A picture and a line in one call is still one edit.
  assert.equal(changesContentsOnly({ addReferenceIds: ["c"], addCaptions: ["Act two"] }), true);
});

test("a call naming nothing to put on or take off is not one", () => {
  assert.equal(changesContentsOnly({}), false);
  assert.equal(changesContentsOnly({ addReferenceIds: ["  "] }), false);
  assert.equal(changesContentsOnly({ addCaptions: ["  "] }), false);
  /// A rebuild with nothing named means "the ones it already has", which is a
  /// reflow rather than a change to the set.
  assert.equal(changesContentsOnly({ referenceIds: [] }), false);
});

test("anything that reopens the arrangement takes it back to the compositor", () => {
  const add = ["c"];

  assert.equal(changesContentsOnly({ addReferenceIds: add, layout: "GRID_3X3" }), false);
  assert.equal(changesContentsOnly({ addReferenceIds: add, layout: "RANDOM" }), false);
  assert.equal(changesContentsOnly({ addCaptions: ["Act two"], layout: "GRID_3X3" }), false);
  /// A set restated outright is a rebuild by definition, whichever set it is.
  assert.equal(changesContentsOnly({ addReferenceIds: add, referenceIds: ["a"] }), false);
  assert.equal(changesContentsOnly({ addReferenceIds: add, captions: ["dusk"] }), false);
  assert.equal(changesContentsOnly({ addCaptions: ["Act two"], captions: ["dusk"] }), false);
});
