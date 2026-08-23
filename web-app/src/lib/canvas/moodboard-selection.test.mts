import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boardSelection,
  sameSelection,
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

function page(id: string, box: { x: number; y: number; width: number; height: number }, name = "") {
  return { id, type: "frame", name, customData: { page: {} }, ...box };
}

function ground(id: string, colour: string, box: Record<string, number>) {
  return {
    id,
    type: "rectangle",
    backgroundColor: colour,
    customData: { pageBackground: true },
    ...box,
  };
}

const PAGE_BOX = { x: 0, y: 0, width: 800, height: 600 };
const ON_PAGE = { x: 100, y: 100, width: 200, height: 200 };

/// The second thing on this canvas with properties excalidraw has no notion of
/// (canvas.md §XI.4): the colour a page stands on is a locked element the
/// editor deliberately refuses to hand over, so the panel is where it is set —
/// and the panel opens on this.
test("a page selected on its own is the page, with what it stands on and what stands on it", () => {
  const elements = [
    page("p1", PAGE_BOX, "Cover"),
    ground("g1", "#0c111c", PAGE_BOX),
    image("e1", "ref_1", ON_PAGE),
  ];
  assert.deepEqual(boardSelection(elements, selection("p1")), {
    kind: "page",
    pageId: "p1",
    name: "Cover",
    background: "#0c111c",
    referenceIds: ["ref_1"],
  });
});

test("a page standing on nothing reads as a page with no background", () => {
  const elements = [page("p1", PAGE_BOX)];
  assert.deepEqual(boardSelection(elements, selection("p1")), {
    kind: "page",
    pageId: "p1",
    name: "",
    background: null,
    referenceIds: [],
  });
});

/// §V.3's membership, which is geometric: a photograph beside the page is not
/// a colour of it, however the scene has it filed.
test("only the photographs standing on the page colour it", () => {
  const elements = [
    page("p1", PAGE_BOX),
    page("p2", { x: 1000, y: 0, width: 800, height: 600 }),
    image("e1", "ref_1", ON_PAGE),
    image("e2", "ref_2", { x: 1100, y: 100, width: 200, height: 200 }),
    image("e3", "ref_1", { x: 300, y: 300, width: 100, height: 100 }),
  ];
  const chosen = boardSelection(elements, selection("p1"));
  assert.equal(chosen.kind === "page" && chosen.referenceIds.join(), "ref_1");
});

/// A photograph selected on a page is a selection about the photograph. The
/// page is what it happens to be standing on, and the panel it opens is the
/// one it has always opened.
test("a reference selected with a page is still the reference", () => {
  const elements = [page("p1", PAGE_BOX), image("e1", "ref_1", ON_PAGE)];
  assert.deepEqual(boardSelection(elements, selection("p1", "e1")), {
    kind: "reference",
    referenceId: "ref_1",
  });
});

/// The rule the selection-only export already answers by: a page picked
/// together with something else is a user asking about both, and painting one
/// of them is not the answer to that.
test("two pages, or a page and a shape, is not a page to paint", () => {
  const elements = [
    page("p1", PAGE_BOX),
    page("p2", { x: 1000, y: 0, width: 800, height: 600 }),
    { id: "r1", type: "rectangle", x: 10, y: 10, width: 10, height: 10 },
  ];
  assert.deepEqual(boardSelection(elements, selection("p1", "p2")), { kind: "none" });
  assert.deepEqual(boardSelection(elements, selection("p1", "r1")), { kind: "none" });
});

/// A section is a frame the user drew and nothing else — §V.1's whole point is
/// that promoting it is a gesture, so a panel offering to paint it would be
/// offering a page property of a thing that is not a page.
test("a section is not a page, and neither is a page the user just erased", () => {
  const section = { id: "f1", type: "frame", name: "Act one", ...PAGE_BOX };
  assert.deepEqual(boardSelection([section], selection("f1")), { kind: "none" });

  const erased = { ...page("p1", PAGE_BOX), isDeleted: true };
  assert.deepEqual(boardSelection([erased], selection("p1")), { kind: "none" });
});

/// The panel is re-derived when the scene settles as well as when the selection
/// changes, because painting a page moves neither the selection nor its
/// signature. This is what keeps that beat from re-rendering it every time —
/// and what makes the colour it just set arrive.
test("the same reading is the same selection, a repainted page is not", () => {
  const standing = [page("p1", PAGE_BOX), image("e1", "ref_1", ON_PAGE)];
  const painted = [...standing, ground("g1", "#0c111c", PAGE_BOX)];

  const before = boardSelection(standing, selection("p1"));
  assert.equal(sameSelection(before, boardSelection(standing, selection("p1"))), true);
  assert.equal(sameSelection(before, boardSelection(painted, selection("p1"))), false);
  assert.equal(sameSelection({ kind: "none" }, { kind: "none" }), true);
  assert.equal(sameSelection(before, { kind: "none" }), false);
  assert.equal(
    sameSelection(
      { kind: "multiple", referenceIds: ["ref_1", "ref_2"] },
      { kind: "multiple", referenceIds: ["ref_1"] },
    ),
    false,
  );
});
