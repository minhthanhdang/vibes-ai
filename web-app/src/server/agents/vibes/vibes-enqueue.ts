import "server-only";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import type { VibesJob } from "@/lib/vibes/vibes-queue";

/// Filing a vibes job, on its own — `analysis-enqueue.ts`'s reason, one queue
/// over: the binding module opens the real connection pool at import time, and
/// the callers who file a job are handed a transaction to file it in.
///
/// Two of them exist by design (multi-vibes-and-preview-prd §II.2, §II.3): the
/// mutation that creates a board enqueues its page 1 in the create's own
/// transaction — a board with no job is a run that never starts — and the
/// worker chain-enqueues page N+1 in the same transaction as page N's settle.

type QueueClient = Pick<PrismaClient, "agentRun">;

/// The row is the queue ticket, not the run: agent 8 writes its own DESIGNER
/// row per design, and this VIBES row is what asked for it (§II.1). Ownership
/// rides on `projectId` because the worker that claims it has no session.
export function enqueueVibesPage(
  client: QueueClient,
  { projectId, boardId, pageId, index }: { projectId: string } & VibesJob,
) {
  return client.agentRun.create({
    data: {
      projectId,
      agent: AgentKind.VIBES,
      status: RunStatus.QUEUED,
      input: { boardId, pageId, index },
    },
    select: { id: true },
  });
}
