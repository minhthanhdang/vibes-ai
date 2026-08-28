import { addPage } from "@/lib/pages/page-add";
import { setPageBackground } from "@/lib/pages/page-background";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import {
  DEFAULT_BOARD_TITLE,
  normalizedBoardTitle,
} from "@/lib/scene/moodboard-boards";
import { themeColour, type VibesBrief } from "@/lib/vibes/vibes-brief";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The board a brief becomes, before any model has been asked anything
/// (compositor-v2.md §IX.2).
///
/// `vibes.start` makes no model call at all: it is the deterministic half of
/// the run, and everything it decides is decided from the form. What it costs
/// to get wrong is the whole run, though, because the pages it draws are the
/// pages six design calls are then handed — so this is the half worth being
/// pure and worth asserting.
///
/// Three things are settled here rather than by page 1, and each of them is the
/// reason the pages are made up front instead of by the design calls themselves:
///
/// - the board is the right *shape* immediately, so the user watches known
///   pages fill in rather than wondering how many are coming;
/// - each design call is handed a `pageId` rather than a `newPage` flag, so six
///   sequential calls race over nothing;
/// - the ground is painted once, by the form, rather than chosen by page 1 and
///   then matched five times by pages that can only see it in a picture.
///
/// No canvas, no React, no DOM.

export type VibesBoard = {
  /// What the tab row will call it. The purpose is the only thing in the form
  /// that names what is being made, so it is the title — a board called
  /// "Untitled board" beside five others is the one thing the form has enough
  /// to avoid.
  title: string;
  /// The board's default page size — `Moodboard.widthPx`/`heightPx`. The preset
  /// the user chose, so a seventh page added by hand afterwards comes at the
  /// shape the set is in rather than at the app's own default.
  size: { width: number; height: number };
  elements: SceneElement[];
  /// In reading order, which here is creation order: the chain walks this
  /// array one queue job at a time, and each job's index is what the model is
  /// told as "page 3 of 6".
  pageIds: string[];
};

/// The scene a submitted form starts as: `brief.pages` empty pages at the
/// chosen preset, side by side, each already standing on the theme colour.
///
/// The pages are drawn one at a time against the array the one before left, so
/// `nextPageBox` lays them out as the spread §V.2 describes — the same path a
/// user pressing "another page" takes, rather than a second one that computes
/// its own gaps.
export function vibesBoard({
  brief,
  makeId = () => crypto.randomUUID(),
}: {
  brief: VibesBrief;
  makeId?: () => string;
}): VibesBoard {
  const size = PAGE_PRESETS[brief.preset];
  const ground = themeColour(brief);

  let elements: SceneElement[] = [];
  const pageIds: string[] = [];

  for (let n = 0; n < brief.pages; n += 1) {
    const added = addPage({ elements, defaultSize: size, makeId });
    /// The ground goes on immediately, page by page, because the next page's
    /// box is computed from the array this one leaves — and a background that
    /// arrived in a second pass would be a second walk over the same pages for
    /// no gain.
    const painted = setPageBackground({
      elements: added.elements,
      page: added.page,
      colour: ground,
      makeId,
    });
    elements = painted?.elements ?? added.elements;
    pageIds.push(added.page.id);
  }

  return {
    title: normalizedBoardTitle(brief.purpose) ?? DEFAULT_BOARD_TITLE,
    size: { width: size.width, height: size.height },
    elements,
    pageIds,
  };
}
