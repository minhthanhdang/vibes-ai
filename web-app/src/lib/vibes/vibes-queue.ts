import { VIBES_PAGE_LIMIT } from "@/lib/vibes/vibes-brief";
import type { VibesRunPage } from "@/lib/vibes/vibes-resume";

/// The rules of the vibes queue, with no database and no model in them —
/// `analyzer-queue.ts`'s sibling, deliberately in its vocabulary
/// (multi-vibes-and-preview-prd §II.5). A job is an `AgentRun` row with
/// `agent: VIBES`: the enqueuer files one QUEUED row per chain head and a
/// worker claims it later, so everything here is about what a worker may pick
/// up, what it may believe about the row, and which page the chain hands it
/// next.

/// How long a claimed job may stay RUNNING before another worker may take it.
/// Real queue pages measured 167–754s claim→settle — the PRD's ~3-minute
/// estimate was low, and 15 minutes left the 754s page only ~2.5 of margin
/// before a mid-flight double-claim spends a duplicate design call. Twenty
/// keeps the lease above both the worst measured page and the route's
/// `maxDuration = 800`, so a live invocation can never be reclaimed while a
/// dead one waits at most the difference (§II.5).
export const VIBES_LEASE_MS = 20 * 60 * 1000;

/// Per invocation. One, not the analyzer's five: an analyzer job is seconds
/// where a design page runs to minutes (754s at the measured worst), and two
/// in one invocation can exceed the route's `maxDuration` — one cannot
/// (§II.5). Because the
/// cap is one there is no `?limit` vocabulary here at all; the self-kick is
/// how a drained-but-not-empty queue advances.
export const VIBES_WORKER_JOB_LIMIT = 1;

/// Exactly `runVibesPage`'s arguments (§II.1): the board, the page, and the
/// page's 0-based position — said to the model 1-based, and the only place
/// that turns it is `vibesIntention`.
export type VibesJob = { boardId: string; pageId: string; index: number };

/// `AgentRun.input` is Json, so a row claiming to be a vibes job may carry
/// anything at all. A job whose page cannot be named is unrunnable rather than
/// retryable — the worker fails it instead of leaving it to be claimed
/// forever, the analyzer's own rule.
export function vibesJob(input: unknown): VibesJob | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const { boardId, pageId, index } = input as Record<string, unknown>;
  if (typeof boardId !== "string" || boardId.trim().length === 0) return null;
  if (typeof pageId !== "string" || pageId.trim().length === 0) return null;
  if (typeof index !== "number" || !Number.isInteger(index)) return null;
  if (index < 0 || index >= VIBES_PAGE_LIMIT) return null;
  return { boardId: boardId.trim(), pageId: pageId.trim(), index };
}

/// The instant before which a RUNNING row counts as abandoned. Compared against
/// `startedAt`, which the claim stamps, so the lease restarts on every claim.
export function vibesLeaseExpiryCutoff(now: Date, leaseMs = VIBES_LEASE_MS) {
  return new Date(now.getTime() - leaseMs);
}

export function isVibesLeaseExpired(startedAt: Date, now: Date, leaseMs = VIBES_LEASE_MS) {
  return startedAt.getTime() <= vibesLeaseExpiryCutoff(now, leaseMs).getTime();
}

/// The page the chain hands the worker after this one settles (§II.2). The
/// run's own next page or nothing when the settled page was the board's last —
/// and *not* the next pending page: a page already designed by hand still gets
/// its job, because the worker's already-designed check settles it without a
/// model call and the chain walks on, where skipping it here would be a second
/// account of what is on the board.
export function nextChainPage(
  run: readonly VibesRunPage[],
  settledIndex: number,
): VibesRunPage | null {
  return run.find((page) => page.index === settledIndex + 1) ?? null;
}
