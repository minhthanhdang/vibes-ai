import { test } from "node:test";
import assert from "node:assert/strict";

import { BOARD_PALETTE_LIMIT } from "@/lib/canvas/moodboard-palette";
import { CONTRAST_BODY_MIN } from "@/lib/render/contrast";
import {
  VIBES_BATCH_PAGE_LIMIT,
  VIBES_DESIGN_LIMIT,
  VIBES_FORM_LIMIT,
  VIBES_PAGE_LIMIT,
  VIBES_PALETTE_LIMIT,
  VIBES_SIZE_MAX,
  VIBES_SIZE_MIN,
  VIBES_TEXT_LIMIT,
  vibesBrief,
  vibesIntention,
} from "@/lib/vibes/vibes-brief";
import { vibesBatch } from "@/lib/vibes/vibes-batch";
import {
  VIBES_DEFAULT_COLOUR,
  VIBES_DEFAULT_HEIGHT,
  VIBES_DEFAULT_PAGES,
  VIBES_DEFAULT_WIDTH,
  addVibesCard,
  removeVibesCard,
  updateVibesCard,
  vibesBatchBill,
  vibesBatchDraft,
  vibesBatchRefusal,
  vibesBatchSubmittable,
  vibesCardRefusals,
  vibesDraft,
  vibesPaletteNote,
  vibesRefusals,
  vibesSubmittable,
  type VibesCardDraft,
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
  width: 1080,
  height: 1920,
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
  assert.equal(seeded.width, VIBES_DEFAULT_WIDTH);
  assert.equal(seeded.height, VIBES_DEFAULT_HEIGHT);
  assert.equal(VIBES_DEFAULT_WIDTH, 1920);
  assert.equal(VIBES_DEFAULT_HEIGHT, 1080);
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

test("a page size nobody offers is refused, dimension by dimension", () => {
  assert.ok(vibesRefusals(draft({ width: VIBES_SIZE_MIN - 1 })).width);
  assert.ok(vibesRefusals(draft({ width: VIBES_SIZE_MAX + 1 })).width);
  assert.ok(vibesRefusals(draft({ width: 2.5 })).width);
  assert.ok(vibesRefusals(draft({ width: Number.NaN })).width);
  assert.ok(vibesRefusals(draft({ height: VIBES_SIZE_MIN - 1 })).height);
  assert.ok(vibesRefusals(draft({ height: Number.NaN })).height);
  assert.deepEqual(vibesRefusals(draft({ width: VIBES_SIZE_MIN, height: VIBES_SIZE_MAX })), {});
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
    draft({ width: VIBES_SIZE_MIN }),
    draft({ width: VIBES_SIZE_MIN - 1 }),
    draft({ width: VIBES_SIZE_MAX }),
    draft({ width: VIBES_SIZE_MAX + 1 }),
    draft({ width: Number.NaN }),
    draft({ width: 2.5 }),
    draft({ height: VIBES_SIZE_MIN }),
    draft({ height: VIBES_SIZE_MIN - 1 }),
    draft({ height: VIBES_SIZE_MAX }),
    draft({ height: VIBES_SIZE_MAX + 1 }),
    draft({ height: Number.NaN }),
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

/// §IX.5's last open item — what the palette will and will not carry, said to
/// the person choosing it. The three palettes are the two real Vibes briefs on
/// the development database and the teal one with its single legible pair taken
/// out, which is the branch neither real brief lands in.

const TEAL = ["#78a8a4", "#5a7476", "#415557", "#2c3234", "#344549"];
const WARM = ["#f2d4c9", "#d8bca6", "#f3e9e3", "#e19a6b", "#d8a280"];

test("a palette that can carry a caption is not remarked on", () => {
  assert.equal(vibesPaletteNote(TEAL), "");
  assert.equal(vibesPaletteNote(["#ffffff", "#000000"]), "");
});

test("the real warm brief says what its five colours cannot do, and what will happen instead", () => {
  const note = vibesPaletteNote(WARM);

  assert.match(note, /no two of these hold apart enough to carry small type/);
  /// The widest pair by name and number, because "these colours are close" is a
  /// verdict and two hexes at 1.9:1 is the thing a person can act on.
  assert.match(note, /#f3e9e3 and #e19a6b at 1\.9:1/);
  assert.match(note, new RegExp(`a caption wants ${CONTRAST_BODY_MIN}:1`));
  assert.match(note, /near-black or near-white/);
  /// No headline pair either, so nothing is offered for one.
  assert.doesNotMatch(note, /headline/);
});

test("a palette that carries a headline and nothing smaller is offered the headline", () => {
  const note = vibesPaletteNote(TEAL.filter((colour) => colour !== "#2c3234"));

  assert.match(note, /A headline can go in #78a8a4 on #344549/);
  assert.match(note, /anything smaller in near-black or near-white/);
});

test("one colour is told it cannot stand on itself rather than shown a pair", () => {
  const note = vibesPaletteNote(["#2c3234"]);

  assert.match(note, /one colour, and type cannot stand on itself/);
  assert.doesNotMatch(note, /widest pair/);
});

/// The form and the intention are one reading of the same five hexes (§IX.5).
/// Whichever branch `inkLine` takes for a palette, the note takes with it —
/// silence exactly where the model is told a pair will carry a caption.
test("the note and the sentence agent 8 reads never disagree about a palette", () => {
  const palettes = [
    TEAL,
    WARM,
    TEAL.filter((colour) => colour !== "#2c3234"),
    ["#2c3234"],
    ["#ffffff", "#000000"],
    ["#f2d4c9", "#d8bca6"],
  ];

  for (const palette of palettes) {
    const intention = vibesIntention({
      brief: { ...DRAFT, purpose: "a menu", palette, pages: 1 },
      index: 0,
    });
    const quiet = vibesPaletteNote(palette) === "";
    assert.equal(
      quiet,
      /pairs? holds? apart enough to carry small type/.test(intention),
      `disagreed about ${palette.join(" ")}`,
    );
  }
});

/// A list the brief would refuse has a refusal beside it already.
test("a palette the form is about to refuse is not also annotated", () => {
  assert.equal(vibesPaletteNote([]), "");
  assert.equal(vibesPaletteNote(["not a colour"]), "");
  assert.equal(
    vibesPaletteNote(["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"]),
    "",
  );
});

/// The duplicate is one colour at both doors, so a form holding the same hex
/// twice reads as the palette of one it will be submitted as.
test("the note reads the palette the server will read", () => {
  assert.equal(vibesPaletteNote(["#2c3234", "#2C3234"]), vibesPaletteNote(["#2c3234"]));
});

/// The stacked form (multi-vibes-and-preview-prd §II.7): card arithmetic
/// without React, and the same contract at the batch size — no message on any
/// card and none at the button means `vibesBatch` takes the submission.

function card(over: Partial<VibesCardDraft> = {}): VibesCardDraft {
  return { ...DRAFT, designs: 1, ...over };
}

test("the stack opens holding one card of one design — today's form exactly", () => {
  const opened = vibesBatchDraft({ palettes: [["#112233"]] });
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0], { ...vibesDraft({ palettes: [["#112233"]] }), designs: 1 });
});

test("a card is added seeded like the first and the stack stops at the form limit", () => {
  let cards = vibesBatchDraft({ palettes: [["#112233"]] });
  for (let extra = 0; extra < VIBES_FORM_LIMIT + 2; extra++) {
    cards = addVibesCard(cards, { palettes: [["#112233"]] });
  }
  assert.equal(cards.length, VIBES_FORM_LIMIT);
  assert.deepEqual(cards.at(-1), { ...vibesDraft({ palettes: [["#112233"]] }), designs: 1 });
});

test("any card is removable except the last one standing", () => {
  const three = [card({ purpose: "a" }), card({ purpose: "b" }), card({ purpose: "c" })];
  assert.deepEqual(
    removeVibesCard(three, 1).map(({ purpose }) => purpose),
    ["a", "c"],
  );
  assert.equal(removeVibesCard([card()], 0).length, 1);
});

test("an update lands on its own card and nothing else", () => {
  const two = [card({ purpose: "a" }), card({ purpose: "b" })];
  const changed = updateVibesCard(two, 1, { designs: 2, pages: 1 });
  assert.deepEqual(changed[0], two[0]);
  assert.deepEqual(changed[1], { ...two[1], designs: 2, pages: 1 });
});

test("a card's refusals are the draft's plus the designs row", () => {
  assert.deepEqual(vibesCardRefusals(card()), {});
  assert.ok(vibesCardRefusals(card({ designs: 0 })).designs);
  assert.ok(vibesCardRefusals(card({ designs: VIBES_DESIGN_LIMIT + 1 })).designs);
  assert.ok(vibesCardRefusals(card({ designs: 1.5 })).designs);
  assert.ok(vibesCardRefusals(card({ purpose: "" })).purpose);
  assert.deepEqual(vibesCardRefusals(card({ designs: VIBES_DESIGN_LIMIT })), {});
});

test("one board keeps today's bill and a batch says both numbers", () => {
  assert.equal(vibesBatchBill([card({ pages: 1 })]), "Design 1 page");
  assert.equal(vibesBatchBill([card({ pages: 3 })]), "Design 3 pages");
  assert.equal(
    vibesBatchBill([card({ pages: 3, designs: 2 }), card({ pages: 3 })]),
    "Design 9 pages across 3 boards",
  );
});

test("the page ceiling speaks at the button, and only past the ceiling", () => {
  assert.equal(vibesBatchRefusal([card({ pages: VIBES_PAGE_LIMIT, designs: 1 })]), "");
  const over = [
    card({ pages: VIBES_PAGE_LIMIT, designs: VIBES_DESIGN_LIMIT }),
    card({ pages: VIBES_PAGE_LIMIT, designs: VIBES_DESIGN_LIMIT }),
  ];
  const refusal = vibesBatchRefusal(over);
  assert.match(refusal, new RegExp(String(VIBES_PAGE_LIMIT * VIBES_DESIGN_LIMIT * 2)));
  assert.match(refusal, new RegExp(String(VIBES_BATCH_PAGE_LIMIT)));
});

/// The batch contract, `vibesSubmittable`'s at the stack's size: quiet cards
/// and a quiet button mean `vibesBatch` — the reader `startBatch` runs — takes
/// the submission, and the reverse.
test("no message on any card or at the button means the server takes the batch, and the reverse", () => {
  const batches: VibesCardDraft[][] = [
    [card()],
    [card({ designs: VIBES_DESIGN_LIMIT })],
    [card({ designs: 0 })],
    [card({ purpose: "" })],
    [card(), card({ pages: 1, designs: 2 })],
    [card(), card({ palette: ["not a colour"] })],
    [card({ pages: VIBES_PAGE_LIMIT, designs: VIBES_DESIGN_LIMIT }), card({ pages: VIBES_PAGE_LIMIT })],
    [
      card({ pages: VIBES_PAGE_LIMIT, designs: VIBES_DESIGN_LIMIT }),
      card({ pages: VIBES_PAGE_LIMIT, designs: VIBES_DESIGN_LIMIT }),
    ],
    vibesBatchDraft({ palettes: [] }),
    [card(), card(), card(), card()],
  ];

  for (const cards of batches) {
    const quiet =
      cards.every((held) => Object.keys(vibesCardRefusals(held)).length === 0) &&
      vibesBatchRefusal(cards) === "";
    assert.equal(quiet, vibesBatch(cards) !== null, `disagreed about ${JSON.stringify(cards)}`);
    assert.equal(quiet, vibesBatchSubmittable(cards));
  }
});
