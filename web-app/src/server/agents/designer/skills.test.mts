import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GET_SKILL,
  NO_SKILL_NAMED,
  SKILL_NOT_FOUND_NOTE,
  skillStatusSaid,
  skillToolset,
} from "./skills";
import { skillCeilingSaid, SKILLS_ALREADY_READ_NOTE, SKILLS_PER_CALL, SKILLS_PER_DESIGN, skillsOverCallSaid } from "@/lib/agent/designer/skill-tools";
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
  assert.equal(parameters.properties.skills.items.enum.length, SKILL_NAMES.length);
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
  assert.equal(result.status, skillStatusSaid(1));
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

test("a call reads its cap, and the surplus is named back rather than dropped", async () => {
  const asked = SKILL_NAMES.slice(0, SKILLS_PER_CALL + 2);
  const result = await read(asked);

  assert.equal(answered(result).length, SKILLS_PER_CALL);
  assert.deepEqual(result.notRead, asked.slice(SKILLS_PER_CALL));
  assert.equal(result.notReadNote, skillsOverCallSaid(SKILLS_PER_DESIGN - SKILLS_PER_CALL));
});

/// The change the surplus note turns on (§IV.5): the names over a call's cap
/// are no longer lost, because a design has more calls. A note that says
/// otherwise is the one thing that would keep a model from asking.
test("the surplus can be asked for again in the next call", async () => {
  const tools = skillToolset();
  const asked = SKILL_NAMES.slice(0, SKILLS_PER_CALL + 2);
  const surplus = (await read(asked, tools)).notRead as string[];

  assert.deepEqual(answered(await read(surplus, tools)).map((skill) => skill.name), surplus);
  assert.deepEqual(tools.read(), asked);
});

test("a name the enum should have made impossible is reported, not thrown", async () => {
  const result = await read(["typography", "wedding-photographer"]);

  assert.deepEqual(answered(result).map((skill) => skill.name), ["typography"]);
  assert.deepEqual(result.notFound, ["wedding-photographer"]);
  assert.equal(result.notFoundNote, SKILL_NOT_FOUND_NOTE);
});

test("a design reads up to its allowance over as many calls as it likes", async () => {
  const tools = skillToolset();
  const wanted = SKILL_NAMES.slice(0, SKILLS_PER_DESIGN);

  for (let taken = 0; taken < wanted.length; taken += SKILLS_PER_CALL) {
    await read(wanted.slice(taken, taken + SKILLS_PER_CALL), tools);
  }

  assert.deepEqual(tools.read(), wanted);
});

test("the allowance spent is a refusal that names what is still in front of it", async () => {
  const tools = skillToolset();
  const wanted = SKILL_NAMES.slice(0, SKILLS_PER_DESIGN);

  for (let taken = 0; taken < wanted.length; taken += SKILLS_PER_CALL) {
    await read(wanted.slice(taken, taken + SKILLS_PER_CALL), tools);
  }

  const again = await read([SKILL_NAMES[SKILLS_PER_DESIGN]], tools);
  assert.equal(again.skills, undefined);
  assert.equal(again.error, skillCeilingSaid(wanted));
  assert.ok((again.error as string).includes(wanted.join(", ")));
});

/// A call is allowed to run into the allowance rather than over it: the last
/// call takes what is left and names the rest back, which is the same surplus
/// sentence the per-call cap uses and the same one that says nothing is left.
test("the last call takes what the allowance has left, not what it asked for", async () => {
  const tools = skillToolset();
  const first = SKILL_NAMES.slice(0, SKILLS_PER_DESIGN - 2);
  for (let taken = 0; taken < first.length; taken += SKILLS_PER_CALL) {
    await read(first.slice(taken, taken + SKILLS_PER_CALL), tools);
  }

  const last = await read(SKILL_NAMES.slice(SKILLS_PER_DESIGN - 2, SKILLS_PER_DESIGN + 2), tools);
  assert.equal(answered(last).length, 2);
  assert.deepEqual(last.notRead, SKILL_NAMES.slice(SKILLS_PER_DESIGN, SKILLS_PER_DESIGN + 2));
  assert.equal(last.notReadNote, skillsOverCallSaid(0));
  assert.equal(tools.read().length, SKILLS_PER_DESIGN);
});

/// A name asked for twice over two calls. It is not sent again — the text is
/// already in the transcript and unwindowed — and it does not cost the design
/// anything, because nothing new came back.
test("a skill already read is said, not re-sent, and costs nothing", async () => {
  const tools = skillToolset();
  await read(["typography", "composition"], tools);

  const again = await read(["typography", "colour-theory"], tools);
  assert.deepEqual(answered(again).map((skill) => skill.name), ["colour-theory"]);
  assert.deepEqual(again.alreadyRead, ["typography"]);
  assert.equal(again.alreadyReadNote, SKILLS_ALREADY_READ_NOTE);
  assert.deepEqual(tools.read(), ["typography", "composition", "colour-theory"]);
});

test("the ceiling is per design, not per process", async () => {
  const tools = skillToolset();
  for (let taken = 0; taken < SKILLS_PER_DESIGN; taken += SKILLS_PER_CALL) {
    await read(SKILL_NAMES.slice(taken, taken + SKILLS_PER_CALL), tools);
  }

  const next = await read(["typography"]);
  assert.equal(answered(next).length, 1);
});

test("a call that read nothing spends none of the allowance", async () => {
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

test("the same skill named twice in one call is one skill and one place", async () => {
  const result = await read(["typography", "typography", "composition", "grid-systems"]);

  assert.deepEqual(answered(result).map((skill) => skill.name), [
    "typography",
    "composition",
    "grid-systems",
  ]);
  assert.equal(result.notRead, undefined);
});

/// What the run row is written from (§VIII). The ledger the one-call ceiling is
/// already kept in, offered to the caller rather than rebuilt from the model's
/// arguments — which is the whole of the assertion here: a name that never
/// became text in the transcript must not read afterwards as a skill this
/// design was taught.

test("the ledger is what was read, not what was asked for", async () => {
  const tools = skillToolset();
  assert.deepEqual(tools.read(), []);

  await read(["typography", "not-a-skill", "composition", "grid-systems"], tools);

  /// `not-a-skill` found nothing, so it never reached the model and is not on
  /// the row; the other two did.
  assert.deepEqual(tools.read(), ["typography", "composition", "grid-systems"]);
});

test("a call refused past the allowance adds nothing to the ledger", async () => {
  const tools = skillToolset();
  const wanted = SKILL_NAMES.slice(0, SKILLS_PER_DESIGN);
  for (let taken = 0; taken < wanted.length; taken += SKILLS_PER_CALL) {
    await read(wanted.slice(taken, taken + SKILLS_PER_CALL), tools);
  }

  await read([SKILL_NAMES[SKILLS_PER_DESIGN]], tools);
  assert.deepEqual(tools.read(), wanted);
});

test("the ledger is a copy — a caller cannot write the design's skills", async () => {
  const tools = skillToolset();
  await read(["composition"], tools);

  tools.read().push("light-and-shadow");
  assert.deepEqual(tools.read(), ["composition"]);
});
