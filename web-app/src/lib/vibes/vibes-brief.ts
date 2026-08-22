import { CATALOG_LIMIT, type ToolReference } from "@/lib/agent/agent-tools";
import { galleryList } from "@/lib/agent/designer-tools";
import { normalizeHexColor } from "@/lib/analysis/analysis";
import { PAGE_PRESET_IDS, type PagePresetId } from "@/lib/layout/moodboard-layouts";

/// The form the user fills in, and what it becomes (compositor-v2.md §IX).
///
/// "Let's Vibes" is the one place in this product where an agent runs without a
/// chat message asking it to: a brief goes in, a whole board comes back. What
/// makes that answerable at all is that every field is a *constraint* rather
/// than an instruction — a constraint being the kind of thing the finished
/// board can be checked against.
///
/// Both halves live here because they are one decision said twice. The brief is
/// what the form may submit; the intention is the only sentence agent 8 ever
/// reads about the ask. Splitting them would be two readings of "what did they
/// want", which is the one thing §IX.5 warns the two doors into agent 8 must
/// never become.
///
/// Pure, and that is the point (§IX.3): what the model is asked can be asserted
/// without reaching Vertex, like every other prompt in this codebase. The
/// mutations that call it are `vibes.start` and `vibes.designPage`, and neither
/// adds a word to what is built here.
///
/// No canvas, no React, no DOM.

/// §IX.4. Six design calls is already the most expensive single action a user
/// can take in this app, and it is one click from the canvas — this number and
/// the cost said on the submit button are the whole of the restraint.
export const VIBES_PAGE_LIMIT = 6;

/// Past five it is not a palette. `BOARD_PALETTE_LIMIT` 8 makes the same
/// argument about swatches, and is larger because a board's palette is read off
/// photographs rather than chosen: this one is typed by hand.
export const VIBES_PALETTE_LIMIT = 5;

/// Purpose and vibes, each. Long enough for the sentence a person actually
/// writes — "a welcome sign for a rustic autumn wedding" — and short enough
/// that the field reads as a constraint rather than as a place to put a brief.
export const VIBES_TEXT_LIMIT = 200;

/// A submitted form, once it has been read. Every field is already normalised:
/// the colours are hexes, the purpose is trimmed, the count is in range. A
/// caller holding one of these has nothing left to check.
export type VibesBrief = {
  purpose: string;
  pages: number;
  /// One to `VIBES_PALETTE_LIMIT`, in the user's own order. **The first is the
  /// theme colour** — the one `vibes.start` paints every page with before any
  /// design call runs, which is why the order is carried rather than sorted.
  palette: string[];
  /// May be empty, alone among the fields. "Warm, intimate, candlelit" is the
  /// half of a brief that does not survive being turned into a dropdown, and a
  /// user who has nothing to add there should not be made to invent something.
  vibes: string;
  /// §IX.1's added field. A welcome sign is portrait and a banner is landscape,
  /// nothing else in the form says which, and `resize_page` moves nothing — so
  /// guessing wrong costs the whole run rather than one page.
  preset: PagePresetId;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > VIBES_TEXT_LIMIT ? null : trimmed;
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
  preset?: unknown;
}): VibesBrief | null {
  const purpose = text(input.purpose);
  if (!purpose) return null;

  const vibes = text(input.vibes ?? "");
  if (vibes === null) return null;

  const { pages } = input;
  if (typeof pages !== "number" || !Number.isInteger(pages)) return null;
  if (pages < 1 || pages > VIBES_PAGE_LIMIT) return null;

  const preset = PAGE_PRESET_IDS.find((id) => id === input.preset);
  if (!preset) return null;

  if (!Array.isArray(input.palette)) return null;
  const palette: string[] = [];
  for (const asked of input.palette) {
    const hex = normalizeHexColor(asked);
    if (!hex) return null;
    /// The same colour twice is one colour, and the duplicate would otherwise
    /// spend a slot of five and read to the model as an emphasis nobody meant.
    if (!palette.includes(hex)) palette.push(hex);
  }
  if (palette.length < 1 || palette.length > VIBES_PALETTE_LIMIT) return null;

  return { purpose, pages, palette, vibes, preset };
}

/// The brief as it comes back off `Moodboard.vibesBrief` (§IX.2), or null for a
/// board that was not made by this form.
///
/// Read by the same function that read the form, and that is the whole of why
/// it is two lines: the column is a `Json` written by whatever build was running
/// the day the board was made, so it is *input* again on the way out. A brief
/// whose preset was renamed, or whose palette grew a sixth colour in an older
/// build, is refused here rather than reaching a prompt that would then promise
/// the model a page standing on a colour nothing painted.
export function storedBrief(value: unknown): VibesBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return vibesBrief(value as Record<string, unknown>);
}

/// The theme colour: the one every page stands on before a design call runs
/// (§IX.2). Named rather than read as `palette[0]` at three call sites, because
/// "the first colour" is a fact about this form and not about arrays.
export function themeColour(brief: VibesBrief): string {
  return brief.palette[0];
}

/// One picture, in the words `list_gallery` answers with (§IV.3) and the line
/// shape `page-brief` already puts a reference on. The fields and the nouns are
/// agent 8's own — a *cut*, *starred*, *not read yet* — so a photograph named
/// in the ask and the same photograph listed by the tool are one dialect rather
/// than two learned halfway through a prompt.
function catalogLine(image: ReturnType<typeof galleryList>["images"][number]): string {
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
    image.tags?.join(", "),
    image.unread,
  ]
    .filter(Boolean)
    .join(" · ");
}

/// The brief, one page of it, as the string `designPage` takes as its
/// `intention` (§IX.3).
///
/// `index` is 0-based — the page's position in `vibes.start`'s own `pageIds`,
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
/// - The palette is said as hexes and as a *closed* list. A model handed five
///   colours with no such clause treats them as a starting point, and the sixth
///   it reaches for makes a page that is fine alone and wrong in the set.
/// - Which page this is. A page that does not know it is one of six is a page
///   that tries to say everything.
/// - For page 2 and after, the coherence clause — the whole of what makes six
///   pages a set rather than six unrelated designs. It works only because
///   `read_canvas` carries the board picture (§IV.1), and it is a request, not
///   a mechanism: nothing checks, and nothing can (§IX.5).
/// - The pictures, capped at `CATALOG_LIMIT`, with the two sentences the cap
///   makes necessary. The project's whole gallery and not a canvas selection —
///   the board is new, so a selection on the board the user was looking at
///   means nothing here.
/// - A reminder to get a skill. §II.6's loop opens with it, and a brief this
///   specific is exactly where a model reads step 1 as already answered.
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
  const { images, total, shown } = galleryList(pictures, { limit: CATALOG_LIMIT });

  const palette = brief.palette.join(", ");
  const earlier = index === 1 ? "Page 1 is" : `Pages 1–${index} are`;
  const beside = index === 1 ? "it" : "them";

  return [
    `Design page ${at} of ${brief.pages} of this board.`,
    `What it is for, in the user's own words: ${brief.purpose}`,
    ...(brief.vibes ? [`The feel they asked for, in their words: ${brief.vibes}`] : []),
    [
      `The palette is ${palette}.`,
      `This page is already standing on ${themeColour(brief)} — the first of them, painted before any of this was designed.`,
      "These are the colours of the whole set: everything you draw, type and fill belongs in this list. Do not introduce another one.",
    ].join(" "),
    ...(index > 0
      ? [
          [
            `${earlier} already on this board and designed.`,
            `Read the board before you place anything, and make this page belong beside ${beside} — the same kind of type, the same palette, the same margins.`,
            "Different content, same set.",
          ].join(" "),
        ]
      : []),
    ...(images.length
      ? [
          [
            "The pictures in this project:",
            ...images.map((image) => `- ${catalogLine(image)}`),
            shown < total
              ? `Only the first ${shown} of ${total} are listed. They do not all have to be used, and on a run of ${brief.pages} pages the same photograph on two of them is a set that looks thin.`
              : `They do not all have to be used, and on a run of ${brief.pages} pages the same photograph on two of them is a set that looks thin.`,
          ].join("\n"),
        ]
      : ["This project has no pictures in it. Make the page out of type, shape and colour."]),
    "Get the skill for this before you place anything. It is step 1 of how you work, and a brief this specific is where it gets skipped.",
  ].join("\n\n");
}
