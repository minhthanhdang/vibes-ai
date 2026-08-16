import "server-only";
import { after } from "next/server";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { analyzeReference } from "@/server/agents/analyzer";
import {
  analyzerJob,
  leaseExpiryCutoff,
  runErrorMessage,
  workerJobLimit,
} from "@/lib/analyzer-queue";

/// The queue is the `AgentRun` table: `reference.add` files a QUEUED row per
/// upload and the worker claims it out of band. There is no second job store,
/// so the panel's "how far along is it" query and the worker read the same row.

/// Enough of a client to file a job — `add` passes its transaction so the
/// reference and its job land together or not at all.
type QueueClient = Pick<PrismaClient, "agentRun">;

/// A reference with no job would sit on a spinner forever (`analysisView` reads
/// a missing run as queued), so this belongs in the same transaction as the row.
export function enqueueAnalysis(
  client: QueueClient,
  { projectId, referenceId }: { projectId: string; referenceId: string },
) {
  return client.agentRun.create({
    data: {
      projectId,
      agent: AgentKind.ANALYZER,
      status: RunStatus.QUEUED,
      input: { referenceId },
    },
    select: { id: true },
  });
}

type ClaimedRun = {
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
export async function claimAnalyzerRun(): Promise<ClaimedRun | null> {
  const cutoff = leaseExpiryCutoff(new Date());
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
      data: { status: RunStatus.RUNNING, startedAt: new Date(), error: null },
    });
    if (claim.count === 1) return candidate;
  }
  return null;
}

/// Runs one claimed job to a terminal state. Never throws: a job that fails is
/// a FAILED row the panel explains to the director, not a 500 that would also
/// abandon the jobs queued behind it.
export async function runAnalyzerRun(run: ClaimedRun) {
  try {
    const job = analyzerJob(run.input);
    /// Nothing to retry — a row with no reference on it is never going to
    /// become runnable, so it is failed rather than left to be claimed again.
    if (!job) throw new Error("analyzer job names no reference");

    /// Scoped to the run's own project: the reference id lives in client-written
    /// Json, so the row itself is not proof of who may be analyzed.
    const reference = await db.reference.findFirst({
      where: { id: job.referenceId, projectId: run.projectId },
      select: { id: true, gcsUri: true, title: true },
    });
    if (!reference) throw new Error("reference no longer exists");

    const { model, properties } = await analyzeReference({
      gcsUri: reference.gcsUri,
      title: reference.title || undefined,
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
        finishedAt: new Date(),
      },
    });
    return { id: run.id, ok: true as const };
  } catch (cause) {
    console.error(`analyzer run ${run.id} failed:`, cause);
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.FAILED,
        error: runErrorMessage(cause),
        finishedAt: new Date(),
      },
    });
    return { id: run.id, ok: false as const };
  }
}

/// One worker invocation: claim and run jobs one at a time until the queue is
/// empty or the cap is reached. Serial on purpose — agent 2 is a PRO vision
/// call and Vertex burst-throttles a fan-out (infra.md §X), so the parallelism
/// that matters is more worker invocations, not more calls per invocation.
export async function drainAnalyzerQueue({ limit }: { limit?: number } = {}) {
  const max = workerJobLimit(limit);
  let succeeded = 0;
  let failed = 0;

  for (let taken = 0; taken < max; taken++) {
    const run = await claimAnalyzerRun();
    if (!run) break;
    const result = await runAnalyzerRun(run);
    if (result.ok) succeeded++;
    else failed++;
  }

  return { processed: succeeded + failed, succeeded, failed };
}

/// Drains a job on the way out of the request that queued it, so the first
/// analysis starts now instead of on the scheduler's next tick. `after` runs
/// once the response is already sent, so the upload's round trip does not wait
/// on a vision call.
///
/// One job per kick, not the batch: this shares the tRPC function's duration
/// budget with whatever else that request is doing, and the scheduled worker
/// (infra.md §XIII) is what guarantees a backlog is eventually emptied.
export function kickAnalyzerWorker() {
  after(async () => {
    try {
      await drainAnalyzerQueue({ limit: 1 });
    } catch (cause) {
      /// The job stays QUEUED, so the scheduler picks it up — this is a slow
      /// analysis, never a lost one.
      console.error("analyzer kick failed:", cause);
    }
  });
}
