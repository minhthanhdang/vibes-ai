import { test } from "node:test";
import assert from "node:assert/strict";

import { designerInstruction } from "./instruction";
import { SKILLS, SKILL_NAMES } from "@/server/skills";

/// The system instruction is prose and no test can say whether prose works.
/// What these cases hold are the decisions inside it that a later edit could
/// undo without anybody noticing: the order §II argues for, the tools agent 8
/// has and the ones it deliberately does not, and the handful of sentences
/// that exist to head off a specific wrong move.

const instruction = designerInstruction();

const at = (phrase: string) => {
  const index = instruction.indexOf(phrase);
  assert.notEqual(index, -1, `the instruction no longer says "${phrase}"`);
  return index;
};

test("the six parts stand in the one order §II argues for", () => {
  const parts = [
    "You are the design assistant for vibes-ai",
    "A board is one unbounded canvas",
    "Pages are how designers work here",
    "The gallery is the project's pictures",
    "Before you design something, get the skill for it",
    "Work in this order:",
  ].map(at);

  for (let after = 1; after < parts.length; after += 1) {
    assert.ok(parts[after]! > parts[after - 1]!, `part ${after + 1} has moved above part ${after}`);
  }
});

test("the canvas comes before pages, because a page is described in the canvas's words", () => {
  assert.ok(at("A board is one unbounded canvas") < at("A page is a named rectangle"));
});

test("every tool agent 8 holds on the three surfaces is named", () => {
  for (const tool of [
    "read_canvas",
    "put_on_canvas",
    "transform_on_canvas",
    "reorder_on_canvas",
    "remove_from_canvas",
    "get_page",
    "duplicate_page",
    "resize_page",
    "move_to_page",
    "discard_page",
    "list_gallery",
    "get_image",
    "get_modification",
    "discard_image",
    "get_skill",
  ]) {
    assert.ok(instruction.includes(tool), `${tool} is missing from the instruction`);
  }
});

test("no tool of agent 6's that agent 8 was not given is named", () => {
  /// `add_page` is the one worth the case: it exists, it works, and it is
  /// deliberately out of this set because `put_on_canvas` with kind "page"
  /// already makes one and takes a box (§IV.2). The rest are agent 6's own
  /// vocabulary for the same acts, and naming one here would be a call the
  /// model cannot make.
  for (const tool of [
    "add_page",
    "compose_moodboard",
    "inspect_board",
    "swap_on_board",
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
  ]) {
    assert.ok(!instruction.includes(tool), `${tool} is not agent 8's to call`);
  }
});

test("the tools that make bytes are left to their own declarations", () => {
  /// §II is six parts about three surfaces; drawing and cutting are acts, and
  /// a seventh part would be paid on every round of every turn to describe two
  /// tools whose declarations already do (§IV.4).
  assert.ok(!instruction.includes("generate_image"));
  assert.ok(!instruction.includes("crop_image"));
  assert.match(instruction, /use the crop tool/);
});

test("the handle is the object and not the picture", () => {
  assert.match(instruction, /objectId — the handle/);
  assert.match(instruction, /A gallery image's id is NOT a\n  handle/);
  assert.match(instruction, /two objects with one imageId/);
});

test("the box says y first and never leaves its unit to be assumed", () => {
  assert.match(instruction, /\[ymin, xmin, ymax, xmax\], y first/);
  assert.match(instruction, /boxUnit — never assume/);
  assert.match(instruction, /z is not comparable across companies/);
});

test("the refusals are said as refusals rather than as preferences", () => {
  assert.match(instruction, /Rules that are refusals, not preferences/);
  assert.match(instruction, /Pages never rotate/);
  assert.match(instruction, /An image keeps its aspect when you resize it/);
  assert.match(instruction, /refused whole/);
  assert.match(instruction, /above\/below across two different companies is refused/);
});

test("page membership is geometric, so there is no bookkeeping call to look for", () => {
  assert.match(instruction, /an object is on the page its centre\nfalls inside/);
  assert.match(instruction, /where pages overlap, the topmost one/);
  assert.match(instruction, /There is no membership to keep in step/);
});

test("the three page presets are named by the words the tools take", () => {
  for (const preset of ["LANDSCAPE_HD 1920x1080", "PORTRAIT_HD 1080x1920", "SQUARE 2048x2048"]) {
    assert.ok(instruction.includes(preset), `${preset} is missing or misspelled`);
  }
  assert.match(instruction, /reads as Custom/);
});

test("placing a picture is a copy, and nothing on a board can lose the user one", () => {
  assert.match(instruction, /it makes a COPY/);
  assert.match(instruction, /removes the copy and leaves the gallery\nalone/);
  assert.match(instruction, /Nothing you do on a board can lose the user a picture/);
});

test("the two offers say they are offers", () => {
  assert.match(instruction, /discard_page — an offer/);
  assert.match(instruction, /discard_image, and it is an offer/);
  assert.match(instruction, /the user presses the\n  button/);
});

test("both kinds of skill are named in full, so the ask is a name and not a guess", () => {
  for (const occupation of [
    "wedding designer",
    "banner designer",
    "album designer",
    "photographer",
    "digital artist",
    "concept artist",
    "environment artist",
  ]) {
    assert.ok(instruction.includes(occupation), `the ${occupation} occupation is unnamed`);
  }
  for (const foundation of [
    "colour theory",
    "composition",
    "typography",
    "visual hierarchy",
    "light\nand shadow",
    "grid systems",
  ]) {
    assert.ok(instruction.includes(foundation), `the ${foundation} foundation is unnamed`);
  }
});

/// The pin between §II.5's prose and §V's registry. The prose is what the
/// model is told exists and the registry is what `get_skill` can answer with,
/// and a skill in one and not the other is either a name the model asks for and
/// is refused or a file nobody is told about. The registry holds all thirteen
/// now, so the pin closes both ways: the count above is the prose's list and
/// this is the registry's, and neither can grow without the other.
test("every skill the registry holds is one the instruction names", () => {
  const named = instruction.replace(/\s+/g, " ").toLowerCase();
  assert.equal(SKILL_NAMES.length, 13);
  for (const name of SKILL_NAMES) {
    assert.ok(named.includes(SKILLS[name].title.toLowerCase()), `${name} is unnamed`);
  }
});

test("a skill is knowledge, and the user outranks it", () => {
  assert.match(instruction, /A skill is knowledge, not instructions/);
  assert.match(instruction, /Where the skill and the user disagree,\nthe user is right/);
  assert.match(instruction, /Do not fetch\nthe same skill twice/);
});

test("the skill is fetched first and the second look is the last one", () => {
  assert.ok(at("1. Get the skill for the job.") < at("3. Make it."));
  assert.ok(at("3. Make it.") < at("4. Look again — get_page."));
  assert.match(instruction, /Two looks. Not five/);
  assert.match(instruction, /Never place something you have not looked at/);
});

test("the closing line names photographs by what they are and admits what did not work", () => {
  assert.match(instruction, /naming the\nphotographs by what they are and never by their ids/);
  assert.match(instruction, /The\nuser cannot see you working/);
});

test("the instruction is the same string every call", () => {
  assert.equal(designerInstruction(), instruction);
});
