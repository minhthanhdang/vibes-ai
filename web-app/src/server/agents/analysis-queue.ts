import "server-only";
import { after } from "next/server";
import { db } from "@/server/db";
import { analyzeReference } from "@/server/agents/analyzer";
import {
  drainAnalyzerQueue as drain,
  type AnalyzerWorkerDeps,
} from "@/server/agents/analyzer-worker";

/// The queue is the `AgentRun` table: `reference.add` files a QUEUED row per
/// upload and the worker claims it out of band. There is no second job store,
/// so the panel's "how far along is it" query and the worker read the same row.
///
/// This module is the binding: it owns the real database and the real model,
/// while `analyzer-worker.ts` holds the logic those two are handed to.

/// Re-exported so the callers who file a job go on reaching it here, beside the
/// worker that claims it — the split is about what has to be imported to queue
/// one, not about where the queue lives.
export { enqueueAnalysis } from "@/server/agents/analysis-enqueue";

const deps: AnalyzerWorkerDeps = { db, analyze: analyzeReference };

export function drainAnalyzerQueue({ limit }: { limit?: number } = {}) {
  return drain(deps, limit);
}

/// Drains a job on the way out of the request that queued it, so the first
/// analysis starts now instead of on the scheduler's next tick. `after` runs
/// once the response is already sent, so the upload's round trip does not wait
/// on a vision call.
///
/// One job per kick, not the batch: this shares the tRPC function's duration
/// budget with whatever else that request is doing, and the scheduled worker
/// (infra.md §XIII) is what guarantees a backlog is eventually emptied.
///
/// Answers whether a worker was woken, because the caller has already filed the
/// job by the time it asks. `after` throws outright when there is no request to
/// run after — a command-line harness, a cron tick, any caller that is not a
/// round trip — and a wake-up that could not be scheduled is a job that starts
/// later, not a job that was lost. Reporting it as a throw is what would turn
/// filed work into a failed tool call.
export function kickAnalyzerWorker(): boolean {
  try {
    after(async () => {
      try {
        await drain(deps, 1);
      } catch (cause) {
        /// The job stays QUEUED, so the scheduler picks it up — this is a slow
        /// analysis, never a lost one.
        console.error("analyzer kick failed:", cause);
      }
    });
    return true;
  } catch (cause) {
    console.error("analyzer kick could not be scheduled:", cause);
    return false;
  }
}
