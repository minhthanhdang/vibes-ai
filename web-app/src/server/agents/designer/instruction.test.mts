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
    "restyle_on_canvas",
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

/// The names, not the pixels: the numbers are `RESIZE_PAGE`'s to give and the
/// reason they are no longer said here is in the comment above `PAGES` — every
/// page agent 8 has ever made came out at one of the two this paragraph used to
/// print. A preset the model has to name in a call still has to be spelled.
test("the three page presets are named by the words the tools take", () => {
  for (const preset of ["LANDSCAPE_HD", "PORTRAIT_HD", "SQUARE"]) {
    assert.ok(instruction.includes(preset), `${preset} is missing or misspelled`);
  }
  assert.match(instruction, /reads as Custom/);
});

test("no page size is given in pixels outside the one box shown as an example", () => {
  const sizes = instruction.match(/\b\d{3,4} ?x ?\d{3,4}\b/g) ?? [];
  assert.deepEqual(sizes, []);
});

/// The style dialect said in the instruction (§II.2). The declaration carries
/// the fields; what only the instruction can carry is that the silent default
/// is hand-drawn sketch lettering in near-black, which is the exact pair that
/// produced pages of photographs and hand-drawn black type on white. A model
/// reading the field list alone has no reason to set either.
test("the type defaults are said out loud — the family and the ink are both choices", () => {
  assert.match(instruction, /Type has a family and you have to choose one/);
  assert.match(instruction, /hand, sans, mono, rounded and display/);
  assert.match(instruction, /Black lettering on a dark\nphotograph is lettering nobody can read/);
});

/// The one that pays for itself: a shape is what a headline over a photograph
/// stands on, and neither way of making type readable is a call the model
/// invents from a fill field.
test("the fourth kind is named, and the two ways to make type readable over a photograph", () => {
  assert.match(instruction, /a shape — a rectangle, an ellipse or a line/);
  assert.match(instruction, /drop the photograph's opacity under the words, or lay a shape between/);
});

/// Invariant 13 at the instruction: the read now names what it cannot hand
/// over, and a model told nothing about arrows either ignores them or tries to
/// address one and spends a round on the refusal.
test("the objects with no handle are said to be there and to be the user's", () => {
  assert.match(instruction, /Some things on a board have no handle/);
  assert.match(instruction, /They are the user's/);
});

/// The tools agent 8 does not have are not advertised: a set said in the
/// instruction and missing from the declarations is a round spent calling
/// something that is not there. `restyle_on_canvas` left this list the day it
/// was built and `set_page_background` the day it was; `set_canvas_background`
/// never does, being agent 6's alone (§XI.3) — the board is the desk the user's
/// pages sit on and a design assistant handed one page does not repaint it.
test("no tool is named in the canvas block that is not in the toolset", () => {
  assert.ok(!instruction.includes("set_canvas_background"));
});

/// The other half of the same rule: a tool that is built and not named is a
/// tool the model never calls. The ground has to be said where pages are said,
/// because it is a page's and not an object's — and the trap is said with it,
/// since nothing on the page moves when it is painted.
test("the page's ground is named where pages are, with what painting one costs", () => {
  assert.match(instruction, /- set_page_background — the colour the page itself stands on/);
  assert.match(instruction, /not a rectangle you\n  draw over it/);
  assert.match(instruction, /near-black\n  lettering on a page you have just painted near-black/);
});

/// The one paragraph that departs from §II.3's wording, and the reason is in
/// the comment above `PAGES`: the spec's "Pages come at three sizes" is true of
/// `resize_page` and false of `put_on_canvas`, and a model that believes it
/// makes a banner on a 16:9 page. These cases hold the correction in place —
/// an edit restoring the spec's sentence fails all three.
test("the named sizes are said to be names rather than the only shapes a page can be", () => {
  assert.ok(!instruction.includes("Pages come at three sizes"));
  assert.match(instruction, /A page you make is the rectangle you draw/);
  assert.match(instruction, /put_on_canvas takes a box in scene\npixels and the page is exactly that box/);
});

/// A rule stated only as a principle is one the model has to invent a call to
/// obey, so the box is shown in the form `put_on_canvas` takes it and the
/// no-box default is said out loud rather than left to be discovered by a page
/// coming out the shape of the last one.
test("the page box is shown in the form put_on_canvas takes, and the default is said", () => {
  assert.match(instruction, /kind "page" with box \[0, 0, 600,\n2400\] is a 2400 by 600 strip/);
  assert.match(instruction, /Put a page with no box and it comes out the size\nof the last page on the board/);
});

test("the page's proportion is named as the model's own first decision", () => {
  assert.match(instruction, /The proportion is yours and choosing it is the first design decision on the\njob/);
  assert.match(instruction, /Decide the shape the thing is really made at and put the\npage at that box/);
});

test("resize_page is said to be the three and only the three, with the way out named", () => {
  assert.match(instruction, /resize_page — one of the three named sizes, and only those: LANDSCAPE_HD,\n  PORTRAIT_HD, SQUARE/);
  assert.match(instruction, /A shape that is not one of the\n  three is a new page put at the box you want, not a resize/);
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
