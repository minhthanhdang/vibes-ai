import { test } from "node:test";
import assert from "node:assert/strict";

import { assignmentsOf, blockBrief, pageBrief } from "./compositor";

/// The pairs are read out of whatever the model emitted, so this is the same
/// question `pickReferences` asks of `show_references` ids: what of this answer
/// is usable, and is a bad entry worth failing the whole board over. It is not —
/// what survives is held against the layout afterwards, and that is where a
/// missing slot gets reported.
test("assignments are read out of the model's answer, malformed entries dropped", () => {
  assert.deepEqual(
    assignmentsOf([
      { blockId: "ref-a", slotId: "img-1" },
      { blockId: " ref-b ", slotId: " img-2 " },
      { blockId: "ref-c" },
      { slotId: "img-4" },
      { blockId: "", slotId: "img-5" },
      { blockId: "ref-d", slotId: 6 },
      "img-7",
      null,
    ]),
    [
      { blockId: "ref-a", slotId: "img-1" },
      { blockId: "ref-b", slotId: "img-2" },
    ],
  );
});

test("an answer that is not a list of pairs is no assignment at all", () => {
  assert.deepEqual(assignmentsOf(undefined), []);
  assert.deepEqual(assignmentsOf("img-1"), []);
  assert.deepEqual(assignmentsOf({ blockId: "ref-a", slotId: "img-1" }), []);
});

/// A brief is what the model is charged for, so an absent field is absent
/// rather than null: `"keeps": null` on forty blocks is tokens spent saying
/// nothing.
test("a block brief carries only what it has", () => {
  assert.deepEqual(blockBrief({ id: "ref-a", kind: "image" }), { id: "ref-a", kind: "image" });

  assert.deepEqual(
    blockBrief({ id: "ref-a", kind: "image", shape: "16:9", keeps: "the hands", tags: ["warm"] }),
    { id: "ref-a", kind: "image", shape: "16:9", keeps: "the hands", tags: ["warm"] },
  );

  assert.deepEqual(blockBrief({ id: "ref-a", kind: "image", tags: [] }), {
    id: "ref-a",
    kind: "image",
  });
});

/// Words on an image block are not a caption the board would draw — they are a
/// text block's own content, and carrying them on a photograph would have the
/// compositor reading a title as something to set in type.
test("only a text block carries its words", () => {
  assert.deepEqual(blockBrief({ id: "note", kind: "text", text: "act two" }), {
    id: "note",
    kind: "text",
    text: "act two",
  });
  assert.deepEqual(blockBrief({ id: "ref-a", kind: "image", text: "act two" }), {
    id: "ref-a",
    kind: "image",
  });
});

/// tech-spec §V: agent 4 lays out one page of a board, and the line it ends with
/// is read out to the user. Told which page it is on, that line can name it
/// as they do rather than talking about a board they have four pages of.
test("a page brief names the page and where it falls in the board", () => {
  assert.deepEqual(pageBrief({ name: "Act two", ordinal: 2, of: 3, board: "Cold open" }), {
    name: "Act two",
    page: "2 of 3",
    board: "Cold open",
  });
});

/// The numbering is the whole of what a page nobody has named has — and it is
/// what the user would call it too, so an empty name is left off rather than
/// sent as one.
test("an unnamed page is a numbering and nothing else", () => {
  assert.deepEqual(pageBrief({ name: "  ", ordinal: 1, of: 2 }), { page: "1 of 2" });
  assert.deepEqual(pageBrief({ ordinal: 1, of: 2, board: "   " }), { page: "1 of 2" });
});

/// A page the board did not have has nothing on it, so every block given is a
/// block that goes on it — the one thing the compositor cannot work out from the
/// free slots, since a page being laid out again arrives looking the same.
test("a page of its own is marked fresh", () => {
  assert.deepEqual(pageBrief({ name: "Page 3", ordinal: 3, of: 3, fresh: true }), {
    name: "Page 3",
    page: "3 of 3",
    fresh: true,
  });
  assert.equal("fresh" in pageBrief({ name: "Page 3", ordinal: 3, of: 3, fresh: false }), false);
});
