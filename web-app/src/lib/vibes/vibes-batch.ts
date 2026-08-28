import type { VibesPageState } from "@/lib/vibes/vibes-loop";
import { vibesJob } from "@/lib/vibes/vibes-queue";

/// A run's account of itself, read off the queue rather than off a loop
/// (multi-vibes-and-preview-prd §II.6). The browser used to hold the run as a
/// value (`vibes-loop.ts`) because the browser was driving; the worker drives
/// now, so what the panel draws is a *reading* of the `VIBES` rows — the same
/// rows the worker claims and settles, so the progress and the work cannot
/// disagree. One card per board still walking, or settled recently enough that
/// the user watching is owed the ending.
///
/// The vocabulary is `vibes-loop.ts`'s on purpose — the marks, the counts and
/// the sentences carried over — because the panel's rendering carries over,
/// and because those sentences were argued for once already. What is gone is
/// everything that was a fact about a *request* rather than about a page: the
/// step queue, the halt flag, the live rounds of the page in flight. The queue
/// has no window onto a page's rounds and the panel polls instead of watching.
///
/// No database and no React in here: the query hands in rows and boards, and
/// everything else is arithmetic.

/// How long a settled row stays in the progress query's read (§II.6). Long
/// enough that a run's ending is seen across a few polls — the refusal
/// sentence, the final count — and short enough that yesterday's run does not
/// greet the user as a card. After the window the scene speaks instead: a
/// half-finished board makes its resume offer off `vibesRun`, which reads what
/// is actually on the pages.
export const VIBES_SETTLED_WINDOW_MS = 2 * 60 * 1000;

/// The instant before which a settled row is no longer the panel's business.
export function vibesSettledCutoff(now: Date): Date {
  return new Date(now.getTime() - VIBES_SETTLED_WINDOW_MS);
}

/// One `VIBES` row as the progress query reads it. `input` and `output` arrive
/// as Json and are believed only through their guards: a row that cannot name
/// its page cannot be drawn.
export type VibesQueueRow = {
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  input: unknown;
  output: unknown;
  error: string | null;
  /// The enqueue stamp, restarted by every claim — which makes it the tie
  /// breaker when one page has two rows (a refusal resumed inside the settled
  /// window files a second row for the same index; the newer one is the run
  /// that is true now).
  startedAt: Date;
};

export type VibesBatchBoard = {
  boardId: string;
  title: string;
  /// The brief's own page count, the number the user is watching against —
  /// `VibesLoop.total`'s meaning, unchanged.
  total: number;
};

export type VibesBoardProgress = {
  boardId: string;
  title: string;
  total: number;
  /// Pages carrying a design, including the ones a resumed chain never got a
  /// row for — the gaps before the chain head are exactly the pages `resume`
  /// skipped because they were already designed.
  designed: number;
  /// Pages that answered with nothing on them (§IX.5's third outcome).
  empty: number;
  /// Rows that reached a terminal status — what "3 of 6" is counted from, and
  /// the number whose rising is the panel's cue to reload an open board.
  settled: number;
  /// A QUEUED or RUNNING row exists: the chain is still walking and the panel
  /// keeps polling.
  live: boolean;
  finished: boolean;
  /// Why the chain stopped short, when it did — a refusal's own sentence or a
  /// FAILED row's error, one vocabulary because the panel says them the same
  /// way (`vibes-loop.ts` folded a network error into a refusal for the same
  /// reason).
  refusal: string | null;
  pages: { index: number; state: VibesPageState }[];
  /// The one sentence the user is owed, derived here rather than in the
  /// component — `vibesLoopProgress`'s reason, unchanged.
  label: string;
};

type PageReading = {
  index: number;
  state: VibesPageState;
  reason: string | null;
  live: boolean;
  startedAt: Date;
};

/// What one row says about its page. QUEUED and RUNNING both read "designing":
/// the head is QUEUED only for the moment between a settle and the self-kick's
/// claim (or at worst a cron tick, §II.5), and a mark that flickered
/// "waiting" for that moment would say the run paused when it did not.
function pageReading(row: VibesQueueRow, index: number): PageReading {
  const at = { index, startedAt: row.startedAt };
  if (row.status === "QUEUED" || row.status === "RUNNING")
    return { ...at, state: "designing", reason: null, live: true };
  if (row.status === "FAILED")
    return { ...at, state: "refused", reason: row.error ?? "the page failed", live: false };

  /// SUCCEEDED: the worker's own `{ outcome }` vocabulary (§II.1). A row whose
  /// output cannot be read is counted designed — SUCCEEDED means the job ran
  /// to its answer, and the scene is the account that cannot be wrong about
  /// what is on the page (`vibes-resume.ts` reads it for the offer).
  const output =
    typeof row.output === "object" && row.output !== null && !Array.isArray(row.output)
      ? (row.output as Record<string, unknown>)
      : {};
  if (output.outcome === "empty") return { ...at, state: "empty", reason: null, live: false };
  if (output.outcome === "refused")
    return {
      ...at,
      state: "refused",
      reason: typeof output.reason === "string" ? output.reason : "the page was refused",
      live: false,
    };
  return { ...at, state: "designed", reason: null, live: false };
}

/// Which of two rows about the same page is the one that is true now: a live
/// row always — it exists because someone resumed past the settled one — and
/// otherwise the newer claim.
function truer(claim: PageReading, held: PageReading): boolean {
  if (claim.live !== held.live) return claim.live;
  return claim.startedAt.getTime() >= held.startedAt.getTime();
}

function pagesSaid(count: number) {
  return count === 1 ? "1 page" : `${count} pages`;
}

/// Every active board's card, in the order the boards were handed in (the
/// query orders them by creation, which is the tab row's own order). A board
/// with no readable rows has nothing to say and gets no card.
export function vibesBatchProgress(
  rows: readonly VibesQueueRow[],
  boards: readonly VibesBatchBoard[],
): VibesBoardProgress[] {
  const readings = new Map<string, Map<number, PageReading>>();
  for (const row of rows) {
    const job = vibesJob(row.input);
    if (!job) continue;
    const board = readings.get(job.boardId) ?? new Map<number, PageReading>();
    readings.set(job.boardId, board);
    const claim = pageReading(row, job.index);
    const held = board.get(job.index);
    if (!held || truer(claim, held)) board.set(job.index, claim);
  }

  return boards.flatMap((board) => {
    const perPage = readings.get(board.boardId);
    if (!perPage) return [];
    const known = [...perPage.keys()].filter((index) => index < board.total);
    if (known.length === 0) return [];

    /// The chain files rows one page at a time from its head to the board's
    /// last page, so the rows cover a contiguous stretch — a page below the
    /// head never got a row because it already carried a design when the run
    /// was started or resumed (`vibesLoopPages` made the same inference from
    /// the gaps in its step queue), and a page above the furthest row is one
    /// the chain has not reached.
    const head = Math.min(...known);
    const pages = Array.from({ length: board.total }, (_, index) => {
      const reading = perPage.get(index);
      if (reading) return { index, state: reading.state };
      return { index, state: (index < head ? "designed" : "waiting") as VibesPageState };
    });

    const walking = [...perPage.values()].find((reading) => reading.live) ?? null;
    const refused = [...perPage.values()].find((reading) => reading.state === "refused") ?? null;
    const designed = pages.filter((page) => page.state === "designed").length;
    const empty = pages.filter((page) => page.state === "empty").length;
    const waiting = pages.some((page) => page.state === "waiting");

    return [
      {
        boardId: board.boardId,
        title: board.title,
        total: board.total,
        designed,
        empty,
        settled: [...perPage.values()].filter((reading) => !reading.live).length,
        live: walking !== null,
        finished: !walking && !refused && !waiting,
        refusal: refused?.reason ?? null,
        pages,
        label: walking
          ? `Designing page ${walking.index + 1} of ${board.total}…`
          : refused
            ? `Page ${refused.index + 1} was not designed — ${refused.reason}`
            : waiting
              ? /// No live row, no refusal, pages still blank: the chain head
                /// was deleted, which is what `vibes.stop` does — the queue's
                /// reading of the halt the loop used to hold as a flag.
                `Stopped — ${pagesSaid(designed)} of ${board.total} designed`
              : designed === board.total
                ? `${pagesSaid(designed)} designed`
                : empty > 0
                  ? `${pagesSaid(designed)} of ${board.total} designed — ${pagesSaid(empty)} came back empty`
                  : `${pagesSaid(designed)} of ${board.total} designed`,
      },
    ];
  });
}
