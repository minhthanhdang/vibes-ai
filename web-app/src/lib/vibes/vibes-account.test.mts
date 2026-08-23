import { test } from "node:test";
import assert from "node:assert/strict";

import { VIBES_PAGE_LIMIT, vibesBrief, type VibesBrief } from "@/lib/vibes/vibes-brief";
import { vibesAsk, vibesSaid } from "@/lib/vibes/vibes-account";

/// compositor-v2.md §IX.2 and §IX.5. The run as the conversation reads it: one
/// ask, one row per page, and every row naming the page it is about — because
/// the line a design answers with does not.

const FORM = {
  purpose: "a welcome sign for a rustic autumn wedding",
  pages: 3,
  palette: ["#7A4B2A", "#E8D9C0"],
  vibes: "warm, intimate, candlelit",
  preset: "PORTRAIT_HD",
};

function brief(over: Partial<typeof FORM> = {}): VibesBrief {
  const made = vibesBrief({ ...FORM, ...over });
  assert.ok(made);
  return made;
}

test("the conversation gets the purpose in the user's own words and nothing restated", () => {
  assert.equal(vibesAsk(brief()), `Let's Vibes — ${FORM.purpose}`);
  assert.ok(!vibesAsk(brief()).includes("PORTRAIT_HD"));
});

test("a designed page says which page it was, and keeps agent 8's own line", () => {
  assert.equal(
    vibesSaid({ index: 2, total: 6, outcome: { line: "Three photographs over a warm ground." } }),
    "Page 3 of 6 — Three photographs over a warm ground.",
  );
});

/// The whole reason the number is on the row (§IX.5): a design that runs out of
/// rounds answers with a line that names no page, so two of them in one run
/// were two identical paragraphs and no way to tell which pages went short.
test("a page that placed nothing says so, in the row, by number", () => {
  const rounds = "I ran out of steps before I could finish.";

  assert.equal(
    vibesSaid({ index: 4, total: 6, outcome: { line: rounds, empty: true } }),
    `Page 5 of 6 is still empty — ${rounds}`,
  );
  assert.notEqual(
    vibesSaid({ index: 4, total: 6, outcome: { line: rounds, empty: true } }),
    vibesSaid({ index: 1, total: 6, outcome: { line: rounds, empty: true } }),
  );
});

test("a refusal names the page and the reason, the way it always did", () => {
  assert.equal(
    vibesSaid({ index: 3, total: 6, outcome: { error: "the board went away" } }),
    "Page 4 of 6 was not designed — the board went away",
  );
});

/// `empty: false` is a designed page and not a third thing to say: the field is
/// the answer to "did anything land", and a page that answered normally reads
/// exactly as it did before this fact existed.
test("an empty flag that is false reads as a designed page", () => {
  assert.equal(
    vibesSaid({ index: 0, total: 1, outcome: { line: "Done.", empty: false } }),
    vibesSaid({ index: 0, total: 1, outcome: { line: "Done." } }),
  );
});

test("the page is said 1-based at both ends of the run", () => {
  assert.match(vibesSaid({ index: 0, total: VIBES_PAGE_LIMIT, outcome: { line: "x" } }), /^Page 1 of 6 —/);
  assert.match(
    vibesSaid({ index: VIBES_PAGE_LIMIT - 1, total: VIBES_PAGE_LIMIT, outcome: { line: "x" } }),
    /^Page 6 of 6 —/,
  );
});
