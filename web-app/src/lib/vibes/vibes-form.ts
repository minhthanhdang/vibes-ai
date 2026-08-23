import { normalizeHexColor } from "@/lib/analysis/analysis";
import { mergedPalette } from "@/lib/canvas/moodboard-palette";
import { PAGE_PRESET_IDS, type PagePresetId } from "@/lib/layout/moodboard-layouts";
import { CONTRAST_BODY_MIN, paletteContrast } from "@/lib/render/contrast";
import {
  briefPalette,
  VIBES_PAGE_LIMIT,
  VIBES_PALETTE_LIMIT,
  VIBES_TEXT_LIMIT,
  vibesBrief,
} from "./vibes-brief";

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
  preset: PagePresetId;
};

/// Three, out of one to six. A run is billed per page, so the default is the
/// number a user would have picked anyway rather than the ceiling — a form
/// opening on six is a form that charges the maximum to anyone who does not
/// read it.
export const VIBES_DEFAULT_PAGES = 3;

/// The ground offered to a project with nothing analysed in it yet. White is
/// the one colour that cannot be a wrong guess: it is what an unpainted page
/// already stands on, so accepting the offer changes nothing about the board
/// and only makes the palette a list the model is held to.
export const VIBES_DEFAULT_COLOUR = "#ffffff";

/// A landscape page, the shape a board's pages come at by default. Not a guess
/// at the ask — nothing in an empty form says portrait or landscape — but the
/// shape the rest of this product already opens on, so the field starts where
/// the user's other boards are.
export const VIBES_DEFAULT_PRESET: PagePresetId = "LANDSCAPE_HD";

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
/// §IX.1 offers it and the two fields do not fit: `Project.brief` is 5,000
/// characters of what the project is for and `vibes` is 200 characters of how
/// one board should feel, so the prefill's usual case is a form that opens
/// already refusing itself.
export function vibesDraft({ palettes }: { palettes: readonly (readonly unknown[])[] }): VibesDraft {
  const merged = mergedPalette(palettes).slice(0, VIBES_PALETTE_LIMIT);

  return {
    purpose: "",
    pages: VIBES_DEFAULT_PAGES,
    palette: merged.length ? merged : [VIBES_DEFAULT_COLOUR],
    vibes: "",
    preset: VIBES_DEFAULT_PRESET,
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

  if (!PAGE_PRESET_IDS.includes(draft.preset)) refusals.preset = "Choose a page size.";

  const unreadable = draft.palette.find((colour) => !normalizeHexColor(colour));
  const colours = new Set(draft.palette.map((colour) => normalizeHexColor(colour)));
  if (unreadable !== undefined) refusals.palette = `“${unreadable}” is not a colour.`;
  else if (colours.size < 1) refusals.palette = "One colour at least — the first is the one every page is printed on.";
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
