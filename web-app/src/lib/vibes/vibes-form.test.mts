import { test } from "node:test";
import assert from "node:assert/strict";

import { BOARD_PALETTE_LIMIT } from "@/lib/canvas/moodboard-palette";
import {
  VIBES_PAGE_LIMIT,
  VIBES_PALETTE_LIMIT,
  VIBES_TEXT_LIMIT,
  vibesBrief,
} from "@/lib/vibes/vibes-brief";
import {
  VIBES_DEFAULT_COLOUR,
  VIBES_DEFAULT_PAGES,
  VIBES_DEFAULT_PRESET,
  vibesDraft,
  vibesRefusals,
  vibesSubmittable,
  type VibesDraft,
} from "@/lib/vibes/vibes-form";

/// compositor-v2.md §IX.1. Two things are worth asserting about a form: what it
/// opens holding, and that what it refuses is exactly what the server refuses.
/// The second is the one that matters — a browser that submits a brief the
/// mutation throws on is six model calls the user is charged nothing for and
/// waits for anyway.

const DRAFT: VibesDraft = {
  purpose: "a welcome sign for a rustic autumn wedding",
  pages: 3,
  palette: ["#7a4b2a", "#e8d9c0"],
  vibes: "warm, intimate, candlelit",
  preset: "PORTRAIT_HD",
};

function draft(over: Partial<VibesDraft> = {}): VibesDraft {
  return { ...DRAFT, ...over };
}

test("a form opens seeded from the project's own photographs", () => {
  const seeded = vibesDraft({ palettes: [["#112233", "#445566"], ["#112233"]] });

  /// Merged the inspector's way — the colour in two of them leads.
  assert.deepEqual(seeded.palette, ["#112233", "#445566"]);
  assert.equal(seeded.purpose, "");
  assert.equal(seeded.vibes, "");
  assert.equal(seeded.pages, VIBES_DEFAULT_PAGES);
  assert.equal(seeded.preset, VIBES_DEFAULT_PRESET);
});

test("a project with nothing analysed still opens on a colour", () => {
  assert.deepEqual(vibesDraft({ palettes: [] }).palette, [VIBES_DEFAULT_COLOUR]);
  assert.deepEqual(vibesDraft({ palettes: [["not a colour"]] }).palette, [VIBES_DEFAULT_COLOUR]);
});

test("the seed is cut to what the form allows, not to what a board allows", () => {
  const many = Array.from({ length: BOARD_PALETTE_LIMIT }, (_, index) =>
    `#${index.toString(16).repeat(6)}`,
  );
  assert.ok(BOARD_PALETTE_LIMIT > VIBES_PALETTE_LIMIT);
  assert.equal(vibesDraft({ palettes: [many] }).palette.length, VIBES_PALETTE_LIMIT);
});

test("a seeded form is one purpose away from submitting", () => {
  const seeded = vibesDraft({ palettes: [["#112233"]] });
  assert.equal(vibesSubmittable(seeded), false);
  assert.equal(vibesSubmittable({ ...seeded, purpose: "a menu" }), true);
});

test("a good draft has nothing to say", () => {
  assert.deepEqual(vibesRefusals(draft()), {});
});

test("the purpose is the field with no default", () => {
  assert.ok(vibesRefusals(draft({ purpose: "" })).purpose);
  assert.ok(vibesRefusals(draft({ purpose: "   " })).purpose);
  assert.ok(vibesRefusals(draft({ purpose: "x".repeat(VIBES_TEXT_LIMIT + 1) })).purpose);
  assert.deepEqual(vibesRefusals(draft({ purpose: "x".repeat(VIBES_TEXT_LIMIT) })), {});
});

test("the vibes may be empty and may not be a brief", () => {
  assert.deepEqual(vibesRefusals(draft({ vibes: "" })), {});
  assert.ok(vibesRefusals(draft({ vibes: "x".repeat(VIBES_TEXT_LIMIT + 1) })).vibes);
});

test("the page count is refused rather than clamped", () => {
  assert.ok(vibesRefusals(draft({ pages: 0 })).pages);
  assert.ok(vibesRefusals(draft({ pages: VIBES_PAGE_LIMIT + 1 })).pages);
  assert.ok(vibesRefusals(draft({ pages: 2.5 })).pages);
  assert.ok(vibesRefusals(draft({ pages: Number.NaN })).pages);
  assert.deepEqual(vibesRefusals(draft({ pages: 1 })), {});
  assert.deepEqual(vibesRefusals(draft({ pages: VIBES_PAGE_LIMIT })), {});
});

test("a colour that is not one is named back", () => {
  const refusal = vibesRefusals(draft({ palette: ["#7a4b2a", "burnt sienna"] })).palette;
  assert.ok(refusal?.includes("burnt sienna"));
});

test("an empty palette is refused and a repeated colour is not", () => {
  assert.ok(vibesRefusals(draft({ palette: [] })).palette);
  assert.deepEqual(vibesRefusals(draft({ palette: ["#7a4b2a", "#7A4B2A"] })), {});
});

test("past the palette limit is refused, counting the colours and not the entries", () => {
  const five = ["#111111", "#222222", "#333333", "#444444", "#555555"];
  assert.equal(five.length, VIBES_PALETTE_LIMIT);
  assert.deepEqual(vibesRefusals(draft({ palette: five })), {});
  assert.deepEqual(vibesRefusals(draft({ palette: [...five, "#111111"] })), {});
  assert.ok(vibesRefusals(draft({ palette: [...five, "#666666"] })).palette);
});

test("a page size nobody offers is refused", () => {
  assert.ok(vibesRefusals(draft({ preset: "A4" as VibesDraft["preset"] })).preset);
});

/// The contract this module exists to keep: the messages beside the fields and
/// the reader the mutation runs are one decision. A draft with no message that
/// the server would refuse is a submit button that lies.
test("no message beside a field means the server takes the brief, and the reverse", () => {
  const drafts: VibesDraft[] = [
    draft(),
    draft({ purpose: "" }),
    draft({ purpose: " a menu " }),
    draft({ purpose: "x".repeat(VIBES_TEXT_LIMIT + 1) }),
    draft({ vibes: "" }),
    draft({ vibes: "x".repeat(VIBES_TEXT_LIMIT + 1) }),
    draft({ pages: 0 }),
    draft({ pages: 1 }),
    draft({ pages: VIBES_PAGE_LIMIT }),
    draft({ pages: VIBES_PAGE_LIMIT + 1 }),
    draft({ pages: 2.5 }),
    draft({ palette: [] }),
    draft({ palette: ["#7a4b2a", "#7A4B2A"] }),
    draft({ palette: ["not a colour"] }),
    draft({ palette: ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"] }),
    draft({ preset: "A4" as VibesDraft["preset"] }),
    vibesDraft({ palettes: [] }),
    vibesDraft({ palettes: [["#112233"]], }),
  ];

  for (const candidate of drafts) {
    const quiet = Object.keys(vibesRefusals(candidate)).length === 0;
    assert.equal(
      quiet,
      vibesBrief(candidate) !== null,
      `disagreed about ${JSON.stringify(candidate)}`,
    );
    assert.equal(quiet, vibesSubmittable(candidate));
  }
});
