import type { VibesRunPage } from "@/lib/vibes/vibes-resume";

/// The browser's loop, as a value (compositor-v2.md §IX.2).
///
/// The run is sequential and browser-driven on purpose: there is no queue and
/// no streaming in this app, so six pages in one mutation would be one request
/// running for minutes with nothing to show and nothing to stop. Six mutations
/// are bounded work, honest progress, a failure at page four that keeps pages
/// one to three, and a Stop button that means it — and every one of those four
/// is a claim about *state*, which is why the state is here and not inside a
/// component.
///
/// So this module holds what the loop knows and the component holds only the
/// awaiting: which page goes next, what the last one came back with, whether
/// there is anything left to ask for, and the one sentence the user is owed
/// while they watch. None of it touches React, tRPC or the DOM.

export type VibesStep = Pick<VibesRunPage, "pageId" | "index">;

/// What `vibes.designPage` answers with, which is a page designed or a page
/// refused — never a throw. The mutation returns its refusal rather than
/// raising it (§IX.2) precisely so this loop can stop holding the pages before
/// it; a network error the browser never got an answer to is folded into the
/// same shape by the caller, because to the run they are the same event.
export type VibesPageOutcome =
  | { pageId: string; line: string }
  | { pageId: string; error: string };

export type VibesSettledPage = VibesStep &
  ({ designed: true; line: string } | { designed: false; error: string });

/// Why the loop is not asking for another page. `"stopped"` is the user's
/// press, `"refused"` is a page that came back without a design — and they are
/// two words rather than one flag because the panel says different things about
/// them and only one of them is a failure.
export type VibesHalt = "stopped" | "refused";

export type VibesLoop = {
  boardId: string;
  title: string;
  /// The brief's own page count, which is what the user is watching against.
  /// Not `steps.length`: a resumed run walks three pages of a board that was
  /// asked for six, and "page 4 of 6" is the true sentence there.
  total: number;
  steps: readonly VibesStep[];
  settled: readonly VibesSettledPage[];
  halt: VibesHalt | null;
};

export function vibesLoop({
  boardId,
  title,
  total,
  steps,
}: {
  boardId: string;
  title: string;
  total: number;
  steps: readonly VibesStep[];
}): VibesLoop {
  return { boardId, title, total, steps, settled: [], halt: null };
}

/// The page to ask for now, or nothing left to ask for.
///
/// Position in `steps` and not a cursor of its own: the loop asks for one page
/// at a time and waits, so how many have settled *is* where it is, and a second
/// number would be the one that can disagree.
export function vibesLoopNext(loop: VibesLoop): VibesStep | null {
  if (loop.halt) return null;
  return loop.steps[loop.settled.length] ?? null;
}

/// A page came back. The step is taken from the queue rather than from the
/// answer — the answer carries a `pageId` and nothing else the loop trusts — so
/// an outcome for a page nobody asked about cannot advance the run.
///
/// Recorded even when the user has already pressed Stop: the request was
/// already in flight, the page really was designed, and dropping it would be
/// the run lying about work the user paid for.
export function vibesLoopSettled(loop: VibesLoop, outcome: VibesPageOutcome): VibesLoop {
  const step = loop.steps[loop.settled.length];
  if (!step || step.pageId !== outcome.pageId) return loop;

  const settled: VibesSettledPage =
    "line" in outcome
      ? { ...step, designed: true, line: outcome.line }
      : { ...step, designed: false, error: outcome.error };

  return {
    ...loop,
    settled: [...loop.settled, settled],
    /// A refusal stops the run rather than skipping to the next page. Whatever
    /// refused page four — a quota, a picture the model could not fetch, a
    /// board that went away — is almost always still true for page five, and
    /// the pages already designed are kept either way. `vibes.resume` is how
    /// the rest is picked up once the reason is gone.
    halt: settled.designed ? loop.halt : "refused",
  };
}

/// The Stop button. The page in flight is not cancelled — a tRPC mutation has
/// no abort that reaches the model, and pretending otherwise would show a run
/// stopped while a design was still being written to the board — so this is
/// "ask for no more pages", which is the only promise the browser can keep.
export function vibesLoopStopped(loop: VibesLoop): VibesLoop {
  if (loop.halt) return loop;
  return { ...loop, halt: "stopped" };
}

export type VibesProgress = {
  /// The page being designed right now, 1-based and the user's own numbering,
  /// or nothing while no request is in flight.
  page: number | null;
  total: number;
  /// Pages of the run that carry a design, including the ones that were already
  /// designed when a resumed loop picked it up.
  designed: number;
  running: boolean;
  finished: boolean;
  /// The reason the run stopped short, said the way the page said it.
  refusal: string | null;
  label: string;
};

function pages(count: number) {
  return count === 1 ? "1 page" : `${count} pages`;
}

/// The one sentence the user is owed. Everything the panel draws is derived
/// here rather than in the component, because "3 of 6 designed" is exactly the
/// kind of arithmetic that is wrong for a week before anybody notices.
export function vibesLoopProgress(loop: VibesLoop): VibesProgress {
  const next = vibesLoopNext(loop);
  const done = loop.settled.filter((page) => page.designed).length;
  /// Pages the loop never had to ask about — a resumed run's finished pages.
  /// They are part of what the user is looking at even though this loop did not
  /// make them.
  const designed = loop.total - loop.steps.length + done;
  const refused = loop.settled.find(
    (page): page is Extract<VibesSettledPage, { designed: false }> => !page.designed,
  );

  return {
    page: next ? next.index + 1 : null,
    total: loop.total,
    designed,
    running: next !== null,
    finished: next === null,
    refusal: refused?.error ?? null,
    label: next
      ? `Designing page ${next.index + 1} of ${loop.total}…`
      : refused
        ? `Page ${refused.index + 1} was not designed — ${refused.error}`
        : loop.halt === "stopped"
          ? `Stopped — ${pages(designed)} of ${loop.total} designed`
          : designed === loop.total
            ? `${pages(designed)} designed`
            : `${pages(designed)} of ${loop.total} designed`,
  };
}

export type VibesPageState = "designed" | "designing" | "waiting" | "refused";

/// Every page of the run and what is happening to it, in the user's own order.
///
/// The panel draws one mark per page rather than a bar, because the thing being
/// watched is a known set of pages filling in — that is the whole reason
/// `vibes.start` makes them all up front (§IX.2) — and a bar would say the one
/// thing this run does not have to guess at.
///
/// A page the loop was never handed is already designed: `vibesPending` only
/// hands back the blank ones, so a resumed run's finished pages are exactly the
/// gaps in `steps`.
export function vibesLoopPages(loop: VibesLoop): { index: number; state: VibesPageState }[] {
  const settled = new Map(loop.settled.map((page) => [page.index, page]));
  const walking = new Set(loop.steps.map((step) => step.index));
  const next = vibesLoopNext(loop);

  return Array.from({ length: loop.total }, (_, index) => {
    const done = settled.get(index);
    if (done) return { index, state: done.designed ? "designed" : "refused" };
    if (next && next.index === index) return { index, state: "designing" };
    return { index, state: walking.has(index) ? "waiting" : "designed" };
  });
}
