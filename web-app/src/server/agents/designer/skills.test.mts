import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GET_SKILL,
  NO_SKILL_NAMED,
  SKILL_NOT_FOUND_NOTE,
  SKILL_STATUS,
  skillToolset,
} from "./skills";
import { SKILLS_OVER_CALL_NOTE, SKILLS_PER_CALL, skillCeilingSaid } from "@/lib/agent/designer-tools";
import { SKILL_NAMES, SKILLS, skillCatalogue } from "@/server/skills";
import { SKILL_CHAR_BUDGET } from "@/server/skills/skill";

/// Agent 8's skill door (compositor-v2.md §IV.5).
///
/// The writing itself is asserted next door in `src/server/skills` — what this
/// file holds is the door: that the enum and the catalogue come off the same
/// registry the executor answers from, that the two ceilings are reported
/// rather than silently applied (§VII), and that a call which read nothing does
/// not spend the design's one.

const read = async (skills: unknown, tools = skillToolset()) =>
  (await tools.execute({ name: "get_skill", args: { skills } }))!.result;

type Answered = { name: string; title: string; kind: string; text: string };
const answered = (result: Record<string, unknown>) => result.skills as Answered[];

test("the declaration's enum is the registry, and its description is the catalogue", () => {
  const parameters = GET_SKILL.parameters as {
    properties: { skills: { items: { enum: string[] } } };
  };

  assert.deepEqual(parameters.properties.skills.items.enum, SKILL_NAMES);
  assert.equal(parameters.properties.skills.items.enum.length, 13);
  assert.ok(GET_SKILL.description.includes(skillCatalogue()));
  for (const name of SKILL_NAMES) assert.ok(GET_SKILL.description.includes(name));
});

test("a foreign name is not this toolset's to answer", async () => {
  assert.equal(await skillToolset().execute({ name: "read_canvas", args: {} }), null);
});

test("a skill comes back whole, with the title and kind the registry carries", async () => {
  const result = await read(["typography"]);

  assert.deepEqual(answered(result).map((skill) => skill.name), ["typography"]);
  const [only] = answered(result);
  assert.equal(only.title, SKILLS["typography"].title);
  assert.equal(only.kind, "foundation");
  assert.equal(only.text, SKILLS["typography"].text);
  assert.equal(result.status, SKILL_STATUS);
});

test("no picture rides with a skill — it is text and nothing else", async () => {
  const outcome = (await skillToolset().execute({
    name: "get_skill",
    args: { skills: ["composition"] },
  }))!;

  assert.equal(outcome.pictures, undefined);
  assert.ok(!JSON.stringify(outcome.result).includes("gs://"));
});

test("every registered skill answers within the budget", async () => {
  for (const name of SKILL_NAMES) {
    const [only] = answered(await read([name]));
    assert.equal(only.name, name);
    assert.ok(only.text.length <= SKILL_CHAR_BUDGET, `${name} is ${only.text.length}`);
  }
});

test("three in one call, and the surplus is named back rather than dropped", async () => {
  const result = await read([
    "wedding-designer",
    "typography",
    "colour-theory",
    "grid-systems",
    "composition",
  ]);

  assert.equal(answered(result).length, SKILLS_PER_CALL);
  assert.deepEqual(result.notRead, ["grid-systems", "composition"]);
  assert.equal(result.notReadNote, SKILLS_OVER_CALL_NOTE);
});

test("a name the enum should have made impossible is reported, not thrown", async () => {
  const result = await read(["typography", "wedding-photographer"]);

  assert.deepEqual(answered(result).map((skill) => skill.name), ["typography"]);
  assert.deepEqual(result.notFound, ["wedding-photographer"]);
  assert.equal(result.notFoundNote, SKILL_NOT_FOUND_NOTE);
});

test("one call a design, and the refusal names what is still in front of it", async () => {
  const tools = skillToolset();
  await read(["typography", "composition"], tools);

  const again = await read(["colour-theory"], tools);
  assert.equal(again.skills, undefined);
  assert.equal(again.error, skillCeilingSaid(["typography", "composition"]));
  assert.ok((again.error as string).includes("typography, composition"));
});

test("the ceiling is per design, not per process", async () => {
  await read(["typography"]);

  const next = await read(["typography"]);
  assert.equal(answered(next).length, 1);
});

test("a call that read nothing does not spend the design's one call", async () => {
  const tools = skillToolset();

  assert.equal((await read(["not-a-skill"], tools)).error, undefined);
  assert.deepEqual((await read(["not-a-skill"], tools)).notFound, ["not-a-skill"]);

  const after = await read(["photographer"], tools);
  assert.deepEqual(answered(after).map((skill) => skill.name), ["photographer"]);
});

test("naming nothing is refused and costs nothing", async () => {
  const tools = skillToolset();

  assert.equal((await read([], tools)).error, NO_SKILL_NAMED);
  assert.equal((await read(["  "], tools)).error, NO_SKILL_NAMED);
  assert.equal((await read(undefined, tools)).error, NO_SKILL_NAMED);

  assert.deepEqual(answered(await read(["photographer"], tools)).length, 1);
});

test("a bare string is read as the one skill it names", async () => {
  assert.deepEqual(answered(await read("photographer")).map((skill) => skill.name), [
    "photographer",
  ]);
});

test("the same skill named twice is one skill and one of the three places", async () => {
  const result = await read(["typography", "typography", "composition", "grid-systems"]);

  assert.deepEqual(answered(result).map((skill) => skill.name), [
    "typography",
    "composition",
    "grid-systems",
  ]);
  assert.equal(result.notRead, undefined);
});
