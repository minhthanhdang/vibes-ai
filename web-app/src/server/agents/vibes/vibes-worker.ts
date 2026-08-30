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

export type VibesWorkerDb = Pick<PrismaClient, "$transaction"> & {
  agentRun: Pick<PrismaClient["agentRun"], "findMany" | "updateMany" | "create">;
  moodboard: Pick<PrismaClient["moodboard"], "findUnique">;
};

export type VibesWorkerDeps = {
  db: VibesWorkerDb;
  runPage: (job: VibesJob) => Promise<VibesOutcome>;
  now?: () => Date;
  onFailure?: (runId: string, cause: unknown) => void;
};

export type ClaimedVibesRun = {
  id: string;
  projectId: string;
  input: unknown;
  claimedAt: Date;
};

const CLAIM_CANDIDATES = 10;

type VibesSettle =
  | { outcome: "designed"; runId: string }
  | { outcome: "designed"; alreadyDesigned: true }
  | { outcome: "empty"; runId: string }
  | { outcome: "refused"; reason: string };

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

export async function runClaimedVibesJob(deps: VibesWorkerDeps, run: ClaimedVibesRun) {
  const { db, runPage, now = () => new Date(), onFailure = defaultOnFailure } = deps;
  try {
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

    const next = output.outcome === "refused" ? null : nextChainPage(pages, job.index);

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
    await db.agentRun.updateMany({
      where: { id: run.id, status: RunStatus.RUNNING, startedAt: run.claimedAt },
      data: { status: RunStatus.FAILED, error: runErrorMessage(cause), finishedAt: now() },
    });
    return { id: run.id, ok: false as const, chained: false };
  }
}

function settle(answer: VibesOutcome): VibesSettle {
  if ("error" in answer) return { outcome: "refused", reason: answer.error };
  return answer.empty
    ? { outcome: "empty", runId: answer.runId }
    : { outcome: "designed", runId: answer.runId };
}

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
