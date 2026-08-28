import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { runErrorMessage } from "@/lib/analysis/analyzer-queue";
import {
  VIBES_WORKER_JOB_LIMIT,
  nextChainPage,
  vibesJob,
  vibesLeaseExpiryCutoff,
  type VibesJob,
} from "@/lib/vibes/vibes-queue";
import { storedBrief } from "@/lib/vibes/vibes-brief";
import { vibesRun } from "@/lib/vibes/vibes-resume";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import { enqueueVibesPage } from "@/server/agents/vibes/vibes-enqueue";
import type { VibesOutcome } from "@/server/agents/vibes/run-vibes-page";

/// The vibes worker's body, with the database and the page run handed in
/// rather than imported — `analyzer-worker.ts`'s shape, one queue over
/// (multi-vibes-and-preview-prd §II.5). `vibes-queue.ts` binds the real ones;
/// a test binds fakes, which is the only way to exercise the parts with no
/// pure form: the claim's compare-and-set, the settle that chain-enqueues the
/// next page in its own transaction, and the promise that a failing job ends
/// as a FAILED row instead of an exception that abandons the queue.
///
/// The delegates are `Pick`ed off the real `PrismaClient` so production keeps
/// full type checking on every call; only the fake has to be cast.
export type VibesWorkerDb = Pick<PrismaClient, "$transaction"> & {
  agentRun: Pick<PrismaClient["agentRun"], "findMany" | "updateMany" | "create">;
  moodboard: Pick<PrismaClient["moodboard"], "findUnique">;
};

export type VibesWorkerDeps = {
  db: VibesWorkerDb;
  /// `runVibesPage` in production. The worker never reaches for agent 8
  /// itself: one door (contract.test.mts), and this is how the door is handed
  /// in without the test paying for it.
  runPage: (job: VibesJob) => Promise<VibesOutcome>;
  now?: () => Date;
  onFailure?: (runId: string, cause: unknown) => void;
};

export type ClaimedVibesRun = {
  id: string;
  projectId: string;
  input: unknown;
  /// The claim's own fresh stamp, not the row's old one: the settle proves it
  /// still owns the row against exactly this instant (see `runClaimedVibesJob`).
  claimedAt: Date;
};

/// How many rows to look at per claim attempt. Only matters when several
/// workers race: each loses at most this many CAS attempts before giving up.
const CLAIM_CANDIDATES = 10;

/// What goes in `AgentRun.output` on settle (§II.1): the worker's own
/// vocabulary, which the progress query reads back. A refusal is SUCCEEDED —
/// the job ran to its answer and the answer was no — where FAILED is an
/// exception, and both end the chain.
type VibesSettle =
  | { outcome: "designed"; runId: string }
  | { outcome: "designed"; alreadyDesigned: true }
  | { outcome: "empty"; runId: string }
  | { outcome: "refused"; reason: string };

/// Claims one job for this worker, or null when there is nothing to do.
///
/// Rows are taken oldest-first, and a RUNNING row whose lease has expired is
/// taken too — a worker killed mid-page (a deploy, an OOM) would otherwise
/// leave its board half-finished permanently. The claim is a compare-and-set
/// on the exact `(status, startedAt)` it read, so two workers reaching for the
/// same row cannot both win it, and the winner's fresh `startedAt` starts its
/// lease.
export async function claimVibesRun({
  db,
  now = () => new Date(),
}: VibesWorkerDeps): Promise<ClaimedVibesRun | null> {
  const cutoff = vibesLeaseExpiryCutoff(now());
  const candidates = await db.agentRun.findMany({
    where: {
      agent: AgentKind.VIBES,
      OR: [
        { status: RunStatus.QUEUED },
        { status: RunStatus.RUNNING, startedAt: { lte: cutoff } },
      ],
    },
    orderBy: { startedAt: "asc" },
    take: CLAIM_CANDIDATES,
    select: { id: true, projectId: true, input: true, status: true, startedAt: true },
  });

  for (const candidate of candidates) {
    const claimedAt = now();
    const claim = await db.agentRun.updateMany({
      where: { id: candidate.id, status: candidate.status, startedAt: candidate.startedAt },
      data: { status: RunStatus.RUNNING, startedAt: claimedAt, error: null },
    });
    if (claim.count === 1) {
      return { id: candidate.id, projectId: candidate.projectId, input: candidate.input, claimedAt };
    }
  }
  return null;
}

/// Runs one claimed job to a terminal state. Never throws: a job that fails is
/// a FAILED row the panel explains to the user, not a 500 that would also
/// abandon the jobs queued behind it.
///
/// The scene is read *before* the model call, and it answers two questions off
/// one read: whether this page is already designed — the reclaim-after-crash
/// case (§II.2), settled with no model call — and which page the chain hands
/// over next. The page list is stable under the design itself (a design places
/// onto a page; it moves no frame), so the read being minutes older than the
/// settle changes nothing the chain depends on.
export async function runClaimedVibesJob(deps: VibesWorkerDeps, run: ClaimedVibesRun) {
  const { db, runPage, now = () => new Date(), onFailure = defaultOnFailure } = deps;
  try {
    /// Nothing to retry — a row that cannot name its page is never going to
    /// become runnable, so it is failed rather than left to be claimed again.
    const job = vibesJob(run.input);
    if (!job) throw new Error("vibes job names no page");

    const board = await db.moodboard.findUnique({
      where: { id: job.boardId },
      select: { elements: true, vibesBrief: true },
    });
    if (!board) throw new Error(`no board called ${job.boardId} — the run's board is gone`);
    const brief = storedBrief(board.vibesBrief);
    if (!brief) throw new Error(`the board ${job.boardId} was not started from a Vibes brief`);

    const pages = vibesRun({ elements: persistableElements(board.elements), brief });
    const alreadyDesigned = pages.some((page) => page.pageId === job.pageId && page.designed);

    const output: VibesSettle = alreadyDesigned
      ? { outcome: "designed", alreadyDesigned: true }
      : settle(await runPage(job));

    /// A refusal does not extend the chain (§II.2): whatever refused page N is
    /// almost always still true for page N+1, and the resume door is how the
    /// rest is picked up once the reason is gone.
    const next = output.outcome === "refused" ? null : nextChainPage(pages, job.index);

    /// Settle and chain-enqueue in one transaction — a settled page whose next
    /// job was never filed is a chain that silently ends (§II.2). The settle is
    /// a CAS where the analyzer's is a plain update, because the two differ in
    /// what a double-settle costs: the analyzer's second write re-lands the
    /// same upsert, where a second chain-enqueue is a second job spending a
    /// second design call — so only the worker that still owns the row against
    /// its own claim stamp may extend the chain. Losing means the lease
    /// expired and a reclaimer owns the page now; its settle will chain.
    const chained = await db.$transaction(async (tx) => {
      const won = await tx.agentRun.updateMany({
        where: { id: run.id, status: RunStatus.RUNNING, startedAt: run.claimedAt },
        data: { status: RunStatus.SUCCEEDED, output, error: null, finishedAt: now() },
      });
      if (won.count !== 1 || !next) return false;
      await enqueueVibesPage(tx, {
        projectId: run.projectId,
        boardId: job.boardId,
        pageId: next.pageId,
        index: next.index,
      });
      return true;
    });
    return { id: run.id, ok: true as const, chained };
  } catch (cause) {
    onFailure(run.id, cause);
    /// A FAILED job ends the chain identically to a refusal (§II.2); the CAS
    /// guard is the same courtesy — a reclaimer mid-flight keeps its row.
    await db.agentRun.updateMany({
      where: { id: run.id, status: RunStatus.RUNNING, startedAt: run.claimedAt },
      data: { status: RunStatus.FAILED, error: runErrorMessage(cause), finishedAt: now() },
    });
    return { id: run.id, ok: false as const, chained: false };
  }
}

/// The worker's reading of `runVibesPage`'s answer, `AgentRun.output`-shaped.
/// The outcome comes back rather than being thrown, refusal and all — the
/// worker settles the row off it (§II.4).
function settle(answer: VibesOutcome): VibesSettle {
  if ("error" in answer) return { outcome: "refused", reason: answer.error };
  return answer.empty
    ? { outcome: "empty", runId: answer.runId }
    : { outcome: "designed", runId: answer.runId };
}

/// One worker invocation: claim and run at most `VIBES_WORKER_JOB_LIMIT` jobs
/// — which is one, because a design page runs to minutes and two can exceed
/// the route's `maxDuration` (§II.5). Cross-board parallelism is more
/// invocations, each claiming a different chain head.
///
/// `drained` is set only when a claim came up empty, which is the one thing
/// that proves the backlog is gone — the route's cue not to kick itself again.
export async function drainVibesQueue(deps: VibesWorkerDeps) {
  let succeeded = 0;
  let failed = 0;
  let drained = false;

  for (let taken = 0; taken < VIBES_WORKER_JOB_LIMIT; taken++) {
    const run = await claimVibesRun(deps);
    if (!run) {
      drained = true;
      break;
    }
    const result = await runClaimedVibesJob(deps, run);
    if (result.ok) succeeded++;
    else failed++;
  }

  return { processed: succeeded + failed, succeeded, failed, drained };
}

function defaultOnFailure(runId: string, cause: unknown) {
  console.error(`vibes run ${runId} failed:`, cause);
}
