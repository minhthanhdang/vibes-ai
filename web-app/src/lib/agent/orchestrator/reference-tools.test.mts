import { test } from "node:test";
import assert from "node:assert/strict";

import type { ToolReference } from "@/lib/agent/shared/reference";
import { EDIT_CALL_LIMIT, EDIT_REFERENCE, editCeilingSaid, DISCARD_REFERENCE, GENERATE_CALL_LIMIT, GENERATE_IMAGE, generateImageFor, generationCeilingSaid, LIST_REFERENCES, pickReferences, READ_LIMIT, READ_REFERENCES, SHOW_REFERENCES, SHOWN_LIMIT } from "@/lib/agent/orchestrator/reference-tools";
import { CROP_ASPECT_IDS, LOOSE_SHAPE_IDS } from "@/lib/references/reference-version";

function reference(overrides: Partial<ToolReference> = {}): ToolReference {
  return {
    id: "ref-1",
    title: "Hallway",
    width: 1920,
    height: 1080,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
    ...overrides,
  };
}

test("named references come back in the order they were named", () => {
  const references = [reference({ id: "a" }), reference({ id: "b" }), reference({ id: "c" })];
  const { found, missing } = pickReferences(references, ["c", "a"]);

  assert.deepEqual(
    found.map((entry) => entry.id),
    ["c", "a"],
  );
  assert.deepEqual(missing, []);
});

test("an id that answers to nothing is reported, not dropped", () => {
  const { found, missing } = pickReferences([reference({ id: "a" })], ["a", "ghost"]);
  assert.deepEqual(
    found.map((entry) => entry.id),
    ["a"],
  );
  assert.deepEqual(missing, ["ghost"]);
});

test("a reference named twice in one call is shown once", () => {
  const { found } = pickReferences([reference({ id: "a" })], ["a", "a"]);
  assert.equal(found.length, 1);
});

test("a call naming more pictures than the chat has room for is cut to the limit, and says which", () => {
  const references = Array.from({ length: SHOWN_LIMIT + 3 }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const { found, missing, overLimit } = pickReferences(
    references,
    references.map((entry) => entry.id),
  );
  assert.equal(found.length, SHOWN_LIMIT);
  assert.deepEqual(missing, []);
  assert.deepEqual(overLimit, [`ref-${SHOWN_LIMIT}`, `ref-${SHOWN_LIMIT + 1}`, `ref-${SHOWN_LIMIT + 2}`]);
});

test("an id that answers to nothing is missing rather than over the limit, wherever it was named", () => {
  const references = Array.from({ length: SHOWN_LIMIT }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const { found, missing, overLimit } = pickReferences(references, [
    ...references.map((entry) => entry.id),
    "ghost",
  ]);
  assert.equal(found.length, SHOWN_LIMIT);
  assert.deepEqual(missing, ["ghost"]);
  assert.deepEqual(overLimit, []);
});

test("the declarations name themselves as the model is told to call them", () => {
  assert.equal(LIST_REFERENCES.name, "list_references");
  assert.equal(SHOW_REFERENCES.name, "show_references");
  assert.deepEqual(SHOW_REFERENCES.parameters.required, ["referenceIds"]);
});

test("list_references offers the cuts as something to leave out, not to ask for", () => {
  const includeCrops = (
    LIST_REFERENCES.parameters.properties as Record<string, { description?: string } | undefined>
  ).includeCrops;
  assert.match(String(includeCrops?.description), /Pass false/);
  assert.equal(LIST_REFERENCES.description.includes("this is for the cuts"), false);
});

test("edit_reference takes any shape a user names, not only the usual ones", () => {
  assert.equal(EDIT_REFERENCE.name, "edit_reference");
  assert.deepEqual(EDIT_REFERENCE.parameters.required, ["referenceId", "intention"]);

  const properties = EDIT_REFERENCE.parameters.properties as Record<
    string,
    { enum?: string[]; description?: string }
  >;
  assert.equal(properties.aspect?.enum, undefined);
  for (const id of CROP_ASPECT_IDS) {
    assert.match(String(properties.aspect?.description), new RegExp(id.replace(/\./g, "\\.")));
  }
  assert.match(String(properties.aspect?.description), /5:4/);
  for (const id of LOOSE_SHAPE_IDS) {
    assert.match(String(properties.aspect?.description), new RegExp(id));
  }
  assert.ok(properties.boardId);
  assert.ok(!EDIT_REFERENCE.parameters.required?.includes("boardId"));
  assert.match(String(properties.boardId?.description), /the exchange is already made/);
  assert.ok(!String(properties.boardId?.description).includes("swap_on_board"));
});

test("edit_reference says the version is filed and how it goes, not that it is offered", () => {
  const said = EDIT_REFERENCE.description;

  assert.match(said, /filed as a new reference of this project/);
  assert.match(said, /picture it came out of is untouched/);
  assert.match(said, /discard_reference is how a version nobody wanted goes/);
  assert.match(said, /next round of this same turn/);
  assert.match(said, new RegExp(`at most ${EDIT_CALL_LIMIT} a turn`));

  for (const offered of [
    "It does not change anything",
    "an offer drawn on the frame",
    "accepts or declines",
  ]) {
    assert.ok(!said.includes(offered), `the model is still told “${offered}”`);
  }
});

test("discard_reference offers rather than deletes, and routes the board case away", () => {
  assert.equal(DISCARD_REFERENCE.name, "discard_reference");
  assert.deepEqual(DISCARD_REFERENCE.parameters.required, ["referenceId"]);
  assert.deepEqual(Object.keys(DISCARD_REFERENCE.parameters.properties as object), ["referenceId"]);
  assert.match(DISCARD_REFERENCE.description, /This deletes nothing/);
  assert.match(DISCARD_REFERENCE.description, /never that the picture is gone/);
  assert.match(DISCARD_REFERENCE.description, /Offer only the picture they named/);
  assert.match(DISCARD_REFERENCE.description, /deletes every cut made of it/);
  assert.match(DISCARD_REFERENCE.description, /design_page is the call for it/);
});

test("generate_image says what it is for, what it costs and what it is not preferred over", () => {
  assert.equal(GENERATE_IMAGE.name, "generate_image");
  assert.deepEqual(GENERATE_IMAGE.parameters.required, ["description"]);
  assert.deepEqual(Object.keys(GENERATE_IMAGE.parameters.properties as object), [
    "description",
    "aspect",
  ]);
  assert.match(GENERATE_IMAGE.description, /Prefer a picture the user actually has/);
  assert.match(GENERATE_IMAGE.description, /made rather than found/);
  assert.match(GENERATE_IMAGE.description, new RegExp(`at most ${GENERATE_CALL_LIMIT} a turn`));
});

test("generate_image is told to prefer a photograph of theirs only where they have one", () => {
  const empty = generateImageFor({ photographs: 0, crops: 0, boards: 0 }).description;
  assert.ok(!empty.includes("Prefer a picture the user actually has"));
  assert.ok(!empty.includes("  "));
  assert.match(empty, /only tool here that makes a picture/);
  assert.match(empty, /made rather than found/);

  for (const state of [
    { photographs: 1, crops: 0, boards: 0 },
    { photographs: 0, crops: 1, boards: 0 },
  ]) {
    assert.match(
      generateImageFor({ ...state, boards: 0 }).description,
      /Prefer a picture the user actually has/,
      JSON.stringify(state),
    );
  }
});

test("generate_image is steered to reuse its own drawings where they are all there is", () => {
  const drawn = generateImageFor({
    photographs: 2,
    crops: 0,
    boards: 0,
    generated: 2,
  }).description;

  assert.ok(!drawn.includes("Prefer a picture the user actually has"));
  assert.ok(!drawn.includes("  "));
  assert.match(drawn, /Look at what you have already drawn first/);
  assert.match(drawn, /comes back a different picture/);
  assert.match(drawn, /only tool here that makes a picture/);
  assert.match(drawn, /made rather than found/);

  assert.match(
    generateImageFor({ photographs: 2, crops: 1, boards: 0, generated: 2 }).description,
    /Prefer a picture the user actually has/,
  );
  assert.match(
    generateImageFor({ photographs: 2, crops: 0, boards: 0 }).description,
    /Prefer a picture the user actually has/,
  );

  const empty = generateImageFor({ photographs: 0, crops: 0, boards: 0, generated: 0 }).description;
  assert.ok(!empty.includes("Look at what you have already drawn first"));
});

test("generate_image names the door its id goes through next, and only where it is open", () => {
  const empty = generateImageFor({ photographs: 0, crops: 0, boards: 0 }).description;
  assert.ok(!empty.includes("design_page"));
  assert.ok(!empty.includes("put_on_canvas"));
  assert.match(empty, /arrive with it, on the next round of this same turn/);

  const pictures = generateImageFor({ photographs: 3, crops: 0, boards: 0 }).description;
  assert.match(pictures, /add_board makes a board to put it on/);
  assert.ok(!pictures.includes("put_on_canvas"));

  const composed = generateImageFor({ photographs: 3, crops: 0, boards: 1 }).description;
  assert.match(composed, /design_page puts it where the user said/);
  assert.ok(!composed.includes("put_on_canvas"));
});

test("generate_image's description parameter says the drawing model sees nothing else", () => {
  const properties = GENERATE_IMAGE.parameters.properties as Record<
    string,
    { description: string; enum?: string[] }
  >;
  assert.match(properties.description!.description, /cannot see the project/);
  for (const id of [...CROP_ASPECT_IDS, ...LOOSE_SHAPE_IDS]) {
    assert.match(properties.aspect!.description, new RegExp(id.replace(/\./g, "\\.")));
  }
  assert.match(properties.aspect!.description, /edit_reference/);
  const alone = generateImageFor({ photographs: 0, crops: 0, boards: 0 });
  const aloneAspect = (alone.parameters.properties as Record<string, { description: string }>)
    .aspect!.description;
  assert.ok(!aloneAspect.includes("edit_reference"));
  for (const id of [...CROP_ASPECT_IDS, ...LOOSE_SHAPE_IDS]) {
    assert.match(aloneAspect, new RegExp(id.replace(/\./g, "\\.")));
  }
  assert.match(properties.aspect!.description, /shape genuinely does not matter/);
  assert.equal(properties.aspect!.enum, undefined);
});

test("the generation ceiling is refused in terms of what was drawn, not what was paid for", () => {
  const all = generationCeilingSaid(GENERATE_CALL_LIMIT, GENERATE_CALL_LIMIT);
  assert.match(all, new RegExp(`already made ${GENERATE_CALL_LIMIT} pictures`));
  assert.match(all, /show the user what you drew/);

  const none = generationCeilingSaid(GENERATE_CALL_LIMIT, 0);
  assert.match(none, /none of them could be drawn/);
  assert.ok(!none.includes("show the user what you drew"));
  assert.ok(!none.includes("already made"));

  const some = generationCeilingSaid(2, 1);
  assert.match(some, /1 of them was drawn/);
  assert.match(some, /show the user what you did draw/);
});

test("the edit ceiling is refused in terms of what was made, not what was paid for", () => {
  const all = editCeilingSaid(EDIT_CALL_LIMIT, EDIT_CALL_LIMIT);
  assert.match(all, new RegExp(`already filed ${EDIT_CALL_LIMIT} edits`));
  assert.match(all, /tell the user what you did/);

  const none = editCeilingSaid(EDIT_CALL_LIMIT, 0);
  assert.match(none, /none of them could be made/);
  assert.ok(!none.includes("tell the user what you did"));
  assert.ok(!none.includes("already filed"));

  const some = editCeilingSaid(2, 1);
  assert.match(some, /1 of them was filed/);
  assert.match(some, /tell the user which pictures they have/);
});

test("the crop ceiling asks the user nothing", () => {
  for (const said of [
    editCeilingSaid(EDIT_CALL_LIMIT, EDIT_CALL_LIMIT),
    editCeilingSaid(EDIT_CALL_LIMIT, 0),
    editCeilingSaid(2, 1),
  ]) {
    assert.doesNotMatch(said, /ask the user/i);
    assert.doesNotMatch(said, /which of them is the one/);
    assert.doesNotMatch(said, /whether that cut is the one/);
  }
});

test("read_references says what it is the only door to, and that it asks for nothing", () => {
  assert.deepEqual(READ_REFERENCES.parameters.required, ["referenceIds"]);
  assert.match(READ_REFERENCES.description, /only door to the palette and the reasoning/);
  assert.match(READ_REFERENCES.description, /Nothing is read afresh/);
  assert.match(READ_REFERENCES.description, /properties panel/);
  assert.equal(READ_REFERENCES.description.includes("in the background"), false);
  assert.match(READ_REFERENCES.description, new RegExp(`At most ${READ_LIMIT} pictures a call`));
});
