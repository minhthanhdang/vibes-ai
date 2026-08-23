import {
  boardPages,
  pageElements,
  pagesInReadingOrder,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { isPageBackground } from "@/lib/pages/page-background";
import type { VibesBrief } from "@/lib/vibes/vibes-brief";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// Where a stopped run picks up (compositor-v2.md §IX.5).
///
/// The loop that designs a Vibes board lives in the browser, which is the
/// decision §IX.2 makes on purpose — and the price of it is named in §IX.5: a
/// closed tab stops the run. The pages already made stay, the undesigned ones
/// stay empty, and the board is left half finished. This is the answer, and it
/// is small because `vibes.start` already put every page on the board: there is
/// nothing to make and nothing to remember, only a question to ask of the scene.
///
/// Which page is next is read off the board rather than off a record of what
/// ran. A record would be a second account of the same fact, kept current by
/// every design call and wrong the moment a page is discarded by hand — where
/// the scene cannot be wrong about whether anything is on a page, because being
/// on the page is what the question means.
///
/// No canvas, no React, no DOM.

export type VibesRunPage = {
  pageId: string;
  /// 0-based: the argument `vibes.designPage` takes, and the position the
  /// browser was holding when it walked `start`'s own `pageIds`. Said to the
  /// model 1-based by `vibesIntention`, which is the only place that turns it.
  index: number;
  /// Anything at all on the page that is not the page's own ground. Not "a
  /// design call finished here" — nothing on the board records that — but the
  /// question the user is actually asking when they reopen a half-finished
  /// board: is there something on this page or is it still blank?
  designed: boolean;
};

/// A page is undesigned when the only thing standing on it is the colour
/// `vibes.start` painted it.
///
/// Asked of every live element on the page rather than of the read's four
/// object kinds, because this is the one question where an arrow or a freehand
/// stroke has to count: a page somebody drew on by hand is a page a design call
/// would arrive on top of, and `unaddressable` (§XI.1) exists precisely because
/// those elements are invisible to the object read.
function pageIsBlank(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  page: BoardPage,
): boolean {
  return pageElements(elements, pages, page).every((element) => isPageBackground(element));
}

/// The same question, asked of one page by id (§IX.5).
///
/// `vibes.designPage` asks it the moment a design answers, because a design
/// that runs out of rounds does not refuse — it answers with agent 8's own "I
/// ran out of steps" line, and a run that counted those as designed pages
/// reported six successes over a board with five pages on it. The scene is the
/// only thing that knows, and it is the same reading `vibes.resume` makes when
/// the board is opened again, so the walk's account and the offer's cannot
/// disagree.
///
/// A page that is not on the board at all is not a page carrying a design: a
/// board whose page was discarded while the run was walking it has nothing
/// there to have designed.
export function vibesPageDesigned({
  elements,
  pageId,
}: {
  elements: readonly SceneElement[];
  pageId: string;
}): boolean {
  const pages = pagesInReadingOrder(boardPages(elements));
  const page = pages.find((candidate) => candidate.id === pageId);

  return page ? !pageIsBlank(elements, pages, page) : false;
}

/// The run's pages, in reading order, each with whether anything is on it.
///
/// The run is the *first* `brief.pages` pages of the board and not every page on
/// it. A seventh page added by hand after the form was submitted is the user's
/// own, and a resume that designed it would be this form spending a model call
/// nobody asked for on a page nobody offered it — which is the same failure as
/// clamping sixty pages to six, arriving a day later.
///
/// A board with fewer pages than the brief asked for is a run whose pages were
/// discarded, and what comes back is what is there. The number the model is told
/// — "page 3 of 6" — stays the brief's own, because the brief is the ask and a
/// page taken away afterwards is the user editing the result rather than
/// changing what they asked for.
export function vibesRun({
  elements,
  brief,
}: {
  elements: readonly SceneElement[];
  brief: VibesBrief;
}): VibesRunPage[] {
  const pages = pagesInReadingOrder(boardPages(elements));

  return pages.slice(0, brief.pages).map((page, index) => ({
    pageId: page.id,
    index,
    designed: !pageIsBlank(elements, pages, page),
  }));
}

/// What is left to design, in the order it has to be designed in.
///
/// Every blank page and not merely the ones after the last designed page: a run
/// stopped at page four leaves four, five and six blank and they are the same
/// three either way, while a board whose second page was discarded and drawn
/// again by hand has one hole in the middle that this fills without touching
/// what is on either side of it.
///
/// A page with something on it is never handed back. `designPage` places onto
/// the page it is given, so a second call on a designed page would put a second
/// design over the first — and the one thing a resume must not do is cost the
/// user the pages the stopped run did finish.
export function vibesPending(run: readonly VibesRunPage[]): VibesRunPage[] {
  return run.filter((page) => !page.designed);
}

export type VibesResumeOffer = {
  /// The run's own pages, which is what the user is counting against — the
  /// brief's ask, minus any page of it that has since been discarded.
  total: number;
  designed: number;
  remaining: number;
  /// Where the board got to, and what finishing it costs. Both here rather than
  /// in the panel because they are the two sentences the offer is: one says why
  /// there is a card on screen at all, and the other is on the button that
  /// spends the model calls (§IX.4).
  label: string;
  action: string;
};

/// What a half-finished board offers when it is opened again, or nothing.
///
/// Nothing is the important half. A board with every page designed makes no
/// offer at all — not an offer reading "0 pages left", which is the same
/// question answered twice and a button one misread away from laying a second
/// design over the first. The panel asks this of every board that was started
/// from a brief and shows a card only when it gets one back.
export function vibesResumeOffer(run: readonly VibesRunPage[]): VibesResumeOffer | null {
  const remaining = vibesPending(run).length;
  if (remaining === 0) return null;

  const designed = run.length - remaining;
  return {
    total: run.length,
    designed,
    remaining,
    label: `${designed} of ${run.length} ${run.length === 1 ? "page" : "pages"} designed`,
    /// The cost said the way the form's own button says it, because this press
    /// buys exactly what that one did: a design call per page, and the number
    /// belongs where it is being spent rather than in a confirmation after.
    action: remaining === 1 ? "Design the last page" : `Design ${remaining} pages`,
  };
}
