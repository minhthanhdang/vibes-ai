import { test } from "node:test";
import assert from "node:assert/strict";

import { designerInstruction } from "./instruction";
import { GET_SKILLS } from "./skills";
import { SKILLS, SKILL_NAMES } from "@/server/skills";

/// The system instruction is prose and no test can say whether prose works.
///
/// What is left here after the phrase-matchers went is only what can be
/// checked against something other than the wording: the tool names, which are
/// symbols the executor answers to rather than sentences, and the registry,
/// which the catalogue is built from. Everything that asserted how a paragraph
/// was worded is gone — it pinned the editing rather than the behaviour, and a
/// sentence rewritten better failed exactly as loudly as one deleted.

const instruction = designerInstruction();

/// A tool named in the prose and missing from the declarations is a round the
/// model spends calling something that is not there; a tool declared and never
/// named is one it does not know to reach for. Names rather than prose: these
/// are the strings the executor switches on.
test("every tool agent 8 holds on the three surfaces is named", () => {
  for (const tool of [
    "read_canvas",
    "put_on_canvas",
    "transform_on_canvas",
    "reorder_on_canvas",
    "restyle_on_canvas",
    "remove_from_canvas",
    "swap_on_board",
    "reword_on_board",
    "get_page",
    "duplicate_page",
    "resize_page",
    "move_to_page",
    "discard_page",
    "set_page_background",
    "list_gallery",
    "get_image",
    "get_modification",
    "discard_image",
    "get_skills",
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
  ///
  /// `swap_on_board` used to be on this list, and taking it off is the decision
  /// this file records rather than a name that slipped. Object-level editing is
  /// agent 8's (§III): a swap replaces one picture object and a reword rewrites
  /// one text object, and neither is a board or a page — which is the whole of
  /// what agent 6 interacts with now. The reasoning the old entry stood on was
  /// that agent 6 held both and agent 8 held neither, and that is what changed.
  for (const tool of [
    "add_page",
    "compose_moodboard",
    "inspect_board",
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "set_canvas_background",
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
});

/// The one census that survived as a test rather than as a sentence: every page
/// agent 8 made came out at one of the two shapes the prose used to print, and
/// what fixed it was the numbers leaving. A pattern rather than a phrase, so it
/// holds however the paragraph is rewritten.
test("no page size is given in pixels outside the one box shown as an example", () => {
  const sizes = instruction.match(/\b\d{3,4} ?x ?\d{3,4}\b/g) ?? [];
  assert.deepEqual(sizes, []);
});

/// The pin between the prose and §V's registry. The instruction names the two
/// kinds and sends the model to the catalogue; the catalogue is built from the
/// registry (§IV.5), and that middle link is what is asserted here — every name
/// the executor can answer with is a name the description offers, with its
/// summary, so a skill added to the registry is a skill the model is told about
/// without a word of the instruction changing.
test("the catalogue the instruction points at holds every skill", () => {
  for (const name of SKILL_NAMES) {
    assert.ok(GET_SKILLS.description.includes(name), `${name} is not in the catalogue`);
    assert.ok(GET_SKILLS.description.includes(SKILLS[name].summary), `${name} has no summary`);
  }
});

/// What the prose may no longer do. Forty-odd names on every round of every
/// design is the cost §II.5 refused, and the tell that somebody has put them
/// back is the ones with no business in a paragraph about two kinds.
test("the prose does not enumerate the registry", () => {
  const named = instruction.replace(/\s+/g, " ").toLowerCase();
  const enumerated = SKILL_NAMES.filter((name) =>
    named.includes(SKILLS[name].title.toLowerCase()),
  );
  assert.ok(enumerated.length < SKILL_NAMES.length / 2, `${enumerated.length} skills enumerated`);
});

test("the instruction is the same string every call", () => {
  assert.equal(designerInstruction(), instruction);
});
