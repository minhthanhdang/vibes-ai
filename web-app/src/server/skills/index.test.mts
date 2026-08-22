import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { SKILLS, SKILL_NAMES, isSkillName, skillCatalogue, skillNamed } from "./index";
import { SKILL_CHAR_BUDGET } from "./skill";

/// The registry, and §V.3's three rules held against every skill in it.
///
/// The rules are not shapes and the type cannot carry them, so they are here:
/// a skill reaches the model with the authority of a system prompt, and one
/// that tells the agent how to behave is a second, unversioned instruction that
/// only the turns which fetched it get. Review catches that in the first
/// thirteen files and not in the twentieth.
///
/// Six of the thirteen are written — §V.2's foundations. The occupations are
/// still to come, and this file asserts what is registered rather than a count,
/// so it goes on being the drift check while the catalogue fills in.

const skills = SKILL_NAMES.map((name) => SKILLS[name]);

test("the registry's keys are the skills' own names", () => {
  for (const name of SKILL_NAMES) assert.equal(SKILLS[name].name, name);
});

test("a skill lives in the directory it is named after (§V.1)", () => {
  for (const name of SKILL_NAMES) {
    assert.ok(existsSync(`src/server/skills/${name}/skill.ts`), `${name} has no directory`);
  }
});

test("the six foundations §V.2 names are registered", () => {
  assert.deepEqual(SKILL_NAMES.slice().sort(), [
    "colour-theory",
    "composition",
    "grid-systems",
    "light-and-shadow",
    "typography",
    "visual-hierarchy",
  ]);
  for (const skill of skills) assert.equal(skill.kind, "foundation");
});

test("occupations stand before foundations in the catalogue's order", () => {
  const ranks = skills.map((skill) => (skill.kind === "occupation" ? 0 : 1));
  assert.deepEqual(ranks.slice().sort(), ranks);
});

test("every skill has a title and a one-line summary", () => {
  for (const skill of skills) {
    assert.ok(skill.title.length > 0, `${skill.name} has no title`);
    assert.ok(!skill.summary.includes("\n"), `${skill.name}'s summary is more than a line`);
    assert.ok(skill.summary.length <= 140, `${skill.name}'s summary is a paragraph`);
    assert.ok(skill.summary.endsWith("."), `${skill.name}'s summary is not a sentence`);
  }
});

/// A skill is a page of writing, not a book (§IV.5). The excerpt exists for the
/// day one of them grows past this; a skill that needs it as written is one
/// that was already answering with a cut said out loud on every call.
test("no skill is written past the budget that would cut it", () => {
  for (const skill of skills) {
    assert.ok(skill.text.length <= SKILL_CHAR_BUDGET, `${skill.name} is ${skill.text.length}`);
    assert.ok(skill.text.length > 1500, `${skill.name} is a stub at ${skill.text.length}`);
  }
});

/// §V.3, first rule: no instructions to the agent. Second person is the tell —
/// prose that addresses a reader is prose telling somebody what to do, and
/// §II.6's loop discipline is the one place that is allowed to.
test("no skill addresses the agent or names it", () => {
  for (const skill of skills) {
    assert.doesNotMatch(skill.text, /\byou\b|\byour\b|\byou're\b/i, `${skill.name}`);
    assert.doesNotMatch(skill.text, /\bthe (agent|model|assistant)\b/i, `${skill.name}`);
  }
});

/// §V.3, second rule: nothing about this project. A skill is the same text for
/// every project, which is the whole reason it can be a file.
test("no skill knows what project it is in", () => {
  for (const skill of skills) {
    for (const word of ["vibes-ai", "moodboard", "gallery", "the user", "objectId", "imageId"]) {
      assert.ok(!skill.text.toLowerCase().includes(word.toLowerCase()), `${skill.name}: ${word}`);
    }
  }
});

/// §V.3, third rule: no tool names. The toolset changes and thirteen files
/// should not — a skill naming a tool is a file that goes stale the first time
/// one is renamed, and nothing would say so.
test("no skill names a tool", () => {
  const tools = [
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
    "generate_image",
    "crop_image",
    "get_skill",
    "design_page",
    "compose_moodboard",
  ];
  for (const skill of skills) {
    for (const tool of tools) assert.ok(!skill.text.includes(tool), `${skill.name}: ${tool}`);
  }
});

test("the catalogue is one line per skill, each carrying its summary (§IV.5)", () => {
  const lines = skillCatalogue().split("\n");
  assert.equal(lines.length, SKILL_NAMES.length);
  for (const [index, name] of SKILL_NAMES.entries()) {
    assert.ok(lines[index]!.startsWith(`${name} — `));
    assert.ok(lines[index]!.endsWith(SKILLS[name].summary));
  }
});

test("a name the registry does not hold is answered as unheld, not thrown at", () => {
  assert.equal(skillNamed("wedding-designer"), undefined);
  assert.equal(isSkillName("wedding-designer"), false);
  assert.equal(skillNamed("colour-theory"), SKILLS["colour-theory"]);
  assert.equal(isSkillName("colour-theory"), true);
});

/// `Object.hasOwn` rather than `in`, because `in` answers for the prototype:
/// a model asking for "toString" would be handed a function otherwise.
test("an inherited property is not a skill name", () => {
  assert.equal(isSkillName("toString"), false);
  assert.equal(skillNamed("constructor"), undefined);
});
