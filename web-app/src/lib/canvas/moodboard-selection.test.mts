import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boardSelection,
  selectedElementIds,
  selectedReferenceIds,
  selectionSignature,
} from "@/lib/canvas/moodboard-selection";
import { droppedImage } from "@/lib/canvas/moodboard-drop";
import { referenceFileId } from "@/lib/scene/moodboard-scene";

function image(id: string, referenceId: string, extra: Record<string, unknown> = {}) {
  return { id, type: "image", fileId: referenceFileId(referenceId), ...extra };
}

function selection(...ids: string[]) {
  return { selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])) };
}

test("a selection is the ids the map marks true, not every key it holds", () => {
  const appState = { selectedElementIds: { a: true, b: false, c: true } };
  assert.deepEqual(selectedElementIds(appState).sort(), ["a", "c"]);
});

test("nothing selected reads as an empty selection rather than throwing", () => {
  for (const appState of [null, undefined, "state", [], {}, { selectedElementIds: null }]) {
    assert.deepEqual(selectedElementIds(appState), [], JSON.stringify(appState));
    assert.deepEqual(boardSelection([image("e1", "ref_1")], appState), { kind: "none" });
  }
});

/// The signature exists to be compared, so the only property worth pinning is
/// that it says "same" for the same selection made in the other order.
test("the signature ignores the order elements were clicked in", () => {
  assert.equal(selectionSignature(selection("b", "a")), selectionSignature(selection("a", "b")));
  assert.notEqual(selectionSignature(selection("a")), selectionSignature(selection("a", "b")));
  assert.equal(selectionSignature(selection()), "");
});

test("selecting one reference image resolves to its reference", () => {
  const elements = [image("e1", "ref_1"), image("e2", "ref_2")];
  assert.deepEqual(boardSelection(elements, selection("e2")), {
    kind: "reference",
    referenceId: "ref_2",
  });
});

/// The same photo dropped twice is two elements and one thing to read about.
test("two copies of one reference are still a single reference selection", () => {
  const elements = [image("e1", "ref_1"), image("e2", "ref_1")];
  assert.deepEqual(boardSelection(elements, selection("e1", "e2")), {
    kind: "reference",
    referenceId: "ref_1",
  });
});

test("distinct references come back in z-order, each one once", () => {
  const elements = [image("e1", "ref_1"), image("e2", "ref_2"), image("e3", "ref_1")];
  assert.deepEqual(boardSelection(elements, selection("e3", "e2", "e1")), {
    kind: "multiple",
    referenceIds: ["ref_1", "ref_2"],
  });
});

/// A rectangle is excalidraw's business. Selecting one — or selecting it
/// alongside a reference — must not be reported as something to inspect.
test("elements that are not references are not part of the selection", () => {
  const rectangle = { id: "r1", type: "rectangle" };
  const foreign = { id: "i1", type: "image", fileId: "abc123hash" };
  const elements = [rectangle, foreign, image("e1", "ref_1")];

  assert.deepEqual(boardSelection(elements, selection("r1", "i1")), { kind: "none" });
  assert.deepEqual(boardSelection(elements, selection("r1", "e1")), {
    kind: "reference",
    referenceId: "ref_1",
  });
});

/// `onChange` reports tombstones too, and a deleted element keeps its id in the
/// scene — reading properties for a photo the user just erased would be a
/// panel about something no longer on the board.
test("a deleted element is not selectable even while its id is still marked", () => {
  const elements = [image("e1", "ref_1", { isDeleted: true }), image("e2", "ref_2")];
  assert.deepEqual(boardSelection(elements, selection("e1")), { kind: "none" });
  assert.deepEqual(boardSelection(elements, selection("e1", "e2")), {
    kind: "reference",
    referenceId: "ref_2",
  });
});

test("junk in the element array is skipped rather than resolved", () => {
  const elements = [null, 7, "element", [], { type: "image" }, image("e1", "ref_1")];
  assert.deepEqual(selectedReferenceIds(elements, selection("e1")), ["ref_1"]);
  assert.deepEqual(selectedReferenceIds("not an array", selection("e1")), []);
});

/// The link the whole surface hangs on: what the drop puts in `fileId` is what
/// the inspector reads back out. If these two ever drift, selecting a dropped
/// photo silently shows nothing.
test("an element built by the drop resolves to the reference it was dragged from", () => {
  const dropped = { id: "e1", ...droppedImage({ referenceId: "ref_9", width: 4, height: 3 }, { x: 0, y: 0 }) };
  assert.deepEqual(boardSelection([dropped], selection("e1")), {
    kind: "reference",
    referenceId: "ref_9",
  });
});
