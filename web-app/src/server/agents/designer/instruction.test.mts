import { test } from "node:test";
import assert from "node:assert/strict";

import { designerInstruction } from "./instruction";
import { GET_SKILLS } from "./skills";
import { SKILLS, SKILL_NAMES } from "@/server/skills";

const instruction = designerInstruction();

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
  for (const tool of [
    "add_page",
    "compose_moodboard",
    "inspect_board",
    "list_references",
    "show_references",
    "edit_reference",
    "discard_reference",
    "set_canvas_background",
  ]) {
    assert.ok(!instruction.includes(tool), `${tool} is not agent 8's to call`);
  }
});

test("the tools that make bytes are left to their own declarations", () => {
  assert.ok(!instruction.includes("generate_image"));
  assert.ok(!instruction.includes("edit_image"));
});

test("no page size is given in pixels outside the one box shown as an example", () => {
  const sizes = instruction.match(/\b\d{3,4} ?x ?\d{3,4}\b/g) ?? [];
  assert.deepEqual(sizes, []);
});

test("the catalogue the instruction points at holds every skill", () => {
  for (const name of SKILL_NAMES) {
    assert.ok(GET_SKILLS.description.includes(name), `${name} is not in the catalogue`);
    assert.ok(GET_SKILLS.description.includes(SKILLS[name].summary), `${name} has no summary`);
  }
});

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
