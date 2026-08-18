import "server-only";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";

/// Filing a job, on its own — no database of its own, no model, no worker.
///
/// It lives apart from `analysis-queue.ts` because that module binds the real
/// client and the real analyzer at import time, and the callers who only need to
/// queue a row are handed a transaction to queue it in. Importing the binding to
/// reach the row would mean every one of them — the tool executor included —
/// opening a connection pool to file a job it already has a client for.

/// Enough of a client to file a job: the reference and its job land in one
/// transaction, so what is passed here is usually that transaction.
type QueueClient = Pick<PrismaClient, "agentRun">;

/// A reference with no job is a reference the panel offers to analyze by hand
/// (`analysisView` reads a missing run as never-analyzed), so filing the job
/// belongs in the same transaction as the row rather than after it.
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
