import "server-only";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";

type QueueClient = Pick<PrismaClient, "agentRun">;

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
