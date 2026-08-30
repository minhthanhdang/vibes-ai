import "server-only";
import { orchestrate } from "@/server/agents/orchestrator/orchestrator";
import { referenceToolset, type AttachedPage } from "@/server/agents/orchestrator/tools";
import { spentColumns } from "@/lib/agent/shared/model-cost";
import { historyWindow } from "@/lib/agent/orchestrator/history";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { Turn } from "@/server/agents/orchestrator/orchestrator";
import type { PrismaClient } from "@/generated/prisma/client";
import { withAgent } from "@/server/agents/shared/agent-scope";

export function runOrchestratorTurn(asked: Parameters<typeof runningTurn>[0]) {
  return withAgent("orchestrator", () => runningTurn(asked));
}

async function runningTurn({
  db,
  projectId,
  message,
  pages = [],
  currentBoardId,
  history = [],
  run = orchestrate,
}: {
  db: PrismaClient;
  projectId: string;
  message: string;
  pages?: readonly AttachedPage[];
  currentBoardId?: string;
  history?: Turn[];
  run?: typeof orchestrate;
}) {
  const tools = referenceToolset({ db, projectId, currentBoardId });
  const window = historyWindow(history);
  const attached = await tools.attachedPages(pages);
  const { reply, attachments, calls, parts, model, usage, finish, rounds, roundsDropped, modelCalls } = await run({
    message,
    attached: attached.parts,
    history: window,
    brief: tools.brief,
    state: tools.state,
    tools: tools.declarations,
    execute: tools.execute,
  });

  await db.agentRun.create({
    data: {
      projectId,
      agent: AgentKind.ORCHESTRATOR,
      status: RunStatus.SUCCEEDED,
      input: {
        message,
        history: window.length,
        ...(history.length > window.length && { historyDropped: history.length - window.length }),
        ...(attached.pages.length && {
          pages: attached.pages.map(({ boardId, pageId, rendered }) => ({
            boardId,
            pageId,
            rendered,
          })),
        }),
      },
      output: {
        calls: calls.map((call) => call.name),
        attachments: attachments.length,
        rounds,
        ...(roundsDropped > 0 && { roundsDropped }),
        modelCalls,
        ...(finish && { finish }),
      },
      finishedAt: new Date(),
      ...spentColumns(model, usage),
    },
  });

  return { reply, attachments, calls, usage, rounds, roundsDropped, modelCalls, parts, pages: attached.pages };
}
