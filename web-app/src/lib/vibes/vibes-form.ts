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

export type VibesDraft = {
  purpose: string;
  pages: number;
  palette: string[];
  vibes: string;
  width: number;
  height: number;
};

export const VIBES_DEFAULT_PAGES = 3;

export const VIBES_DEFAULT_COLOUR = "#ffffff";

export const VIBES_DEFAULT_WIDTH = 1920;
export const VIBES_DEFAULT_HEIGHT = 1080;

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

export function vibesPaletteNote(palette: readonly string[]): string {
  const colours = briefPalette(palette);
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

export function vibesSubmittable(draft: VibesDraft): boolean {
  return vibesBrief(draft) !== null;
}

export type VibesCardDraft = VibesDraft & { designs: number };

export function vibesBatchDraft(seed: {
  palettes: readonly (readonly unknown[])[];
}): VibesCardDraft[] {
  return [{ ...vibesDraft(seed), designs: 1 }];
}

export function addVibesCard(
  cards: readonly VibesCardDraft[],
  seed: { palettes: readonly (readonly unknown[])[] },
): VibesCardDraft[] {
  if (cards.length >= VIBES_FORM_LIMIT) return [...cards];
  return [...cards, ...vibesBatchDraft(seed)];
}

export function removeVibesCard(
  cards: readonly VibesCardDraft[],
  index: number,
): VibesCardDraft[] {
  if (cards.length <= 1) return [...cards];
  return cards.filter((_, at) => at !== index);
}

export function updateVibesCard(
  cards: readonly VibesCardDraft[],
  index: number,
  patch: Partial<VibesCardDraft>,
): VibesCardDraft[] {
  return cards.map((card, at) => (at === index ? { ...card, ...patch } : card));
}

export type VibesCardRefusals = Partial<Record<keyof VibesCardDraft, string>>;

export function vibesCardRefusals(card: VibesCardDraft): VibesCardRefusals {
  const refusals: VibesCardRefusals = vibesRefusals(card);
  if (!Number.isInteger(card.designs) || card.designs < 1 || card.designs > VIBES_DESIGN_LIMIT)
    refusals.designs = `One to ${VIBES_DESIGN_LIMIT} samples — each is a whole board of this brief.`;
  return refusals;
}

export function vibesBatchBill(
  cards: readonly { pages: number; designs: number }[],
  remaining?: number,
): string {
  const { boards, pages } = vibesBatchTotals(cards);
  const said =
    boards <= 1
      ? pages === 1
        ? "Design 1 page"
        : `Design ${pages} pages`
      : `Design ${pages} pages across ${boards} boards`;
  if (remaining === undefined || !Number.isFinite(remaining)) return said;
  return `${said} — ${remaining} ${remaining === 1 ? "run" : "runs"} left`;
}

export function vibesBatchRefusal(
  cards: readonly { pages: number; designs: number }[],
  remaining?: number,
): string {
  const { boards, pages } = vibesBatchTotals(cards);
  if (pages > VIBES_BATCH_PAGE_LIMIT)
    return `${pages} design calls across ${boards} board${boards === 1 ? "" : "s"} — one submit stops at ${VIBES_BATCH_PAGE_LIMIT}.`;
  if (remaining !== undefined && Number.isFinite(remaining) && boards > remaining)
    return remaining === 0
      ? "Your plan's boards are all spent — this account cannot start another."
      : `${boards} boards, and your plan has ${remaining} left.`;
  return "";
}

export function vibesBatchSubmittable(cards: readonly VibesCardDraft[]): boolean {
  return vibesBatch(cards) !== null;
}
