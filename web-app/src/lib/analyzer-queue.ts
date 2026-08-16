import type { AnalysisRunStatus } from "./analysis-view";

/// The rules of the analyzer queue, with no database and no model in them.
/// A job is an `AgentRun` row: `add` files one per upload and a worker claims
/// it later, so everything here is about what a worker may pick up and what it
/// is allowed to believe about a row the client wrote.

/// How long a claimed job may stay RUNNING before another worker may take it.
/// One analyzer call is a single vision request — minutes, not hours — so a row
/// still RUNNING after this lost its worker (a killed container, a deploy) and
/// nothing will ever finish it.
export const ANALYZER_LEASE_MS = 10 * 60 * 1000;

/// Per invocation, not per queue: Vertex burst-throttles agent 2's fan-out
/// (infra.md §X), so a worker drains a few jobs and is called again rather than
/// emptying a 200-image backlog in one request.
export const WORKER_JOB_LIMIT = 5;

/// Postgres takes a long string happily; a run row full of a throttling
/// response's HTML body is unreadable in the panel and pointless in the table.
export const RUN_ERROR_LIMIT = 500;

export type AnalyzerJob = { referenceId: string };

/// `AgentRun.input` is Json the client wrote through `agent.start`, so a row
/// claiming to be an analyzer job may carry anything at all. A job whose
/// reference cannot be named is unrunnable rather than retryable — the caller
/// fails it instead of leaving it to be claimed forever.
export function analyzerJob(input: unknown): AnalyzerJob | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const referenceId = (input as Record<string, unknown>).referenceId;
  if (typeof referenceId !== "string" || referenceId.trim().length === 0) return null;
  return { referenceId: referenceId.trim() };
}

/// The instant before which a RUNNING row counts as abandoned. Compared against
/// `startedAt`, which the claim stamps, so the lease restarts on every claim.
export function leaseExpiryCutoff(now: Date, leaseMs = ANALYZER_LEASE_MS) {
  return new Date(now.getTime() - leaseMs);
}

export function isLeaseExpired(startedAt: Date, now: Date, leaseMs = ANALYZER_LEASE_MS) {
  return startedAt.getTime() <= leaseExpiryCutoff(now, leaseMs).getTime();
}

/// A caller may ask for fewer jobs than the cap but never for more, and never
/// for none — a worker invocation that drains nothing is a wasted wake-up.
export function workerJobLimit(requested?: number) {
  if (requested === undefined || !Number.isFinite(requested)) return WORKER_JOB_LIMIT;
  return Math.min(WORKER_JOB_LIMIT, Math.max(1, Math.trunc(requested)));
}

/// Whether a director asking for an analysis needs a new job filed for it.
///
/// A run already QUEUED, or RUNNING inside its lease, is the job — a second row
/// would spend a second vision call on the same image. A RUNNING row past its
/// lease is not re-queued either: `claimAnalyzerRun` reclaims that exact row,
/// so the ask is served by waking a worker rather than by another job.
export function shouldEnqueueAnalysis(run: { status: AnalysisRunStatus } | null) {
  if (!run) return true;
  return run.status !== "QUEUED" && run.status !== "RUNNING";
}

/// What goes in `AgentRun.error`. The panel renders this verbatim to the
/// director, so it has to survive a thrown non-Error and a multi-kilobyte HTML
/// body without turning into "[object Object]" or a wall of markup.
export function runErrorMessage(cause: unknown, limit = RUN_ERROR_LIMIT) {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const message = raw.replace(/\s+/g, " ").trim();
  if (!message) return "analysis failed";
  return message.length > limit ? `${message.slice(0, limit - 1)}…` : message;
}
