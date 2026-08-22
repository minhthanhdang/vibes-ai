import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOG_LIMIT, type ToolReference } from "@/lib/agent/agent-tools";
import {
  VIBES_PAGE_LIMIT,
  VIBES_PALETTE_LIMIT,
  VIBES_TEXT_LIMIT,
  themeColour,
  vibesBrief,
  vibesIntention,
  type VibesBrief,
} from "@/lib/vibes/vibes-brief";

/// compositor-v2.md §IX.1 and §IX.3. The form is the whole of what the user
/// says and the intention is the whole of what agent 8 hears, so what is worth
/// asserting here is that nothing is invented between the two and that nothing
/// the form could not have meant gets through.

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

function picture(over: Partial<ToolReference> & { id: string }): ToolReference {
  return {
    title: "IMG_0042.jpg",
    width: 1600,
    height: 1200,
    thumbUrl: `https://example.test/${over.id}`,
    ...over,
  };
}

test("a filled form comes back normalised, in the user's own order", () => {
  const made = brief();

  assert.equal(made.purpose, FORM.purpose);
  assert.equal(made.pages, 3);
  assert.deepEqual(made.palette, ["#7a4b2a", "#e8d9c0"]);
  assert.equal(made.vibes, FORM.vibes);
  assert.equal(made.preset, "PORTRAIT_HD");
  assert.equal(themeColour(made), "#7a4b2a");
});

test("the fields are trimmed and vibes may be left empty", () => {
  const made = brief({ purpose: "  a banner  ", vibes: "   " });

  assert.equal(made.purpose, "a banner");
  assert.equal(made.vibes, "");
});

/// A form with no purpose is a run with nothing to check the board against, and
/// §IV.5 chooses the skill off exactly this sentence.
test("a purpose is required and neither text field may run past its limit", () => {
  assert.equal(vibesBrief({ ...FORM, purpose: "" }), null);
  assert.equal(vibesBrief({ ...FORM, purpose: "   " }), null);
  assert.equal(vibesBrief({ ...FORM, purpose: undefined }), null);
  assert.equal(vibesBrief({ ...FORM, purpose: "x".repeat(VIBES_TEXT_LIMIT) })?.purpose?.length, VIBES_TEXT_LIMIT);
  assert.equal(vibesBrief({ ...FORM, purpose: "x".repeat(VIBES_TEXT_LIMIT + 1) }), null);
  assert.equal(vibesBrief({ ...FORM, vibes: "x".repeat(VIBES_TEXT_LIMIT + 1) }), null);
});

/// Refused rather than clamped: sixty clamped to six is six design calls the
/// user did not ask for and is billed for.
test("the page count is a whole number inside the limit, and is never clamped", () => {
  assert.equal(vibesBrief({ ...FORM, pages: 1 })?.pages, 1);
  assert.equal(vibesBrief({ ...FORM, pages: VIBES_PAGE_LIMIT })?.pages, VIBES_PAGE_LIMIT);
  assert.equal(vibesBrief({ ...FORM, pages: 0 }), null);
  assert.equal(vibesBrief({ ...FORM, pages: VIBES_PAGE_LIMIT + 1 }), null);
  assert.equal(vibesBrief({ ...FORM, pages: 2.5 }), null);
  assert.equal(vibesBrief({ ...FORM, pages: "3" }), null);
});

test("a colour that is not one refuses the form rather than being dropped", () => {
  assert.deepEqual(vibesBrief({ ...FORM, palette: ["#fff"] })?.palette, ["#ffffff"]);
  assert.equal(vibesBrief({ ...FORM, palette: ["burnt orange"] }), null);
  assert.equal(vibesBrief({ ...FORM, palette: [] }), null);
  assert.equal(vibesBrief({ ...FORM, palette: "#ffffff" }), null);
  assert.equal(
    vibesBrief({ ...FORM, palette: Array.from({ length: VIBES_PALETTE_LIMIT + 1 }, (_, at) => `#00000${at}`) }),
    null,
  );
});

/// The same colour twice is one colour — and left in, it would spend a slot of
/// five and read to the model as an emphasis nobody meant.
test("a repeated colour collapses and keeps the first position", () => {
  const made = brief({ palette: ["#7A4B2A", "#e8d9c0", "#7a4b2a"] });

  assert.deepEqual(made.palette, ["#7a4b2a", "#e8d9c0"]);
});

test("the page size must be one of the presets", () => {
  assert.equal(vibesBrief({ ...FORM, preset: "SQUARE" })?.preset, "SQUARE");
  assert.equal(vibesBrief({ ...FORM, preset: "A4" }), null);
  assert.equal(vibesBrief({ ...FORM, preset: undefined }), null);
});

/// §IX.3's first clause. The one thing a brief cannot survive is being
/// paraphrased, and this function is the last place that could do it.
test("the purpose and the vibes reach the model verbatim", () => {
  const asked = vibesIntention({ brief: brief(), index: 0 });

  assert.ok(asked.includes(FORM.purpose));
  assert.ok(asked.includes(FORM.vibes));
});

test("a form with no vibes says nothing about a feel rather than inventing one", () => {
  const asked = vibesIntention({ brief: brief({ vibes: "" }), index: 0 });

  assert.ok(!asked.includes("feel"));
  assert.ok(asked.includes(FORM.purpose));
});

/// The palette is a constraint nothing enforces (§IX.5), so the clause closing
/// the list is the whole of what stands between five colours and a sixth.
test("the palette is said as hexes, as a closed list, with the ground named", () => {
  const asked = vibesIntention({ brief: brief(), index: 0 });

  assert.ok(asked.includes("#7a4b2a, #e8d9c0"));
  assert.ok(asked.includes("standing on #7a4b2a"));
  assert.ok(/Do not introduce another one/.test(asked));
});

test("the page says which one of how many it is", () => {
  assert.ok(vibesIntention({ brief: brief(), index: 0 }).startsWith("Design page 1 of 3"));
  assert.ok(vibesIntention({ brief: brief(), index: 2 }).startsWith("Design page 3 of 3"));
  assert.ok(
    vibesIntention({ brief: brief({ pages: VIBES_PAGE_LIMIT }), index: VIBES_PAGE_LIMIT - 1 }).startsWith(
      `Design page ${VIBES_PAGE_LIMIT} of ${VIBES_PAGE_LIMIT}`,
    ),
  );
});

/// A run of one is not a set, so the clause that makes six pages belong
/// together has nothing to ask for and is left off.
test("page 1 is asked for no coherence and a one-page run never is", () => {
  assert.ok(!vibesIntention({ brief: brief(), index: 0 }).includes("already on this board"));
  assert.ok(!vibesIntention({ brief: brief({ pages: 1 }), index: 0 }).includes("already on this board"));
});

test("page 2 and after are pointed at the pages already standing", () => {
  const second = vibesIntention({ brief: brief(), index: 1 });
  const third = vibesIntention({ brief: brief(), index: 2 });

  assert.ok(second.includes("Page 1 is already on this board"));
  assert.ok(second.includes("belong beside it"));
  assert.ok(third.includes("belong beside them"));
  assert.ok(second.includes("Read the board before you place anything"));
  assert.ok(third.includes("Pages 1–2 are already on this board"));
});

test("the pictures arrive as catalogue lines in agent 8's own words", () => {
  const asked = vibesIntention({
    brief: brief(),
    index: 0,
    pictures: [
      picture({ id: "r1", title: "Stairwell", favorite: true }),
      picture({ id: "r2", title: "Tight crop", source: { id: "r1", title: "Stairwell" }, editIntent: "the face" }),
    ],
  });

  assert.ok(asked.includes("- r1 · Stairwell · 4:3 · starred"));
  assert.ok(asked.includes("cut of r1"));
  assert.ok(asked.includes("the face"));
});

/// The two sentences the cap makes necessary (§IX.3): the list is an offer, and
/// a photograph used twice across a run is what makes a set look thin.
test("the catalogue is capped and says so, and never reads as an instruction", () => {
  const many = Array.from({ length: CATALOG_LIMIT + 3 }, (_, at) => picture({ id: `r${at}` }));
  const asked = vibesIntention({ brief: brief(), index: 0, pictures: many });

  assert.equal(asked.split("\n").filter((line) => line.startsWith("- ")).length, CATALOG_LIMIT);
  assert.ok(asked.includes(`Only the first ${CATALOG_LIMIT} of ${CATALOG_LIMIT + 3} are listed`));
  assert.ok(asked.includes("They do not all have to be used"));
  assert.ok(asked.includes("on a run of 3 pages the same photograph on two of them"));
});

test("a project with no pictures says so rather than listing nothing", () => {
  const asked = vibesIntention({ brief: brief(), index: 0 });

  assert.ok(asked.includes("no pictures in it"));
  assert.ok(!asked.includes("They do not all have to be used"));
});

/// §II.6's loop opens with the skill, and a brief this specific is exactly
/// where a model reads step 1 as already answered.
test("every page is reminded to get the skill first", () => {
  for (const index of [0, 1, 2]) {
    assert.ok(vibesIntention({ brief: brief(), index }).includes("Get the skill for this"));
  }
});
