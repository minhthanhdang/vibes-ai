import { test } from "node:test";
import assert from "node:assert/strict";

import { assignmentsOf, blockBrief } from "./compositor";

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
