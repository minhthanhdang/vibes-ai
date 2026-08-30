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

/// Σ over the forms of designs × pages — the real bill cap, because the two
/// limits above alone allow 72 design calls. Twenty-four is ~$2.50 and about
/// an hour of worker time at the measured $0.10–0.13/page; the PRD's Part V
/// says to report what a full batch actually costs before trusting the number.
export const VIBES_BATCH_PAGE_LIMIT = 24;

/// Past five it is not a palette. `BOARD_PALETTE_LIMIT` 8 makes the same
/// argument about swatches, and is larger because a board's palette is read off
/// photographs rather than chosen: this one is typed by hand.
export const VIBES_PALETTE_LIMIT = 5;

/// Purpose and vibes, each. Room for a real brief, not just a sentence — the
/// text goes into the prompt verbatim, so the only cost of length is the
/// user's own tokens. The ceiling guards the prompt against a pasted novel,
/// nothing smaller.
export const VIBES_TEXT_LIMIT = 10000;

/// The page's edge, either dimension. 320 is about the smallest rectangle this
/// app treats as meaningful; 4096 is twice the largest preset, and the render
/// path downscales past `BOARD_RENDER_MAX_DIMENSION` anyway.
export const VIBES_SIZE_MIN = 320;
export const VIBES_SIZE_MAX = 4096;

/// A submitted form, once it has been read. Every field is already normalised:
/// the colours are hexes, the purpose is trimmed, the count is in range. A
/// caller holding one of these has nothing left to check.
export type VibesBrief = {
  purpose: string;
  pages: number;
  /// One to `VIBES_PALETTE_LIMIT`, in the user's own order. Carried rather
  /// than sorted because it is the order they typed and the order the prompt
  /// lists — nothing more is claimed of the first one: no colour here is a
  /// ground until the design agent makes it one.
  palette: string[];
  /// May be empty, alone among the fields. "Warm, intimate, candlelit" is the
  /// half of a brief that does not survive being turned into a dropdown, and a
  /// user who has nothing to add there should not be made to invent something.
  vibes: string;
  /// §IX.1's added field. A welcome sign is portrait and a banner is landscape,
  /// nothing else in the form says which, and `resize_page` moves nothing — so
  /// guessing wrong costs the whole run rather than one page. Typed as pixels
  /// rather than picked from presets: what the user knows is the rectangle.
  width: number;
  height: number;
  /// Which take this board is, when one form asked for several designs
  /// (multi-vibes-and-preview-prd §II.3). Stamped by `startBatch` — never by
  /// the form — and stored **on the brief** rather than carried in the job,
  /// because the clause it feeds must survive a resume: the worker holds
  /// nothing about a board but this column, and a board resumed a week later
  /// is still take 2 of 3. Absent on a single-design board, so the common case
  /// pays nothing.
  take?: VibesTake;
};

export type VibesTake = { design: number; designs: number };

/// The take as it comes back off the column, `undefined` for the single-design
/// board that never had one. Malformed is refused — the whole brief with it,
/// in `vibesBrief` below — rather than dropped: only our own `startBatch`
/// writes this, so a take that cannot stand up is a build disagreement, not a
/// user's typo to be quietly forgiven. A take of one is not a take.
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

/// The palette a brief would hold, or null for a list that cannot stand up.
///
/// Split out of `vibesBrief` because the form asks the same question of a draft
/// that has not got a purpose in it yet: what the colours currently in the wells
/// can carry is a fact about those colours, and a note that stayed blank until
/// the rest of the form was filled in would appear after the moment it is for.
/// One reader either way — a second normaliser in the browser is the browser and
/// the server disagreeing about which five colours were asked for.
export function briefPalette(asked: unknown): string[] | null {
  if (!Array.isArray(asked)) return null;

  const palette: string[] = [];
  for (const colour of asked) {
    const hex = normalizeHexColor(colour);
    if (!hex) return null;
    /// The same colour twice is one colour, and the duplicate would otherwise
    /// spend a slot of five and read to the model as an emphasis nobody meant.
    if (!palette.includes(hex)) palette.push(hex);
  }

  return palette.length >= 1 && palette.length <= VIBES_PALETTE_LIMIT ? palette : null;
}

/// What the form may submit, or null for a form that cannot stand up.
///
/// Refused rather than repaired, throughout. A count clamped from sixty to six
/// is six model calls the user did not ask for and is billed for; a colour
/// quietly dropped is a palette the finished board does not match; a purpose
/// truncated at 200 is a brief the model reads the front half of. Every one of
/// these is a message the form can put beside the field it belongs to, and none
/// of them is a guess this function is in a position to make.
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

/// The brief as it comes back off `Moodboard.vibesBrief` (§IX.2), or null for a
/// board that was not made by this form.
///
/// Read by the same function that read the form, and that is the whole of why
/// it is nearly two lines: the column is a `Json` written by whatever build was
/// running the day the board was made, so it is *input* again on the way out. A
/// brief whose palette grew a sixth colour in an older build is refused here
/// rather than reaching a prompt that would then hand the model a palette the
/// board was never made against. The one repair made is the preset-era brief:
/// boards written before the form took pixels carry `preset` and no dimensions,
/// and those presets name exact rectangles — so the mapping is a rename, not a
/// guess. A preset this build does not know still refuses.
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

/// Past three, the list stops being something a model reads and becomes
/// arithmetic sitting in a brief. The point it makes — there is room in this
/// palette, here is where — is already made by the widest pairs.
const PALETTE_PAIRS_NAMED = 3;

function pairSaid({ colours, ratio }: PalettePair): string {
  return `${colours[0]} and ${colours[1]} (${ratio.toFixed(1)}:1)`;
}

/// What in this palette can carry a caption, said before the page is designed.
///
/// The clause above holds the page to the palette's direction, and holding it
/// there is right — the first thing §IX.5 caught was a headline reaching outside
/// the five. What a palette cannot do on its own is carry type, and the census says so in numbers: of
/// the 196 pairs on this database that came in under what their size wants
/// (`render/contrast.ts`), **129 stood on a ground for which the brief holds no
/// legible ink at all**. One six-page lookbook's five hexes have no pair over
/// 1.95:1 in them, so every one of its 86 failures was a page obeying its brief.
/// A palette is chosen for mood, by a person, in a form with five colour wells
/// in it; nothing about that act has any reason to leave a readable pair behind.
///
/// So the pairs are worked out here and handed over, and where there are none
/// the model is given the one thing it may add — near-black or near-white. Its
/// scope follows the palette rather than a rule: a list holding a pair that
/// carries a headline keeps its headlines, and a list holding nothing that
/// carries type at any size gets the neutral for those too. §IX.5's first
/// finding was a page that "drifted" into a black headline on the warm brief;
/// measured, it is the only page in that six-page run with a legible line on
/// it, and all 86 of the run's failures are a brief colour on a brief colour.
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

  /// A palette of one is a legal form (`VIBES_PALETTE_LIMIT` has no floor above
  /// 1), and a sentence about its pairs would be a sentence about nothing.
  const cannot = widest
    ? `None of these hold apart enough to carry small type, one on the other — the widest pair is ${pairSaid(widest)}, and a small size wants ${CONTRAST_BODY_MIN}:1.`
    : "There is one colour here, and type cannot stand on itself.";

  if (large.length) {
    return (
      `${cannot} ${said(large)} will carry a headline, which needs ${CONTRAST_LARGE_MIN}:1 rather than ${CONTRAST_BODY_MIN}:1. ` +
      "Set a caption or a paragraph in near-black or near-white on the colour it stands on: at that size being read comes before staying in the direction."
    );
  }

  /// Nothing in the list carries type on anything else in it at any size, so
  /// holding the neutral back for small type would be handing the model a
  /// headline it has no legible way to set — which is exactly what the run
  /// this clause was built from did, and what the one page in six that broke
  /// the rule got right (§IX.5).
  return (
    `${cannot} Nothing in this list will carry type on another colour in it at any size. ` +
    "So set the type — the headline and the caption both — in near-black or near-white on the colour it stands on: nothing here is readable on anything else here, and being read comes before staying in the direction. " +
    "The colours themselves are the fills and the shapes."
  );
}

/// One picture, in agent 8's own nouns (§IV.3) and the line shape `page-brief`
/// already puts a reference on — a *cut*, *starred*, *not read yet* — so a
/// photograph named in the ask and the same photograph listed by the tool are
/// one dialect rather than two learned halfway through a prompt.
///
/// The tags stay flattened onto the line here even though `list_gallery` now
/// answers them dimension by dimension: this is a paragraph a model reads
/// before it has a board, and a brief carrying six headings and a rationale per
/// picture is the tool answer written out longhand in the one place it cannot
/// be skipped.
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

/// The brief, one page of it, as the string `designPage` takes as its
/// `intention` (§IX.3).
///
/// `index` is 0-based — the page's position in `vibes.startBatch`'s own `pageIds`,
/// which is what the browser is holding when it makes the call — and is said to
/// the model 1-based, because "page 3 of 6" is the only form of that sentence
/// anybody writes.
///
/// Every clause below is here because leaving it out has a named failure, and
/// none of them is decoration:
///
/// - The purpose and the vibes go in **verbatim**. Paraphrasing a brief is the
///   one thing a brief cannot survive, and this function is the last place that
///   could do it.
/// - For a board that is one take of several (§II.3), which take it is. Two
///   boards from the same brief differ only by nondeterminism unless told
///   otherwise, and the failure the clause guards against is the hedge — three
///   takes that each keep every option open are one board three times. Whether
///   it works is a fixture-run eyeballing, the coherence clause's own proof.
/// - The palette is said as hexes and as a **direction** rather than as five
///   fixed values. A model handed five colours with no clause at all treats
///   them as a starting point, and the sixth it reaches for — a colour of its
///   own family — makes a page that is fine alone and wrong in the set. But the
///   clause that shut the list to those exact hexes bought that at a price: a
///   page has no tint to hold two blocks apart and no step to lift type off its
///   ground, so it forces one of the listed hexes where none of them fits. So the
///   clause names what may not arrive — a colour from outside the direction,
///   brighter, cooler, louder, or a second family beside it — and leaves the
///   mixing inside it to the design.
/// - And with it, which of those colours can carry small type on which, and the
///   neutral ink to reach for when none of them can. `inkLine` below carries the
///   census: staying in the palette is what keeps a page in the set and is also
///   what makes two thirds of this product's unreadable pages unreadable, and
///   only the other third was ever the design's to avoid.
/// - The ground clause. Across the eight boards of the 2026-08-29 batch run
///   every page kept the flat theme ground `startBatch` had painted it, and the
///   user read the set as unfinished — "the pages with plain background color
///   look very bad". The first shape of this clause argued the model off that
///   ground while the same paragraph told it the ground was already laid, which
///   is the wrong shape: painting a page and then asking the model to reconsider
///   is not a decision handed over. So the page arrives unpainted (`vibes-start.ts`)
///   and the clause only says so — the ground is the design agent's, including
///   its being no ground at all. What to do with it is not re-taught here: §V's
///   `colour-theory` is where dark and cream grounds and type over them live,
///   and the last clause below is what sends the model to read it.
/// - Which page this is. A page that does not know it is one of six is a page
///   that tries to say everything.
/// - For page 2 and after, the coherence clause — the whole of what makes six
///   pages a set rather than six unrelated designs. It works only because
///   `read_canvas` carries the board picture (§IV.1), and it is a request, not
///   a mechanism: nothing checks, and nothing can (§IX.5).
/// - With it, and only for those same pages, what must **not** match: the
///   arrangement. A clause that asks a page to look like the ones before it and
///   says nothing about what should move is answered exactly — the six-page run
///   in §IX.4 came back as one template filled six times, identical weight to
///   the decimal, and it was "different content, same set" honoured to the
///   letter. Naming the axis that holds and the axis that moves is the whole
///   fix; asking for variety in the abstract is how a set stops being one.
/// - The pictures, capped at `CATALOG_LIMIT`, with the two sentences the cap
///   makes necessary. The project's whole gallery and not a canvas selection —
///   the board is new, so a selection on the board the user was looking at
///   means nothing here.
/// - A reminder to get a skill, and one of the three named. §II.6's loop opens
///   with the reminder, and a brief this specific is exactly where a model
///   reads step 1 as already answered — but the ledger says the reminder alone
///   is not enough. Over the 33 designs that recorded which of §V's thirteen
///   they read (`npm run design:runs`), `colour-theory` was read by **none**,
///   and none of the 23 whose intention carried a palette of hexes either: the
///   reading goes to the occupation and two ways of arranging a page, every
///   time. Two runs with the ask written into agent 8's
///   own instruction instead (compositor-v2.md §II.5) changed nothing, which is
///   what puts the sentence here: a brief that hands over five colours is the
///   one place that knows the page is a colour problem, and the choice is made
///   in round 1 off the words in front of the model.
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
  /// Capped here rather than by `list_gallery`, which lists a project whole:
  /// this is a prompt paragraph and it is written before the model has asked
  /// for anything, so the ceiling is the brief's own.
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
