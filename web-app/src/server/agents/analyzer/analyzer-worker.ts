import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { ReferenceOrigin } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AnalyzerResult } from "@/server/agents/analyzer/analyzer";
import {
  analyzerJob,
  leaseExpiryCutoff,
  runErrorMessage,
  workerJobLimit,
} from "@/lib/analysis/analyzer-queue";
import { spentColumns } from "@/lib/agent/shared/model-cost";

/// The worker's body, with the database and the model handed in rather than
/// imported. `analysis-queue.ts` binds the real ones; a test binds fakes, which
/// is the only way to exercise the parts that have no pure form — the claim's
/// compare-and-set, and the promise that a failing job ends as a FAILED row
/// instead of an exception that abandons the jobs queued behind it.
///
/// The delegates are `Pick`ed off the real `PrismaClient` so production keeps
/// full type checking on every call; only the fake has to be cast.
export type AnalyzerWorkerDb = {
  agentRun: Pick<PrismaClient["agentRun"], "findMany" | "updateMany" | "update">;
  reference: Pick<PrismaClient["reference"], "findFirst">;
  analysis: Pick<PrismaClient["analysis"], "upsert">;
};

export type AnalyzerWorkerDeps = {
  db: AnalyzerWorkerDb;
  analyze: (input: {
    gcsUri: string;
    title?: string;
    origin?: ReferenceOrigin | null;
    generationPrompt?: string | null;
  }) => Promise<AnalyzerResult>;
  now?: () => Date;
  onFailure?: (runId: string, cause: unknown) => void;
};

export type ClaimedRun = {
  id: string;
  projectId: string;
  input: unknown;
  status: RunStatus;
  startedAt: Date;
};

/// How many rows to look at per claim attempt. Only matters when several
/// workers race: each loses at most this many CAS attempts before giving up.
const CLAIM_CANDIDATES = 10;

/// Claims one job for this worker, or null when there is nothing to do.
///
/// Rows are taken oldest-first, and a RUNNING row whose lease has expired is
/// taken too — a worker killed mid-job (a deploy, an OOM) would otherwise leave
/// its reference on a spinner permanently. The claim is a compare-and-set on
/// the exact `(status, startedAt)` it read, so two workers reaching for the same
/// row cannot both win it, and the winner's fresh `startedAt` starts its lease.
export async function claimAnalyzerRun({
  db,
  now = () => new Date(),
}: AnalyzerWorkerDeps): Promise<ClaimedRun | null> {
  const cutoff = leaseExpiryCutoff(now());
  const candidates = await db.agentRun.findMany({
    where: {
      agent: AgentKind.ANALYZER,
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
    const claim = await db.agentRun.updateMany({
      where: { id: candidate.id, status: candidate.status, startedAt: candidate.startedAt },
      data: { status: RunStatus.RUNNING, startedAt: now(), error: null },
    });
    if (claim.count === 1) return candidate;
  }
  return null;
}

/// Runs one claimed job to a terminal state. Never throws: a job that fails is
/// a FAILED row the panel explains to the user, not a 500 that would also
/// abandon the jobs queued behind it.
export async function runAnalyzerRun(deps: AnalyzerWorkerDeps, run: ClaimedRun) {
  const { db, analyze, now = () => new Date(), onFailure = defaultOnFailure } = deps;
  try {
    const job = analyzerJob(run.input);
    /// Nothing to retry — a row with no reference on it is never going to
    /// become runnable, so it is failed rather than left to be claimed again.
    if (!job) throw new Error("analyzer job names no reference");

    /// Scoped to the run's own project: the reference id lives in client-written
    /// Json, so the row itself is not proof of who may be analyzed.
    const reference = await db.reference.findFirst({
      where: { id: job.referenceId, projectId: run.projectId },
      /// One of the three reference reads in the app that name their columns
      /// by hand rather than spreading the row, so a new column reaches it only
      /// when someone adds it here. `origin` and `generationPrompt` are what
      /// word the ask: a drawn picture introduced as one the user filed is the
      /// first sentence agent 2 reads about it.
      select: { id: true, gcsUri: true, title: true, origin: true, generationPrompt: true },
    });
    if (!reference) throw new Error("reference no longer exists");

    const { model, properties, usage } = await analyze({
      gcsUri: reference.gcsUri,
      title: reference.title || undefined,
      origin: reference.origin,
      generationPrompt: reference.generationPrompt,
    });

    /// Upsert, not create: a re-run of an already-analyzed reference replaces
    /// its properties instead of failing on the unique referenceId.
    await db.analysis.upsert({
      where: { referenceId: reference.id },
      create: { referenceId: reference.id, model, ...properties },
      update: { model, ...properties },
    });

    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.SUCCEEDED,
        output: { referenceId: reference.id, model },
        error: null,
        finishedAt: now(),
        /// One row per upload, so this is the column that says what a batch of
        /// forty photographs came to — the pipeline's largest bill and, until
        /// now, the one nothing counted.
        ...spentColumns(model, usage),
      },
    });
    return { id: run.id, ok: true as const };
  } catch (cause) {
    onFailure(run.id, cause);
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.FAILED,
        error: runErrorMessage(cause),
        finishedAt: now(),
      },
    });
    return { id: run.id, ok: false as const };
  }
}

/// One worker invocation: claim and run jobs one at a time until the queue is
/// empty or the cap is reached. Serial on purpose — agent 2 is a vision
/// call and Vertex burst-throttles a fan-out (infra.md §X), so the parallelism
/// that matters is more worker invocations, not more calls per invocation.
///
/// `drained` is what the scheduler reads to decide whether to come straight
/// back: it is set only when a claim came up empty, which is the one thing that
/// proves the backlog is gone. Counting processed jobs against the cap cannot
/// prove it — a kick asks for a single job and would report an empty queue
/// after every upload.
export async function drainAnalyzerQueue(deps: AnalyzerWorkerDeps, limit?: number) {
  const max = workerJobLimit(limit);
  let succeeded = 0;
  let failed = 0;
  let drained = false;

  for (let taken = 0; taken < max; taken++) {
    const run = await claimAnalyzerRun(deps);
    if (!run) {
      drained = true;
      break;
    }
    const result = await runAnalyzerRun(deps, run);
    if (result.ok) succeeded++;
    else failed++;
  }

  return { processed: succeeded + failed, succeeded, failed, drained };
}

function defaultOnFailure(runId: string, cause: unknown) {
  console.error(`analyzer run ${runId} failed:`, cause);
}
