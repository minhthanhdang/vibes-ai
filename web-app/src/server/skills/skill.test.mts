import { test } from "node:test";
import assert from "node:assert/strict";

import { SKILL_CHAR_BUDGET, skillCutSaid, skillExcerpt } from "./skill";

const paragraphs = (count: number, size: number) =>
  Array.from({ length: count }, (_, index) => `${index}`.repeat(size)).join("\n\n");

test("a skill inside the budget comes back untouched", () => {
  const text = paragraphs(4, 100);
  assert.equal(skillExcerpt(text), text);
});

test("a skill exactly at the budget is not cut", () => {
  const text = "a".repeat(SKILL_CHAR_BUDGET);
  assert.equal(skillExcerpt(text), text);
});

test("the whole answer stays inside the budget, the cut's own sentence included", () => {
  const excerpt = skillExcerpt(paragraphs(20, 500));
  assert.ok(excerpt.length <= SKILL_CHAR_BUDGET, `${excerpt.length} chars`);
});

test("what survives is whole paragraphs, never half of one", () => {
  const text = paragraphs(20, 500);
  const excerpt = skillExcerpt(text);
  const kept = excerpt.split("\n\n").slice(0, -1);
  for (const paragraph of kept) assert.ok(text.includes(`${paragraph}\n\n`));
});

test("the cut is said out loud, and says how much of the skill is missing", () => {
  const excerpt = skillExcerpt(paragraphs(20, 500));
  const kept = excerpt.split("\n\n").length - 1;
  assert.ok(excerpt.endsWith(skillCutSaid(kept, 20)));
  assert.ok(excerpt.includes(`${kept} of 20 paragraphs`));
});

test("a first paragraph longer than the whole budget is cut at a word, not answered with the note alone", () => {
  const text = `${"word ".repeat(4000)}\n\nthe second paragraph`;
  const excerpt = skillExcerpt(text);
  assert.ok(excerpt.length <= SKILL_CHAR_BUDGET);
  assert.ok(excerpt.startsWith("word word"));
  assert.ok(!excerpt.includes("the second paragraph"));
  assert.ok(excerpt.includes("1 of 2 paragraphs"));
  assert.ok(!/word wor\b/.test(excerpt), "cut through a word");
});

test("a run of blank lines is one boundary, not several empty paragraphs", () => {
  const excerpt = skillExcerpt(`${"a".repeat(5900)}\n\n\n\n${"b".repeat(5900)}`);
  assert.ok(excerpt.includes("1 of 2 paragraphs"));
});
