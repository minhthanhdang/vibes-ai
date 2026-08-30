import { normalizeHexColor } from "@/lib/analysis/analysis";
import { mergedPalette } from "@/lib/canvas/moodboard-palette";
import { CONTRAST_BODY_MIN, paletteContrast } from "@/lib/render/contrast";
import {
  briefPalette,
  VIBES_BATCH_PAGE_LIMIT,
  VIBES_DESIGN_LIMIT,
  VIBES_FORM_LIMIT,
  VIBES_PAGE_LIMIT,
  VIBES_PALETTE_LIMIT,
  VIBES_SIZE_MAX,
  VIBES_SIZE_MIN,
  VIBES_TEXT_LIMIT,
  vibesBrief,
} from "./vibes-brief";
import { vibesBatch, vibesBatchTotals } from "./vibes-batch";

/// The form itself — what it opens holding, and what it says when it cannot be
/// submitted (compositor-v2.md §IX.1).
///
/// `vibesBrief` decides; this module only puts the decision into words. That
/// order matters: a second function deciding what a good brief is would be the
/// browser and the server disagreeing about it a release apart, and the run
/// costs six model calls. `vibesRefusals` is held to `vibesBrief` by a test
/// asserting the two agree on every draft — no messages means it submits, and
/// a message means it does not.
///
/// Pure, like everything else under `lib/vibes`. No React, no DOM: the form's
/// component holds the draft in state and asks this what to draw beside each
/// field.

/// What the form holds while it is being typed in. Everything is the loose
/// version of the brief's own field — a count that may be zero because the
/// input was cleared, a colour that may be half-typed — because a draft that
/// could not hold an unfinished value would have nothing to refuse.
export type VibesDraft = {
  purpose: string;
  pages: number;
  palette: string[];
  vibes: string;
  /// `NaN` when the input is cleared — the loose value the refusal names.
  width: number;
  height: number;
};

/// Three, out of one to six. A run is billed per page, so the default is the
/// number a user would have picked anyway rather than the ceiling — a form
/// opening on six is a form that charges the maximum to anyone who does not
/// read it.
export const VIBES_DEFAULT_PAGES = 3;

/// The colour offered to a project with nothing analysed in it yet. White is
/// the one that cannot be a wrong guess: it is what an unpainted page already
/// stands on, and a palette of one is still the list the model is held to.
export const VIBES_DEFAULT_COLOUR = "#ffffff";

/// A landscape page, the shape a board's pages come at by default. Not a guess
/// at the ask — nothing in an empty form says portrait or landscape — but the
/// shape the rest of this product already opens on, so the fields start where
/// the user's other boards are.
export const VIBES_DEFAULT_WIDTH = 1920;
export const VIBES_DEFAULT_HEIGHT = 1080;

/// The form as it opens, seeded from the project's own photographs.
///
/// The palette is agent 2's answer about the pictures already in the project,
/// merged the way the inspector merges a selection's (`canvas.md` §V) and cut
/// to the five this form allows — the colours of the set the user has been
/// collecting are the strongest guess anything here can make about the colours
/// they want the board in. Trimmed rather than refused when there are more:
/// this is an offer and every colour in it is removable.
///
/// The project's standing brief is deliberately *not* prefilled into `vibes`.
/// §IX.1 offers it and the two fields do not fit: `Project.brief` is what the
/// project is for and `vibes` is how one board should feel, so the prefill
/// would open the form answering the wrong question.
export function vibesDraft({ palettes }: { palettes: readonly (readonly unknown[])[] }): VibesDraft {
  const merged = mergedPalette(palettes).slice(0, VIBES_PALETTE_LIMIT);

  return {
    purpose: "",
    pages: VIBES_DEFAULT_PAGES,
    palette: merged.length ? merged : [VIBES_DEFAULT_COLOUR],
    vibes: "",
    width: VIBES_DEFAULT_WIDTH,
    height: VIBES_DEFAULT_HEIGHT,
  };
}

export type VibesRefusals = Partial<Record<keyof VibesDraft, string>>;

/// Why the form cannot be submitted, one message per field it belongs to.
///
/// Every one of these is a refusal `vibesBrief` already makes silently — it
/// returns null and says nothing, because the reasons are the form's to show
/// and not the server's to guess at. Refused rather than repaired throughout,
/// for the reason the reader gives: a count clamped from sixty to six is six
/// model calls nobody asked for, and a colour quietly dropped is a palette the
/// finished board does not match.
export function vibesRefusals(draft: VibesDraft): VibesRefusals {
  const refusals: VibesRefusals = {};

  const purpose = draft.purpose.trim();
  if (!purpose) refusals.purpose = "Say what is being made — a sign, a menu, a deck of five.";
  else if (purpose.length > VIBES_TEXT_LIMIT)
    refusals.purpose = `${purpose.length} characters. This is a constraint the board is checked against, so it has ${VIBES_TEXT_LIMIT}.`;

  const vibes = draft.vibes.trim();
  if (vibes.length > VIBES_TEXT_LIMIT)
    refusals.vibes = `${vibes.length} characters, and it has ${VIBES_TEXT_LIMIT}.`;

  if (!Number.isInteger(draft.pages) || draft.pages < 1 || draft.pages > VIBES_PAGE_LIMIT)
    refusals.pages = `One to ${VIBES_PAGE_LIMIT} pages — one design call each.`;

  if (!Number.isInteger(draft.width) || draft.width < VIBES_SIZE_MIN || draft.width > VIBES_SIZE_MAX)
    refusals.width = `A width in whole pixels, ${VIBES_SIZE_MIN} to ${VIBES_SIZE_MAX}.`;

  if (!Number.isInteger(draft.height) || draft.height < VIBES_SIZE_MIN || draft.height > VIBES_SIZE_MAX)
    refusals.height = `A height in whole pixels, ${VIBES_SIZE_MIN} to ${VIBES_SIZE_MAX}.`;

  const unreadable = draft.palette.find((colour) => !normalizeHexColor(colour));
  const colours = new Set(draft.palette.map((colour) => normalizeHexColor(colour)));
  if (unreadable !== undefined) refusals.palette = `“${unreadable}” is not a colour.`;
  else if (colours.size < 1)
    refusals.palette = "One colour at least — these are the colours the pages are designed in.";
  else if (colours.size > VIBES_PALETTE_LIMIT)
    refusals.palette = `${colours.size} colours. Past ${VIBES_PALETTE_LIMIT} it is not a palette.`;

  return refusals;
}

/// What the colours in the wells will and will not carry, said under them.
///
/// The one thing on this form that is neither a field nor a refusal (§IX.5).
/// `inkLine` in `vibes-brief.ts` already takes this reading and hands it to the
/// model — the census behind it is there: of 196 pairs on the development
/// database that came in under what their size wants, 129 stood on a ground the
/// brief held no legible ink for. The clause is what stops those pages coming
/// back unreadable, and it works, but it spends the palette to do it: a run on
/// a list with nothing legible in it sets its type in a neutral the user never
/// chose. This is the only place they could choose otherwise, and the moment to
/// say so is while the swatch is still under their cursor and before six design
/// calls are billed.
///
/// **Not a refusal.** A palette that cannot carry type is a perfectly good
/// palette — the warm five this was built from are the colours of the pictures
/// in that project — and refusing it would be the form overruling a person
/// about their own mood on arithmetic they did not ask for. It submits either
/// way, and nothing here changes what runs.
///
/// **Silent on a list that clears**, for `contrastNote`'s reason and with an
/// extra one this door has: the note appears the moment the last legible pair
/// is removed and goes when one is put back, which is the whole of the feedback
/// and is worth more than a sentence confirming the ordinary case.
///
/// **The same three branches `inkLine` has**, read off the same
/// `paletteContrast`, because a form that told the user one thing and the model
/// another about the same five hexes would be the two doors into agent 8 that
/// §IX.5 says must never diverge — here, at the door before them both.
export function vibesPaletteNote(palette: readonly string[]): string {
  const colours = briefPalette(palette);
  /// A list the brief would refuse has a message beside it already, and two
  /// sentences under one field is the form talking over itself.
  if (!colours) return "";

  const { body, large, widest } = paletteContrast(colours);
  if (body.length) return "";

  const cannot = widest
    ? `no two of these hold apart enough to carry small type — the widest pair is ${widest.colours[0]} and ${widest.colours[1]} at ${widest.ratio.toFixed(1)}:1, where a caption wants ${CONTRAST_BODY_MIN}:1`
    : "one colour, and type cannot stand on itself";

  const widestLarge = large[0];
  if (widestLarge) {
    return `Type: ${cannot}. A headline can go in ${widestLarge.colours[0]} on ${widestLarge.colours[1]}; the pages will set anything smaller in near-black or near-white.`;
  }

  return `Type: ${cannot}. The pages will set their type in near-black or near-white; the colours are the fills.`;
}

/// Whether the form may be submitted at all — asked of `vibesBrief` itself
/// rather than of the message list, so the button and the server are reading
/// the same function and the messages beside the fields are the only thing
/// `vibesRefusals` is trusted with.
export function vibesSubmittable(draft: VibesDraft): boolean {
  return vibesBrief(draft) !== null;
}

/// One card of the stacked form (multi-vibes-and-preview-prd §II.7): today's
/// draft plus how many boards it becomes. `designs` sits on the card and not
/// on the brief for `vibesBatch`'s reason — the take stamp each created board
/// carries is `startBatch`'s to write, never the form's to claim.
export type VibesCardDraft = VibesDraft & { designs: number };

/// The stack as it opens: one card, one design. The single-card, one-design
/// submission is today's form exactly — the batch is additive, not a tax on
/// the common case.
export function vibesBatchDraft(seed: {
  palettes: readonly (readonly unknown[])[];
}): VibesCardDraft[] {
  return [{ ...vibesDraft(seed), designs: 1 }];
}

/// "Add another brief" — a fresh card seeded the way the first was, from the
/// project's own photographs. Seeded once, here at creation, per the no-reseed
/// rule: a card that reseeded as the analysis queue settled would take back a
/// colour the user had already removed. Full is full — the stack comes back
/// unchanged at `VIBES_FORM_LIMIT`, and the button that calls this is not
/// drawn there anyway.
export function addVibesCard(
  cards: readonly VibesCardDraft[],
  seed: { palettes: readonly (readonly unknown[])[] },
): VibesCardDraft[] {
  if (cards.length >= VIBES_FORM_LIMIT) return [...cards];
  return [...cards, ...vibesBatchDraft(seed)];
}

/// Each card removable; the last is not — a submission with nothing in it is
/// not a submission, so the stack never goes below one.
export function removeVibesCard(
  cards: readonly VibesCardDraft[],
  index: number,
): VibesCardDraft[] {
  if (cards.length <= 1) return [...cards];
  return cards.filter((_, at) => at !== index);
}

/// One card's fields changed, the rest untouched.
export function updateVibesCard(
  cards: readonly VibesCardDraft[],
  index: number,
  patch: Partial<VibesCardDraft>,
): VibesCardDraft[] {
  return cards.map((card, at) => (at === index ? { ...card, ...patch } : card));
}

/// `vibesRefusals` at the card's size — the per-field messages plus the one
/// field the card adds. Same rule as every message here: refused, never
/// repaired, and only saying what `vibesBatch` would refuse silently.
export type VibesCardRefusals = Partial<Record<keyof VibesCardDraft, string>>;

export function vibesCardRefusals(card: VibesCardDraft): VibesCardRefusals {
  const refusals: VibesCardRefusals = vibesRefusals(card);
  if (!Number.isInteger(card.designs) || card.designs < 1 || card.designs > VIBES_DESIGN_LIMIT)
    refusals.designs = `One to ${VIBES_DESIGN_LIMIT} samples — each is a whole board of this brief.`;
  return refusals;
}

/// The bill, on the button that spends it — now a sum. One board keeps
/// today's sentence exactly; a batch says both numbers, because "9 pages" that
/// silently means three boards is a bill with a line missing.
export function vibesBatchBill(
  cards: readonly { pages: number; designs: number }[],
): string {
  const { boards, pages } = vibesBatchTotals(cards);
  if (boards <= 1) return pages === 1 ? "Design 1 page" : `Design ${pages} pages`;
  return `Design ${pages} pages across ${boards} boards`;
}

/// The batch ceiling's message (§II.3) — a property of the sum, not of any
/// card, which is why it renders at the button rather than beside a field.
/// Empty when the sum stands; the per-card ceilings have cards to sit beside.
export function vibesBatchRefusal(cards: readonly { pages: number; designs: number }[]): string {
  const { boards, pages } = vibesBatchTotals(cards);
  if (pages <= VIBES_BATCH_PAGE_LIMIT) return "";
  return `${pages} design calls across ${boards} board${boards === 1 ? "" : "s"} — one submit stops at ${VIBES_BATCH_PAGE_LIMIT}.`;
}

/// Whether the stack may be submitted — asked of `vibesBatch` itself, the
/// reader `startBatch` runs, for `vibesSubmittable`'s reason: the button and
/// the server must be one decision. One refusing card holds the whole batch
/// (§II.7), because silently submitting the clean subset spends money on half
/// of what was asked.
export function vibesBatchSubmittable(cards: readonly VibesCardDraft[]): boolean {
  return vibesBatch(cards) !== null;
}
