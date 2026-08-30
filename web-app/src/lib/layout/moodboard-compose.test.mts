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
  linesNotOffered,
  linesWithNoSlot,
  linesWithNoSlotNote,
  renamesOnly,
} from "@/lib/layout/moodboard-compose";
import {
  LAYOUT_MAX_TEXT_BLOCKS,
  LAYOUTS_WITH_TEXT,
  layoutById,
  planAssignments,
  type MoodboardLayout,
} from "@/lib/layout/moodboard-layouts";
import { boardPages, isPageElement } from "@/lib/pages/board-pages";
import { persistableElements, referenceFileId, sceneReferenceIds } from "@/lib/scene/moodboard-scene";

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

test("a board composed on a page is drawn inside a page frame the size of the template", () => {
  const blocks = layoutBlocks([{ id: "ref-1", width: 1000, height: 1000 }], ["Act one"]);
  const placed = placementsOn(
    HERO_LEFT,
    [
      ["ref-1", "img-1"],
      ["caption-1", "text-1"],
    ],
    blocks,
  );
  const elements = composedScene(placed, { makeId: counter(), page: HERO_LEFT.page });

  const frame = elements.at(-1)!;
  assert.ok(isPageElement(frame));
  assert.equal(frame.name, "Page 1");
  assert.deepEqual(
    [frame.x, frame.y, frame.width, frame.height],
    [0, 0, HERO_LEFT.page.width, HERO_LEFT.page.height],
  );
  assert.deepEqual(boardPages(elements).map((page) => page.preset), ["LANDSCAPE_HD"]);
});

test("every picture and every line on a composed page is a child of it, and the page is emitted last", () => {
  const blocks = layoutBlocks([{ id: "ref-1", width: 1000, height: 1000 }], ["Act one"]);
  const placed = placementsOn(
    HERO_LEFT,
    [
      ["ref-1", "img-1"],
      ["caption-1", "text-1"],
    ],
    blocks,
  );
  const elements = composedScene(placed, { makeId: counter(), page: HERO_LEFT.page });

  const frame = elements.at(-1)!;
  assert.deepEqual(
    elements.map((element) => element.type),
    ["image", "text", "frame"],
  );
  assert.deepEqual(
    elements.slice(0, -1).map((element) => element.frameId),
    [frame.id, frame.id],
  );
  assert.equal(frame.frameId, undefined);
});

test("a rebuild composed onto a page it was given keeps that page's id and name", () => {
  const blocks = layoutBlocks([{ id: "ref-1", width: 1000, height: 1000 }]);
  const placed = placementsOn(HERO_LEFT, [["ref-1", "img-1"]], blocks);
  const elements = composedScene(placed, {
    makeId: counter(),
    page: { ...HERO_LEFT.page, id: "page-7", name: "Cold open" },
  });

  const [page] = boardPages(elements);
  assert.equal(page!.id, "page-7");
  assert.equal(page!.name, "Cold open");
  assert.equal(elements[0]!.frameId, "page-7");
});

test("a composed page survives the round trip a stored scene makes", () => {
  const blocks = layoutBlocks([{ id: "ref-1", width: 1000, height: 1000 }]);
  const placed = placementsOn(HERO_LEFT, [["ref-1", "img-1"]], blocks);
  const elements = composedScene(placed, { makeId: counter(), page: HERO_LEFT.page });

  assert.deepEqual(persistableElements(elements), elements);
  assert.deepEqual(sceneReferenceIds(elements), ["ref-1"]);
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

test("a line per photograph does not become a board of lines", () => {
  const references = Array.from({ length: 10 }, (_, index) => ({ id: `ref-${index}` }));
  const captions = Array.from({ length: 10 }, (_, index) => `Line ${index}`);
  const blocks = layoutBlocks(references, captions);

  assert.equal(blocks.filter((block) => block.kind === "text").length, LAYOUT_MAX_TEXT_BLOCKS);
  assert.equal(
    blocks.filter((block) => block.kind === "image").length,
    COMPOSE_BLOCK_LIMIT - LAYOUT_MAX_TEXT_BLOCKS,
  );
});

test("the lines kept are the ones the user said first", () => {
  const blocks = layoutBlocks([{ id: "ref-1" }], ["Act one", "Act two", "Act three"]);
  assert.deepEqual(
    blocks.filter((block) => block.kind === "text").map((block) => block.text),
    ["Act one", "Act two"],
  );
});

test("the lines no template could seat are named rather than swallowed", () => {
  const captions = ["Act one", "Act two", "Act three", "Act four"];
  const blocks = layoutBlocks([{ id: "ref-1" }], captions);

  assert.deepEqual(linesNotOffered(captions, blocks), ["Act three", "Act four"]);
});

test("a line that went on is not reported as left off for a retyped capital", () => {
  const blocks = layoutBlocks([{ id: "ref-1" }], ["Act one"]);
  assert.deepEqual(linesNotOffered(["  ACT   ONE "], blocks), []);
});

test("a headline composed at a template with no text block is named as having no room", () => {
  const blocks = layoutBlocks([{ id: "ref-1" }, { id: "ref-2" }], ["Backlit dawn"]);

  assert.deepEqual(linesWithNoSlot(blocks, layoutById("TRIPTYCH")!), ["Backlit dawn"]);
  const note = linesWithNoSlotNote(layoutById("TRIPTYCH")!);
  assert.match(note, /TRIPTYCH has no text block/);
  for (const id of LAYOUTS_WITH_TEXT) assert.match(note, new RegExp(id));
});

test("a template with a text block carries the line, and the second line is over its room", () => {
  const blocks = layoutBlocks([{ id: "ref-1" }], ["Act one", "Act two"]);

  assert.deepEqual(linesWithNoSlot(blocks, layoutById("POLAROID_SCATTER")!), ["Act two"]);
  assert.deepEqual(linesWithNoSlot(blocks, layoutById("EDITORIAL_SPREAD")!), []);
});

test("a board with room for every line reports none left off", () => {
  const captions = ["Act one", "Act two"];
  assert.deepEqual(linesNotOffered(captions, layoutBlocks([{ id: "ref-1" }], captions)), []);
});

test("a reference with no recorded size still becomes a block", () => {
  const [block] = layoutBlocks([{ id: "ref-1" }]);
  assert.deepEqual(block, { id: "ref-1", kind: "image", width: null, height: null });
});

test("a board is named by what the user asked for", () => {
  assert.equal(composedBoardTitle("  low-key   hallways "), "low-key hallways");
  assert.equal(composedBoardTitle("   "), "Composed board");
  assert.equal(composedBoardTitle("x".repeat(COMPOSED_TITLE_LIMIT + 20)).length, COMPOSED_TITLE_LIMIT);
});

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

test("a removal names what it took off and what was never on", () => {
  const edit = boardSelection({ onBoard: ["a", "b", "c"], remove: ["b", "z"] });

  assert.deepEqual(edit.selection, ["a", "c"]);
  assert.deepEqual(edit.removed, ["b"]);
  assert.deepEqual(edit.notOnBoard, ["z"]);
});

test("naming referenceIds replaces the board's selection outright", () => {
  const edit = boardSelection({ onBoard: ["a", "b"], requested: ["c", "d"], add: ["e"] });

  assert.deepEqual(edit.selection, ["c", "d", "e"]);
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

test("a line is taken off by its words rather than by how they were typed", () => {
  const text = lineSelection({
    onBoard: ["Act two exteriors", "dusk, no fill"],
    remove: ["  act two   EXTERIORS "],
  });

  assert.deepEqual(text.lines, ["dusk, no fill"]);
  assert.deepEqual(text.removed, ["act two EXTERIORS"]);
  assert.deepEqual(text.notOnBoard, []);
});

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

test("a title on its own, on a board they already have, is a rename", () => {
  assert.equal(renamesOnly({ title: "Act two, exteriors" }), true);
  assert.equal(
    renamesOnly({ title: "Act two", referenceIds: [], addCaptions: ["  "] }),
    true,
  );
});

test("a call with no name in it is never a rename", () => {
  assert.equal(renamesOnly({}), false);
  assert.equal(renamesOnly({ title: "   " }), false);
  assert.equal(renamesOnly({ pageName: " " }), false);
});

test("a page name on its own is a rename too, and a page being added is not", () => {
  assert.equal(renamesOnly({ pageName: "Act two" }), true);
  assert.equal(renamesOnly({ title: "The spread", pageName: "Act two" }), true);
  assert.equal(renamesOnly({ pageName: "Act two", newPage: true }), false);
  assert.equal(renamesOnly({ pageName: "Act two", addReferenceIds: ["a"] }), false);
  assert.equal(renamesOnly({ pageName: "Act two", layout: "GRID_3X3" }), false);
});

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

test("a layout image alongside a name is a compose, not a rename", () => {
  assert.equal(renamesOnly({ title: "Act two", layoutImageId: "ref_page" }), false);
  assert.equal(renamesOnly({ pageName: "Act two", layoutImageId: "ref_page" }), false);
  assert.equal(renamesOnly({ title: "Act two", layoutImageId: "  " }), true);
});

test("a layout image alongside a picture added is a compose, not an edit in place", () => {
  assert.equal(
    changesContentsOnly({ addReferenceIds: ["c"], layoutImageId: "ref_page" }),
    false,
  );
  assert.equal(changesContentsOnly({ addReferenceIds: ["c"], layoutImageId: "" }), true);
});

test("a picture put on or taken off, and nothing else, is a change to the contents", () => {
  assert.equal(changesContentsOnly({ addReferenceIds: ["c"] }), true);
  assert.equal(changesContentsOnly({ removeReferenceIds: ["c"] }), true);
  assert.equal(changesContentsOnly({ addReferenceIds: ["c"], removeReferenceIds: ["a"] }), true);
  assert.equal(changesContentsOnly({ addReferenceIds: ["c"], captions: ["  "] }), true);
});

test("a line put on or taken off, and nothing else, is a change to the contents", () => {
  assert.equal(changesContentsOnly({ addCaptions: ["Act two"] }), true);
  assert.equal(changesContentsOnly({ removeCaptions: ["Act two"] }), true);
  assert.equal(changesContentsOnly({ addCaptions: ["Act two"], removeCaptions: ["Act one"] }), true);
  assert.equal(changesContentsOnly({ addReferenceIds: ["c"], addCaptions: ["Act two"] }), true);
});

test("a call naming nothing to put on or take off is not one", () => {
  assert.equal(changesContentsOnly({}), false);
  assert.equal(changesContentsOnly({ addReferenceIds: ["  "] }), false);
  assert.equal(changesContentsOnly({ addCaptions: ["  "] }), false);
  assert.equal(changesContentsOnly({ referenceIds: [] }), false);
});

test("anything that reopens the arrangement takes it back to the compositor", () => {
  const add = ["c"];

  assert.equal(changesContentsOnly({ addReferenceIds: add, layout: "GRID_3X3" }), false);
  assert.equal(changesContentsOnly({ addReferenceIds: add, layout: "RANDOM" }), false);
  assert.equal(changesContentsOnly({ addCaptions: ["Act two"], layout: "GRID_3X3" }), false);
  assert.equal(changesContentsOnly({ addReferenceIds: add, referenceIds: ["a"] }), false);
  assert.equal(changesContentsOnly({ addReferenceIds: add, captions: ["dusk"] }), false);
  assert.equal(changesContentsOnly({ addCaptions: ["Act two"], captions: ["dusk"] }), false);
});
