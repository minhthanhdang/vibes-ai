import { CATALOG_LIMIT, digestTags, type ToolReference } from "@/lib/agent/shared/reference";
import { galleryDigest } from "@/lib/agent/designer/gallery-tools";
import { normalizeHexColor } from "@/lib/analysis/analysis";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import {
  CONTRAST_BODY_MIN,
  CONTRAST_LARGE_MIN,
  paletteContrast,
  type PalettePair,
} from "@/lib/render/contrast";

export const VIBES_PAGE_LIMIT = 6;

export const VIBES_DESIGN_LIMIT = 3;

export const VIBES_FORM_LIMIT = 4;

export const VIBES_BATCH_PAGE_LIMIT = 24;

export const VIBES_PALETTE_LIMIT = 5;

export const VIBES_TEXT_LIMIT = 10000;

export const VIBES_SIZE_MIN = 320;
export const VIBES_SIZE_MAX = 4096;

export type VibesBrief = {
  purpose: string;
  pages: number;
  palette: string[];
  vibes: string;
  width: number;
  height: number;
  take?: VibesTake;
};

export type VibesTake = { design: number; designs: number };

function briefTake(value: unknown): VibesTake | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { design, designs } = value as Record<string, unknown>;
  if (typeof designs !== "number" || !Number.isInteger(designs)) return null;
  if (designs < 2 || designs > VIBES_DESIGN_LIMIT) return null;
  if (typeof design !== "number" || !Number.isInteger(design)) return null;
  if (design < 1 || design > designs) return null;
  return { design, designs };
}

function dimension(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= VIBES_SIZE_MIN && value <= VIBES_SIZE_MAX ? value : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > VIBES_TEXT_LIMIT ? null : trimmed;
}

export function briefPalette(asked: unknown): string[] | null {
  if (!Array.isArray(asked)) return null;

  const palette: string[] = [];
  for (const colour of asked) {
    const hex = normalizeHexColor(colour);
    if (!hex) return null;
    if (!palette.includes(hex)) palette.push(hex);
  }

  return palette.length >= 1 && palette.length <= VIBES_PALETTE_LIMIT ? palette : null;
}

export function vibesBrief(input: {
  purpose?: unknown;
  pages?: unknown;
  palette?: unknown;
  vibes?: unknown;
  width?: unknown;
  height?: unknown;
  take?: unknown;
}): VibesBrief | null {
  const purpose = text(input.purpose);
  if (!purpose) return null;

  const vibes = text(input.vibes ?? "");
  if (vibes === null) return null;

  const { pages } = input;
  if (typeof pages !== "number" || !Number.isInteger(pages)) return null;
  if (pages < 1 || pages > VIBES_PAGE_LIMIT) return null;

  const width = dimension(input.width);
  if (width === null) return null;

  const height = dimension(input.height);
  if (height === null) return null;

  const palette = briefPalette(input.palette);
  if (!palette) return null;

  const take = briefTake(input.take);
  if (take === null) return null;

  return { purpose, pages, palette, vibes, width, height, ...(take ? { take } : {}) };
}

export function storedBrief(value: unknown): VibesBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  if (stored.width === undefined && stored.height === undefined) {
    const preset = Object.keys(PAGE_PRESETS).find((id) => id === stored.preset) as
      | keyof typeof PAGE_PRESETS
      | undefined;
    if (preset) return vibesBrief({ ...stored, ...PAGE_PRESETS[preset] });
  }
  return vibesBrief(stored);
}

const PALETTE_PAIRS_NAMED = 3;

function pairSaid({ colours, ratio }: PalettePair): string {
  return `${colours[0]} and ${colours[1]} (${ratio.toFixed(1)}:1)`;
}

function inkLine(palette: string[]): string {
  const { body, large, widest } = paletteContrast(palette);

  const said = (pairs: PalettePair[]) =>
    pairs.slice(0, PALETTE_PAIRS_NAMED).map(pairSaid).join(", ") +
    (pairs.length > PALETTE_PAIRS_NAMED ? `, and ${pairs.length - PALETTE_PAIRS_NAMED} more` : "");

  if (body.length) {
    const holds = body.length === 1 ? "one pair holds" : `${body.length} pairs hold`;
    return (
      `Of these, ${holds} apart enough to carry small type, one on the other: ${said(body)}. ` +
      "A caption or a paragraph goes in one of them, or in near-black or near-white on the colour it stands on — and that neutral is for type too small to be read in the colours themselves, nothing larger."
    );
  }

  const cannot = widest
    ? `None of these hold apart enough to carry small type, one on the other — the widest pair is ${pairSaid(widest)}, and a small size wants ${CONTRAST_BODY_MIN}:1.`
    : "There is one colour here, and type cannot stand on itself.";

  if (large.length) {
    return (
      `${cannot} ${said(large)} will carry a headline, which needs ${CONTRAST_LARGE_MIN}:1 rather than ${CONTRAST_BODY_MIN}:1. ` +
      "Set a caption or a paragraph in near-black or near-white on the colour it stands on: at that size being read comes before staying in the direction."
    );
  }

  return (
    `${cannot} Nothing in this list will carry type on another colour in it at any size. ` +
    "So set the type — the headline and the caption both — in near-black or near-white on the colour it stands on: nothing here is readable on anything else here, and being read comes before staying in the direction. " +
    "The colours themselves are the fills and the shapes."
  );
}

function catalogLine(reference: ToolReference): string {
  const image = galleryDigest(reference);
  return [
    image.id,
    image.title,
    image.shape,
    image.starred && "starred",
    image.modificationOf
      ? [`cut of ${image.modificationOf}`, image.keeps && `keeps “${image.keeps}”`]
          .filter(Boolean)
          .join(", ")
      : image.keeps,
    digestTags(reference.analysis)?.join(", "),
    image.unread,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function vibesIntention({
  brief,
  index,
  pictures = [],
}: {
  brief: VibesBrief;
  index: number;
  pictures?: readonly ToolReference[];
}): string {
  const at = index + 1;
  const total = pictures.length;
  const listed = pictures.slice(0, CATALOG_LIMIT);

  const palette = brief.palette.join(", ");
  const earlier = index === 1 ? "Page 1 is" : `Pages 1–${index} are`;
  const beside = index === 1 ? "it" : "them";

  return [
    `Design page ${at} of ${brief.pages} of this board.`,
    `What it is for, in the user's own words: ${brief.purpose}`,
    ...(brief.vibes ? [`The feel they asked for, in their words: ${brief.vibes}`] : []),
    ...(brief.take
      ? [
          `This board is take ${brief.take.design} of ${brief.take.designs} from the same brief — the other takes are being designed on boards of their own. Commit this whole board to one distinct direction rather than hedging between the ways the brief could go; the other takes are where the other directions live.`,
        ]
      : []),
    [
      `The palette is ${palette}.`,
      `That is the colour direction of the whole set, not ${brief.palette.length === 1 ? "a single fixed value" : `${brief.palette.length} fixed values`}. Work in these colours — and where an exact hex will not do the job, mix one that belongs with them rather than forcing ${brief.palette.length === 1 ? "the one you have" : "one of the list"}: a tint to hold two things apart that would otherwise touch, a shade to sit a panel back, a step lighter or darker so type lifts off what it stands on. What must not arrive is a colour from outside the direction — nothing brighter, cooler or louder than what is here, and no second family of colour beside it.`,
      inkLine(brief.palette),
    ].join(" "),
    [
      "This page stands on nothing yet — what it stands on is yours.",
      ...(listed.length
        ? [
            "A colour from the list, laid with set_page_background, or a picture below laid full-bleed as the ground: a box covering the page and bleeding past its edges where their shapes differ, sent to the back so everything else draws over it.",
            "Where type has to cross a busy stretch of it, a panel of a palette colour under the type keeps both.",
          ]
        : ["A colour from the list, laid with set_page_background, or the paper it is on."]),
    ].join(" "),
    ...(index > 0
      ? [
          [
            `${earlier} already on this board and designed.`,
            `Read the board before you place anything, and make this page belong beside ${beside} — the same kind of type, the same palette, the same margins.`,
            `Then arrange it differently: do not repeat a layout that is already on the board. What holds across the set is the type, the palette and the margins; what has to move is where the weight sits and what the pictures do. A set is pages that recognise each other, not one page filled in ${brief.pages} times.`,
          ].join(" "),
        ]
      : []),
    ...(listed.length
      ? [
          [
            "The pictures in this project:",
            ...listed.map((picture) => `- ${catalogLine(picture)}`),
            listed.length < total
              ? `Only the first ${listed.length} of ${total} are listed. They do not all have to be used, and on a run of ${brief.pages} pages the same photograph on two of them is a set that looks thin.`
              : `They do not all have to be used, and on a run of ${brief.pages} pages the same photograph on two of them is a set that looks thin.`,
          ].join("\n"),
        ]
      : ["This project has no pictures in it. Make the page out of type, shape and colour."]),
    "Get the skill for this before you place anything. It is step 1 of how you work, and a brief this specific is where it gets skipped. One of the three is colour theory: the colours here were chosen before the page was, and spending them well is most of what this page is.",
  ].join("\n\n");
}
