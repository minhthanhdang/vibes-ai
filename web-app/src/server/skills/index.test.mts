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
/// All thirteen are written now, so this file names them: §V.2's list is the
/// contract and a fourteenth added without a line here is a skill nobody
/// reviewed against the three rules.

const skills = SKILL_NAMES.map((name) => SKILLS[name]);

test("the registry's keys are the skills' own names", () => {
  for (const name of SKILL_NAMES) assert.equal(SKILLS[name].name, name);
});

test("a skill lives in the directory it is named after (§V.1)", () => {
  for (const name of SKILL_NAMES) {
    assert.ok(existsSync(`src/server/skills/${name}/skill.ts`), `${name} has no directory`);
  }
});

test("the thirteen §V.2 names are registered, split seven and six", () => {
  assert.deepEqual(SKILL_NAMES.slice().sort(), [
    "album-designer",
    "banner-designer",
    "colour-theory",
    "composition",
    "concept-artist",
    "digital-artist",
    "environment-artist",
    "grid-systems",
    "light-and-shadow",
    "photographer",
    "typography",
    "visual-hierarchy",
    "wedding-designer",
  ]);
  assert.equal(skills.filter((skill) => skill.kind === "occupation").length, 7);
  assert.equal(skills.filter((skill) => skill.kind === "foundation").length, 6);
});

/// §V.2's split is the reason there are two kinds at all: an occupation says
/// what a *trade* does and a foundation says what *design* does, and a wedding
/// skill that re-taught colour theory would be the same six paragraphs in seven
/// files. Naming the sides here is what stops the next occupation being written
/// as a foundations digest.
test("the occupations are the trades and the foundations are the general knowledge", () => {
  const kinds = Object.fromEntries(skills.map((skill) => [skill.name, skill.kind]));
  for (const trade of [
    "wedding-designer",
    "banner-designer",
    "album-designer",
    "photographer",
    "digital-artist",
    "concept-artist",
    "environment-artist",
  ]) {
    assert.equal(kinds[trade], "occupation", trade);
  }
});

/// §V.2's catalogue column, held against the writing. A thin file passes every
/// other test here — it has a name, a kind, a summary and enough characters —
/// so the only check that catches thirteen files written in a hurry is whether
/// each one covers what its row says it covers. These are the nouns of the
/// trade, not phrasing: a rewrite that still teaches the same trade keeps them.
test("each occupation covers what its §V.2 row says it covers", () => {
  const covers: Record<string, string[]> = {
    "wedding-designer": ["invitation", "save-the-date", "welcome sign", "seating chart", "menu"],
    "banner-designer": ["leaderboard", "safe area", "call to action", "90"],
    "album-designer": ["spread", "gutter", "sequencing", "bleed"],
    photographer: ["focal length", "aperture", "depth of field", "back light", "crop"],
    "digital-artist": ["value", "edges", "saturation", "highlight"],
    "concept-artist": ["silhouette", "orthographic", "callout", "scale reference"],
    "environment-artist": ["scale", "atmospheric perspective", "foreground", "staging"],
  };
  for (const [name, words] of Object.entries(covers)) {
    const text = SKILLS[name as keyof typeof SKILLS].text.toLowerCase();
    for (const word of words) assert.ok(text.includes(word), `${name} never mentions ${word}`);
  }
});

/// The same check for the other six. The occupations had one from the day they
/// were written and the foundations never did, which is how a foundation could
/// be rewritten around one idea and lose another without a word being said.
/// `whole frame`, `row` and `foot` are here for a specific reason: the first
/// run of the fixture set (§VIII) found every design leaving the bottom of its
/// page bare, and the answer to that went into these two files as design
/// writing rather than into the instruction as a rule. Losing it should fail
/// something.
test("each foundation covers what its §V.2 row says it covers", () => {
  const covers: Record<string, string[]> = {
    "colour-theory": ["hue", "value", "saturation", "complementary", "temperature"],
    composition: ["thirds", "leading line", "balance", "negative space", "whole frame"],
    typography: ["leading", "tracking", "measure", "pairing", "x-height"],
    "visual-hierarchy": ["first", "second", "contrast", "weight", "position", "distance"],
    "light-and-shadow": ["key", "fill", "hard", "soft", "direction"],
    "grid-systems": ["column", "gutter", "module", "baseline", "margin", "row", "foot"],
  };
  for (const [name, words] of Object.entries(covers)) {
    const text = SKILLS[name as keyof typeof SKILLS].text.toLowerCase();
    for (const word of words) assert.ok(text.includes(word), `${name} never mentions ${word}`);
  }
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
  assert.equal(skillNamed("interior-designer"), undefined);
  assert.equal(isSkillName("interior-designer"), false);
  assert.equal(skillNamed("colour-theory"), SKILLS["colour-theory"]);
  assert.equal(isSkillName("colour-theory"), true);
});

/// `Object.hasOwn` rather than `in`, because `in` answers for the prototype:
/// a model asking for "toString" would be handed a function otherwise.
test("an inherited property is not a skill name", () => {
  assert.equal(isSkillName("toString"), false);
  assert.equal(skillNamed("constructor"), undefined);
});
