import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GET_SKILLS,
  NO_SKILL_NAMED,
  SKILL_NOT_FOUND_NOTE,
  skillStatusSaid,
  skillToolset,
} from "./skills";
import { SKILLS_ALREADY_READ_NOTE } from "@/lib/agent/designer/skill-tools";
import { SKILL_NAMES, SKILLS, skillCatalogue } from "@/server/skills";
import { SKILL_CHAR_BUDGET } from "@/server/skills/skill";

/// Agent 8's skill door (compositor-v2.md §IV.5).
///
/// The writing itself is asserted next door in `src/server/skills` — what this
/// file holds is the door: that the enum and the catalogue come off the same
/// registry the executor answers from, that nothing counts the names, and that
/// the ledger the run row is written from is what really reached the model.

const read = async (skills: unknown, tools = skillToolset()) =>
  (await tools.execute({ name: "get_skills", args: { skills } }))!.result;

type Answered = { name: string; title: string; kind: string; text: string };
const answered = (result: Record<string, unknown>) => result.skills as Answered[];
const namesIn = (result: Record<string, unknown>) => answered(result).map((skill) => skill.name);

test("the declaration's enum is the registry, and its description is the catalogue", () => {
  const parameters = GET_SKILLS.parameters as {
    properties: { skills: { items: { enum: string[] } } };
  };

  assert.deepEqual(parameters.properties.skills.items.enum, SKILL_NAMES);
  assert.equal(parameters.properties.skills.items.enum.length, SKILL_NAMES.length);
  assert.ok(GET_SKILLS.description.includes(skillCatalogue()));
  for (const name of SKILL_NAMES) assert.ok(GET_SKILLS.description.includes(name));
});

test("a foreign name is not this toolset's to answer", async () => {
  assert.equal(await skillToolset().execute({ name: "read_canvas", args: {} }), null);
});

test("a skill comes back whole, with the title and kind the registry carries", async () => {
  const result = await read(["typography"]);

  assert.deepEqual(namesIn(result), ["typography"]);
  const [only] = answered(result);
  assert.equal(only.title, SKILLS["typography"].title);
  assert.equal(only.kind, "foundation");
  assert.equal(only.text, SKILLS["typography"].text);
  assert.equal(result.status, skillStatusSaid(1));
});

test("no picture rides with a skill — it is text and nothing else", async () => {
  const outcome = (await skillToolset().execute({
    name: "get_skills",
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

/// The whole point of the door as it now stands: nothing counts the names. A
/// call asking for the entire registry is answered with the entire registry,
/// and the only thing bounding what comes back is `SKILL_CHAR_BUDGET` on each
/// skill's own text.
test("a call reads as many skills as it names, up to the whole registry", async () => {
  const tools = skillToolset();
  const result = await read(SKILL_NAMES, tools);

  assert.deepEqual(namesIn(result), [...SKILL_NAMES]);
  assert.equal(result.notRead, undefined);
  assert.equal(result.error, undefined);
  assert.deepEqual(tools.read(), [...SKILL_NAMES]);
});

test("a design keeps reading over as many calls as it likes", async () => {
  const tools = skillToolset();

  for (const name of SKILL_NAMES) {
    assert.deepEqual(namesIn(await read([name], tools)), [name]);
  }

  assert.deepEqual(tools.read(), [...SKILL_NAMES]);
  assert.equal((await read(["typography"], tools)).error, undefined);
});

test("a name the enum should have made impossible is reported, not thrown", async () => {
  const result = await read(["typography", "wedding-photographer"]);

  assert.deepEqual(namesIn(result), ["typography"]);
  assert.deepEqual(result.notFound, ["wedding-photographer"]);
  assert.equal(result.notFoundNote, SKILL_NOT_FOUND_NOTE);
});

/// A name asked for twice over two calls. It is not sent again — the text is
/// already in the transcript and unwindowed — and the answer says so rather
/// than leaving a gap the model has to explain to itself.
test("a skill already read is said, not re-sent", async () => {
  const tools = skillToolset();
  await read(["typography", "composition"], tools);

  const again = await read(["typography", "colour-theory"], tools);
  assert.deepEqual(namesIn(again), ["colour-theory"]);
  assert.deepEqual(again.alreadyRead, ["typography"]);
  assert.equal(again.alreadyReadNote, SKILLS_ALREADY_READ_NOTE);
  assert.deepEqual(tools.read(), ["typography", "composition", "colour-theory"]);
});

test("the ledger is per design, not per process", async () => {
  const tools = skillToolset();
  await read(SKILL_NAMES, tools);

  const next = await read(["typography"]);
  assert.deepEqual(namesIn(next), ["typography"]);
  assert.equal(next.alreadyRead, undefined);
});

test("naming nothing is refused and costs nothing", async () => {
  const tools = skillToolset();

  assert.equal((await read([], tools)).error, NO_SKILL_NAMED);
  assert.equal((await read(["  "], tools)).error, NO_SKILL_NAMED);
  assert.equal((await read(undefined, tools)).error, NO_SKILL_NAMED);

  assert.deepEqual(answered(await read(["photographer"], tools)).length, 1);
});

test("a bare string is read as the one skill it names", async () => {
  assert.deepEqual(namesIn(await read("photographer")), ["photographer"]);
});

test("the same skill named twice in one call is one skill and one place", async () => {
  const result = await read(["typography", "typography", "composition", "grid-systems"]);

  assert.deepEqual(namesIn(result), ["typography", "composition", "grid-systems"]);
  assert.equal(result.notRead, undefined);
});

/// What the run row is written from (§VIII). The ledger is offered to the
/// caller rather than rebuilt from the model's arguments — which is the whole
/// of the assertion here: a name that never became text in the transcript must
/// not read afterwards as a skill this design was taught.

test("the ledger is what was read, not what was asked for", async () => {
  const tools = skillToolset();
  assert.deepEqual(tools.read(), []);

  await read(["typography", "not-a-skill", "composition", "grid-systems"], tools);

  /// `not-a-skill` found nothing, so it never reached the model and is not on
  /// the row; the other two did.
  assert.deepEqual(tools.read(), ["typography", "composition", "grid-systems"]);
});

test("the ledger is a copy — a caller cannot write the design's skills", async () => {
  const tools = skillToolset();
  await read(["composition"], tools);

  tools.read().push("light-and-shadow");
  assert.deepEqual(tools.read(), ["composition"]);
});
