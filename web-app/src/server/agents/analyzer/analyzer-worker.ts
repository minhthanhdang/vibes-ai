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

const CLAIM_CANDIDATES = 10;

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

export async function runAnalyzerRun(deps: AnalyzerWorkerDeps, run: ClaimedRun) {
  const { db, analyze, now = () => new Date(), onFailure = defaultOnFailure } = deps;
  try {
    const job = analyzerJob(run.input);
    if (!job) throw new Error("analyzer job names no reference");

    const reference = await db.reference.findFirst({
      where: { id: job.referenceId, projectId: run.projectId },
      select: { id: true, gcsUri: true, title: true, origin: true, generationPrompt: true },
    });
    if (!reference) throw new Error("reference no longer exists");

    const { model, properties, usage } = await analyze({
      gcsUri: reference.gcsUri,
      title: reference.title || undefined,
      origin: reference.origin,
      generationPrompt: reference.generationPrompt,
    });

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
