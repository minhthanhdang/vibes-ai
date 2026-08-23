import { test } from "node:test";
import assert from "node:assert/strict";

import type { ToolReference } from "@/lib/agent/shared/reference";
import { CROP_CALL_LIMIT, CROP_REFERENCE, cropCeilingSaid, DISCARD_REFERENCE, GENERATE_CALL_LIMIT, GENERATE_IMAGE, generateImageFor, generationCeilingSaid, LIST_REFERENCES, pickReferences, READ_LIMIT, READ_REFERENCES, SHOW_REFERENCES, SHOWN_LIMIT } from "@/lib/agent/orchestrator/reference-tools";
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
  /// The three that did not survive are real references, so they are not
  /// `missing` — and they were asked for, so they are not nothing either.
  assert.deepEqual(missing, []);
  assert.deepEqual(overLimit, [`ref-${SHOWN_LIMIT}`, `ref-${SHOWN_LIMIT + 1}`, `ref-${SHOWN_LIMIT + 2}`]);
});

test("an id that answers to nothing is missing rather than over the limit, wherever it was named", () => {
  const references = Array.from({ length: SHOWN_LIMIT }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  /// The ghost sits past the limit in the order it was named, and still resolves
  /// to nothing — the limit counts what was found, not what was asked.
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

/// The declaration has to agree with the executor about what leaving the field
/// out means. A description still reading "true is the only reason to call this"
/// against a default that already includes the cuts is the one disagreement that
/// costs the model a round to discover.
test("list_references offers the cuts as something to leave out, not to ask for", () => {
  const includeCrops = (
    LIST_REFERENCES.parameters.properties as Record<string, { description?: string } | undefined>
  ).includeCrops;
  assert.match(String(includeCrops?.description), /Pass false/);
  assert.equal(LIST_REFERENCES.description.includes("this is for the cuts"), false);
});

test("crop_reference takes any shape a user names, not only the usual ones", () => {
  assert.equal(CROP_REFERENCE.name, "crop_reference");
  assert.deepEqual(CROP_REFERENCE.parameters.required, ["referenceId", "intention"]);

  const properties = CROP_REFERENCE.parameters.properties as Record<
    string,
    { enum?: string[]; description?: string }
  >;
  /// Not an enum. The spec asks for "a specific ratio, or loose square/rectangle"
  /// and an enum of six is narrower than that — a user asking for 5:4 would
  /// have been answered with the nearest of six and told nothing about it.
  assert.equal(properties.aspect?.enum, undefined);
  /// The usual ones are still named, because they are what most asks are and a
  /// model given no examples invents its own spelling of them.
  for (const id of CROP_ASPECT_IDS) {
    assert.match(String(properties.aspect?.description), new RegExp(id.replace(/\./g, "\\.")));
  }
  assert.match(String(properties.aspect?.description), /5:4/);
  /// And the loose half of the same spec sentence: the words a user says
  /// when they have described a shape without naming a number. Without them the
  /// model's only way to pass "make it square" is a ratio nobody asked for.
  for (const id of LOOSE_SHAPE_IDS) {
    assert.match(String(properties.aspect?.description), new RegExp(id));
  }
  /// The board a cut is *for* is optional and stays optional: most crops are
  /// asked for a frame and not for a slot, and a required board would make the
  /// commonest ask impossible to state.
  assert.ok(properties.boardId);
  assert.ok(!CROP_REFERENCE.parameters.required?.includes("boardId"));
  /// Said in the declaration rather than only in the answer, which is where a
  /// ceiling costs nothing to enforce: the swap is made inside this call, so the
  /// model has to be told not to make it a second time.
  assert.match(String(properties.boardId?.description), /swap_on_board/);
});

/// The description is read before every call this tool ever gets, and it is the
/// one place the model learns what calling it does. It used to say the opposite
/// of what is now true — "It does not change anything", an offer "which the user
/// accepts or declines" — so a sentence left standing here is a model that files
/// a row and then asks the user whether to file it.
test("crop_reference says the cut is filed and how it goes, not that it is offered", () => {
  const said = CROP_REFERENCE.description;

  assert.match(said, /filed as a new reference of this project/);
  /// The frame, because a model reading a crop as destructive warns the user
  /// about a picture nothing happened to.
  assert.match(said, /frame it came out of is untouched/);
  /// The way out, named where the row is promised: a cut nobody wanted now costs
  /// a row rather than nothing.
  assert.match(said, /discard_reference is how a cut nobody wanted goes/);
  /// The property `generate_image` has, said where the model decides what to do
  /// next rather than left to be discovered from the answer.
  assert.match(said, /next round of this same turn/);
  /// And what did not change: the ceiling is still the reason to pick one frame.
  assert.match(said, new RegExp(`at most ${CROP_CALL_LIMIT} a turn`));

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
  /// The same three clauses a board's discard carries, for the same reason: the
  /// description is obeyed before the call, and a model that reads this as a
  /// deletion writes "I have deleted that picture" over a picture that is still
  /// there.
  assert.match(DISCARD_REFERENCE.description, /This deletes nothing/);
  assert.match(DISCARD_REFERENCE.description, /never that the picture is gone/);
  assert.match(DISCARD_REFERENCE.description, /Offer only the picture they named/);
  /// The reach the model cannot see, said where it is cheapest to say it.
  assert.match(DISCARD_REFERENCE.description, /deletes every cut made of it/);
  /// And the wrong call this one exists to be reached for instead of: taking a
  /// picture off a board is not taking it out of the project, and the free tool
  /// for that is named rather than left to be discovered by a refusal.
  assert.match(DISCARD_REFERENCE.description, /removeReferenceIds/);
});

test("generate_image says what it is for, what it costs and what it is not preferred over", () => {
  assert.equal(GENERATE_IMAGE.name, "generate_image");
  assert.deepEqual(GENERATE_IMAGE.parameters.required, ["description"]);
  assert.deepEqual(Object.keys(GENERATE_IMAGE.parameters.properties as object), [
    "description",
    "aspect",
  ]);
  /// The gallery outranks the generator: a picture somebody chose beats a
  /// picture nobody took, and the model can only weigh that if it is told.
  assert.match(GENERATE_IMAGE.description, /Prefer a picture the user actually has/);
  /// Said rather than passed off as found — the honesty clause the instruction
  /// repeats, kept here too because this is what is read at the moment of the
  /// call.
  assert.match(GENERATE_IMAGE.description, /made rather than found/);
  /// The ceiling, said the way crop_reference says its own.
  assert.match(GENERATE_IMAGE.description, new RegExp(`at most ${GENERATE_CALL_LIMIT} a turn`));
});

/// The instruction's own copy of this sentence is gated on the same count, and
/// for the same reason: on the empty project it is about pictures that do not
/// exist, and it is read at the moment of the call by the one tool that works
/// before anything has been uploaded.
test("generate_image is told to prefer a photograph of theirs only where they have one", () => {
  const empty = generateImageFor({ photographs: 0, crops: 0, boards: 0 }).description;
  assert.ok(!empty.includes("Prefer a picture the user actually has"));
  assert.ok(!empty.includes("  "));
  /// The rest of the description is unmoved — the sentence is dropped, not
  /// rewritten into something the empty project pays for instead.
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

/// The empty project's premise one step on: it drew its way out of empty, so it
/// has pictures and none of them are the user's. The instruction's copy of this
/// is chosen off the same count, and this one is the copy read at the moment of
/// the call — by the only tool whose per-turn ceiling says nothing about the
/// turn after.
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
  /// Everything else the description says is unmoved — one sentence is chosen,
  /// not the description rewritten.
  assert.match(drawn, /only tool here that makes a picture/);
  assert.match(drawn, /made rather than found/);

  /// One of theirs among the drawings is still something to prefer, and a
  /// caller that has not counted the drawings is not claiming there are none.
  assert.match(
    generateImageFor({ photographs: 2, crops: 1, boards: 0, generated: 2 }).description,
    /Prefer a picture the user actually has/,
  );
  assert.match(
    generateImageFor({ photographs: 2, crops: 0, boards: 0 }).description,
    /Prefer a picture the user actually has/,
  );

  /// And the empty project drops the sentence rather than picking the other one:
  /// it has nothing drawn to reach for either.
  const empty = generateImageFor({ photographs: 0, crops: 0, boards: 0, generated: 0 }).description;
  assert.ok(!empty.includes("Look at what you have already drawn first"));
});

/// Ungated is about the *list*; what it says is still a function of what the
/// project holds, because the reason the id is worth a round is that something
/// can place it — and which tool places it changes.
test("generate_image names the door its id goes through next, and only where it is open", () => {
  const empty = generateImageFor({ photographs: 0, crops: 0, boards: 0 }).description;
  assert.ok(!empty.includes("compose_moodboard"));
  assert.ok(!empty.includes("put_on_canvas"));
  assert.match(empty, /arrive with it, on the next round of this same turn/);

  const pictures = generateImageFor({ photographs: 3, crops: 0, boards: 0 }).description;
  assert.match(pictures, /compose_moodboard can build a board around it/);
  assert.ok(!pictures.includes("put_on_canvas"));

  const composed = generateImageFor({ photographs: 3, crops: 0, boards: 1 }).description;
  assert.match(composed, /put_on_canvas places it where the user said/);
});

test("generate_image's description parameter says the drawing model sees nothing else", () => {
  const properties = GENERATE_IMAGE.parameters.properties as Record<
    string,
    { description: string; enum?: string[] }
  >;
  /// The one failure mode of a generated prompt: a line written as if the model
  /// could see the board it is for.
  assert.match(properties.description!.description, /cannot see the project/);
  /// The aspect is crop_reference's dialect, both halves of it, listed rather
  /// than described so the model passes a value the parser reads — and named as
  /// that tool's only where that tool is declared.
  for (const id of [...CROP_ASPECT_IDS, ...LOOSE_SHAPE_IDS]) {
    assert.match(properties.aspect!.description, new RegExp(id.replace(/\./g, "\\.")));
  }
  assert.match(properties.aspect!.description, /crop_reference/);
  const alone = generateImageFor({ photographs: 0, crops: 0, boards: 0 });
  const aloneAspect = (alone.parameters.properties as Record<string, { description: string }>)
    .aspect!.description;
  assert.ok(!aloneAspect.includes("crop_reference"));
  for (const id of [...CROP_ASPECT_IDS, ...LOOSE_SHAPE_IDS]) {
    assert.match(aloneAspect, new RegExp(id.replace(/\./g, "\\.")));
  }
  /// Optional, and said as the weak choice it is: the shape of a background is
  /// the one thing about it that cannot be fixed afterwards.
  assert.match(properties.aspect!.description, /shape genuinely does not matter/);
  assert.equal(properties.aspect!.enum, undefined);
});

/// The ceiling counts calls and the sentence is about pictures, so the turn
/// where every attempt was refused is the one the wording has to survive.
test("the generation ceiling is refused in terms of what was drawn, not what was paid for", () => {
  const all = generationCeilingSaid(GENERATE_CALL_LIMIT, GENERATE_CALL_LIMIT);
  assert.match(all, new RegExp(`already made ${GENERATE_CALL_LIMIT} pictures`));
  assert.match(all, /show the user what you drew/);

  /// Nothing exists to show, so nothing is claimed to.
  const none = generationCeilingSaid(GENERATE_CALL_LIMIT, 0);
  assert.match(none, /none of them could be drawn/);
  assert.ok(!none.includes("show the user what you drew"));
  assert.ok(!none.includes("already made"));

  const some = generationCeilingSaid(2, 1);
  assert.match(some, /1 of them was drawn/);
  assert.match(some, /show the user what you did draw/);
});

/// The same reading one tool over, and the one the generation fix left standing:
/// a turn whose reads the cropper all refused holds no cut for the user to be
/// told about.
test("the crop ceiling is refused in terms of what was cut, not what was paid for", () => {
  const all = cropCeilingSaid(CROP_CALL_LIMIT, CROP_CALL_LIMIT);
  assert.match(all, new RegExp(`already filed ${CROP_CALL_LIMIT} cuts`));
  assert.match(all, /tell the user what you cut/);

  const none = cropCeilingSaid(CROP_CALL_LIMIT, 0);
  assert.match(none, /none of them could be cut/);
  assert.ok(!none.includes("tell the user what you cut"));
  assert.ok(!none.includes("already filed"));

  const some = cropCeilingSaid(2, 1);
  assert.match(some, /1 of them was filed/);
  assert.match(some, /tell the user which cuts they have/);
});

/// The ceiling is a stop, and every branch of it has to read as one. A cut is
/// filed the moment it is made, so there is nothing the user could be choosing
/// between — a question here ends the turn by handing the work back, on the one
/// turn that has already done the most work.
test("the crop ceiling asks the user nothing", () => {
  for (const said of [
    cropCeilingSaid(CROP_CALL_LIMIT, CROP_CALL_LIMIT),
    cropCeilingSaid(CROP_CALL_LIMIT, 0),
    cropCeilingSaid(2, 1),
  ]) {
    assert.doesNotMatch(said, /ask the user/i);
    assert.doesNotMatch(said, /which of them is the one/);
    assert.doesNotMatch(said, /whether that cut is the one/);
  }
});

test("read_references says what it is the only door to, and that it asks for nothing", () => {
  assert.deepEqual(READ_REFERENCES.parameters.required, ["referenceIds"]);
  /// The reason it is worth a round beside list_references, said before the call:
  /// the palette and the rationale are dropped from every digest in the layer, so
  /// this is the only door to them.
  assert.match(READ_REFERENCES.description, /only door to the palette and the reasoning/);
  /// And what it is not: it used to send pictures to be read, and a model that
  /// still reads it that way tells the user a reading is on its way that
  /// nobody asked for.
  assert.match(READ_REFERENCES.description, /Nothing is read afresh/);
  assert.match(READ_REFERENCES.description, /properties panel/);
  assert.equal(READ_REFERENCES.description.includes("in the background"), false);
  assert.match(READ_REFERENCES.description, new RegExp(`At most ${READ_LIMIT} pictures a call`));
});
