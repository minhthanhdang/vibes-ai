import "server-only";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import type { VibesJob } from "@/lib/vibes/vibes-queue";

type QueueClient = Pick<PrismaClient, "agentRun">;

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
