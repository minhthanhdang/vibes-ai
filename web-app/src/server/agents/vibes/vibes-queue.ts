import "server-only";
import { after } from "next/server";
import { db } from "@/server/db";
import { runVibesPage } from "@/server/agents/vibes/run-vibes-page";
import {
  drainVibesQueue as drain,
  type VibesWorkerDeps,
} from "@/server/agents/vibes/vibes-worker";

/// The queue is the `AgentRun` table, the analyzer's own pattern
/// (multi-vibes-and-preview-prd §II.5): the enqueuer files a QUEUED `VIBES`
/// row per chain head and the worker claims it out of band, so the progress
/// query and the worker read the same row. No second job store.
///
/// This module is the binding: it owns the real database and the real page
/// run, while `vibes-worker.ts` holds the logic those two are handed to.

/// Re-exported so the callers who file a job go on reaching it here, beside
/// the worker that claims it — the split is about what has to be imported to
/// queue one, not about where the queue lives.
export { enqueueVibesPage } from "@/server/agents/vibes/vibes-enqueue";

const deps: VibesWorkerDeps = {
  db,
  runPage: (job) => runVibesPage({ db, ...job }),
};

export function drainVibesQueue() {
  return drain(deps);
}

/// Drains one job on the way out of the request that queued it, so a batch's
/// first page starts now instead of on the scheduler's next tick —
/// `kickAnalyzerWorker`'s shape and its reasons, including why a kick that
/// could not be scheduled is answered rather than thrown: the job stays
/// QUEUED and the scheduled worker is what guarantees it eventually runs.
/// This is a slow page, never a lost one.
export function kickVibesWorker(): boolean {
  try {
    after(async () => {
      try {
        await drain(deps);
      } catch (cause) {
        console.error("vibes kick failed:", cause);
      }
    });
    return true;
  } catch (cause) {
    console.error("vibes kick could not be scheduled:", cause);
    return false;
  }
}
