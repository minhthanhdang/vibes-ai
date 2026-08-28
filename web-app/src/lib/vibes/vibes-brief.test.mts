import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOG_LIMIT, type ToolReference } from "@/lib/agent/shared/reference";
import {
  VIBES_DESIGN_LIMIT,
  VIBES_PAGE_LIMIT,
  VIBES_PALETTE_LIMIT,
  VIBES_TEXT_LIMIT,
  storedBrief,
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

/// §IX.5's second reading: the coherence clause was answered exactly, and six
/// pages came back as one template filled six times. What holds and what has to
/// move are named separately for that reason.
test("page 2 and after are told what has to move as well as what holds", () => {
  const second = vibesIntention({ brief: brief(), index: 1 });

  assert.ok(second.includes("the same palette, the same margins"));
  assert.ok(second.includes("Then arrange it differently"));
  assert.ok(second.includes("do not repeat a layout that is already on the board"));
  assert.ok(second.includes("where the weight sits"));
});

/// The count is the brief's own, because "one page filled in 6 times" is the
/// failure this sentence is answering and a run of two cannot say it that way.
test("the set is named as the run's own number of pages", () => {
  assert.ok(vibesIntention({ brief: brief(), index: 1 }).includes("not one page filled in 3 times"));
  assert.ok(
    vibesIntention({ brief: brief({ pages: VIBES_PAGE_LIMIT }), index: 1 }).includes(
      `not one page filled in ${VIBES_PAGE_LIMIT} times`,
    ),
  );
});

/// Page 1 has nothing to vary from, so the ask that would send it looking for a
/// layout to avoid is not made of it — the same reason it gets no coherence.
test("page 1 and a one-page run are never asked to arrange differently", () => {
  assert.ok(!vibesIntention({ brief: brief(), index: 0 }).includes("arrange it differently"));
  assert.ok(!vibesIntention({ brief: brief({ pages: 1 }), index: 0 }).includes("arrange it differently"));
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

/// A design gets three skills and spends them all on arranging a page — 33
/// designs recorded what they read and `colour-theory` is in none of them, nor
/// in any of the 23 handed a palette (compositor-v2.md §VIII). This form is the
/// one caller that knows the colours were decided before the page was, so it is
/// the one that can say which of the three the page turns on.
test("the page whose colours were chosen for it is told which skill that makes it", () => {
  for (const index of [0, 1, 2]) {
    const asked = vibesIntention({ brief: brief(), index });
    assert.ok(asked.includes("One of the three is colour theory"));
    assert.ok(asked.includes("chosen before the page was"));
  }
});

/// The two sentences are one clause and stand together: a model told to read
/// colour theory in a paragraph of its own has been handed a second step 1.
test("the skill it names rides on the reminder rather than standing alone", () => {
  const paragraphs = vibesIntention({ brief: brief(), index: 0 }).split("\n\n");
  const reminder = paragraphs.filter((part) => part.includes("Get the skill for this"));

  assert.equal(reminder.length, 1);
  assert.ok(reminder[0]!.includes("One of the three is colour theory"));
});

/// §IX.3's ink clause. The closed-list sentence above it is what keeps a page
/// in the set; on its own it is also what makes some pages unreadable, because
/// five colours chosen for mood have no reason to hold a pair type can stand
/// on. 129 of the 196 failing pairs on the database stood on a ground the brief
/// held no legible ink for (`render/contrast.ts`), so the pairs that *do* work
/// are worked out here and said, and where there are none the model is handed
/// the one ink it may add.

const WARM = ["#f2d4c9", "#d8bca6", "#f3e9e3", "#e19a6b", "#d8a280"];
const TEAL = ["#78a8a4", "#5a7476", "#415557", "#2c3234", "#344549"];

function palettePart(palette: string[], index = 0): string {
  const asked = vibesIntention({ brief: brief({ palette }), index });
  const part = asked.split("\n\n").find((paragraph) => paragraph.startsWith("The palette is"));
  assert.ok(part);
  return part;
}

test("the pair that can carry a caption is named, with what it measures", () => {
  for (const index of [0, 1, 2]) {
    const part = palettePart(TEAL, index);
    assert.ok(part.includes("one pair holds apart enough to carry small type"));
    assert.ok(part.includes("#78a8a4 and #2c3234 (4.9:1)"));
    assert.ok(!part.includes("#415557 and"));
  }
});

test("a palette with nothing in it that can carry a caption is told so, and what its widest is", () => {
  const part = palettePart(WARM);
  assert.ok(part.includes("None of these hold apart enough to carry small type"));
  assert.ok(part.includes("#f3e9e3 and #e19a6b (1.9:1)"));
  assert.ok(part.includes("a small size wants 4.5:1"));
});

/// The warm brief is this case: no pair in it clears 3:1 either, so holding the
/// neutral back for captions would hand the model a headline it has no legible
/// way to set. Both live runs on it failed on exactly one pair and both times
/// it was the headline (§IX.5).
test("a palette that cannot carry type at any size gets the neutral for the headline too", () => {
  const part = palettePart(WARM);
  assert.ok(part.includes("Nothing in this list will carry type on another colour in it at any size."));
  assert.ok(part.includes("the headline and the caption both"));
  assert.ok(part.includes("The colours themselves are the fills and the shapes."));
});

/// And the middle case, which is neither: a headline can be set in the list and
/// a caption cannot. Saying only "none of these work" there would give away a
/// pair that does.
test("a palette that carries a headline but not a caption is told which does which", () => {
  const part = palettePart(["#78a8a4", "#5a7476", "#415557", "#344549"]);
  assert.ok(part.includes("None of these hold apart enough to carry small type"));
  assert.ok(part.includes("#78a8a4 and #344549 (3.8:1) will carry a headline"));
  assert.ok(part.includes("which needs 3:1 rather than 4.5:1"));
  assert.ok(part.includes("near-black or near-white"));
});

/// The neutral is the one thing outside the list, and it is for small type
/// only: the drift §IX.5 caught first was a headline in black on a warm brief,
/// which the closed list still refuses.
test("the neutral ink is offered as the single exception, not as an opening of the list", () => {
  for (const palette of [WARM, TEAL]) {
    const part = palettePart(palette);
    assert.ok(part.includes("Do not introduce another one."));
    assert.ok(part.includes("near-black or near-white on the colour it stands on"));
    assert.ok(part.includes("the one thing you may add to the list"));
  }
});

test("a palette of one colour is not asked about its pairs", () => {
  const part = palettePart(["#2c3234"]);
  assert.ok(part.includes("There is one colour here, and type cannot stand on itself."));
  assert.ok(!part.includes("widest pair"));
});

test("past three pairs the list stops naming them and says how many there are", () => {
  const part = palettePart(["#ffffff", "#000000", "#767676", "#e19a6b", "#2c3234"]);
  assert.ok(part.includes("pairs hold apart enough"));
  assert.equal(part.match(/:1\)/g)?.length, 3);
  assert.ok(/, and \d+ more\./.test(part));
});

test("the ink clause rides in the palette paragraph rather than standing on its own", () => {
  const paragraphs = vibesIntention({ brief: brief({ palette: WARM }), index: 0 }).split("\n\n");
  const carrying = paragraphs.filter((part) => part.includes("near-black or near-white"));

  assert.equal(carrying.length, 1);
  assert.ok(carrying[0]!.startsWith("The palette is"));
});

/// §IX.2. The brief rides on the board so that the pages after the first can be
/// asked for the same set — and the column is a `Json` written by whatever
/// build was running that day, so it is input again on the way out.
test("a brief stored on a board reads back as the one that was submitted", () => {
  const submitted = brief();
  const read = storedBrief(JSON.parse(JSON.stringify(submitted)));

  assert.deepEqual(read, submitted);
});

test("a board with no brief on it is not a Vibes board", () => {
  assert.equal(storedBrief(null), null);
  assert.equal(storedBrief(undefined), null);
  assert.equal(storedBrief("a welcome sign"), null);
  assert.equal(storedBrief([FORM]), null);
});

/// Refused rather than repaired on the way out too: a run finished against a
/// half-read brief is six pages asked for something nobody typed.
test("a stored brief an older build could have written is refused, not patched", () => {
  assert.equal(storedBrief({ ...FORM, preset: "A4" }), null);
  assert.equal(storedBrief({ ...FORM, palette: [] }), null);
  assert.equal(storedBrief({ ...FORM, pages: VIBES_PAGE_LIMIT + 1 }), null);
  assert.equal(storedBrief({ ...FORM, purpose: "" }), null);
});

/// multi-vibes-and-preview-prd §II.3. The take rides on the brief rather than
/// in the job because the clause it feeds must survive a resume — the worker
/// holds nothing about a board but the column.
test("a brief with no take is the common case and carries none", () => {
  assert.equal(brief().take, undefined);
  assert.equal("take" in brief(), false);
});

test("a stored take reads back with its brief", () => {
  const stamped = { ...FORM, take: { design: 2, designs: 3 } };
  const read = storedBrief(stamped);

  assert.deepEqual(read?.take, { design: 2, designs: 3 });
  assert.equal(vibesBrief(stamped)?.take?.designs, 3);
});

/// Refused with the whole brief, not dropped: only `startBatch` writes this,
/// so a take that cannot stand up is a build disagreement rather than a typo.
test("a take that cannot stand up refuses the brief", () => {
  const stamped = (take: unknown) => vibesBrief({ ...FORM, take });

  assert.equal(stamped("2 of 3"), null);
  assert.equal(stamped([2, 3]), null);
  assert.equal(stamped({ design: 2 }), null);
  assert.equal(stamped({ design: 0, designs: 3 }), null);
  assert.equal(stamped({ design: 4, designs: 3 }), null);
  assert.equal(stamped({ design: 1.5, designs: 3 }), null);
  /// A take of one is not a take — a single-design board carries none at all.
  assert.equal(stamped({ design: 1, designs: 1 }), null);
  assert.equal(stamped({ design: 1, designs: VIBES_DESIGN_LIMIT + 1 }), null);
});

/// The clause guards against the hedge: three takes that each keep every
/// option open are one board three times.
test("a take says which board this is and asks for one direction", () => {
  const stamped = vibesBrief({ ...FORM, take: { design: 2, designs: 3 } });
  assert.ok(stamped);
  const said = vibesIntention({ brief: stamped, index: 0 });

  assert.ok(said.includes("take 2 of 3 from the same brief"));
  assert.ok(said.includes("one distinct direction"));
});

test("a brief without a take says nothing about takes", () => {
  assert.equal(vibesIntention({ brief: brief(), index: 0 }).includes("take"), false);
});
