import "server-only";
import { orchestrate } from "@/server/agents/orchestrator";
import { referenceToolset } from "@/server/agents/tools";
import { spentColumns } from "@/lib/model-cost";
import { historyWindow } from "@/lib/chat-history";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { Turn } from "@/server/agents/orchestrator";
import type { PrismaClient } from "@/generated/prisma/client";

/// One director message in, one assistant reply out — plus whatever the tools
/// put in front of them.
///
/// Lifted out of the tRPC procedure so that the thing which runs against Vertex
/// from the command line (`npm run smoke`) is the same code the chat runs, down
/// to the run row. A harness that measures a copy of the turn measures the copy.
export async function runOrchestratorTurn({
  db,
  projectId,
  message,
  history = [],
  /// The routing call, injected — the same seam the three agents below already
  /// have. What is worth asserting here is the row: that a turn is billed for
  /// its own routing and not for the crops it ordered.
  run = orchestrate,
}: {
  db: PrismaClient;
  projectId: string;
  message: string;
  history?: Turn[];
  run?: typeof orchestrate;
}) {
  /// Built per call and closed over this project, so the ids the model can
  /// reach are the ones the caller owns.
  const tools = referenceToolset({ db, projectId });
  /// Clamped here rather than at the router, so that a caller sending more
  /// conversation than fits gets a shorter answer instead of a rejected one —
  /// and so the chat and `npm run smoke` are bounded by the same rule. Every
  /// round of the loop below re-sends this, so it is the one input whose size
  /// is multiplied by the turn's own shape.
  const window = historyWindow(history);
  const { reply, attachments, calls, model, usage, finish } = await run({
    message,
    history: window,
    /// Read before the model is asked anything. It is one database query the
    /// turn was going to make anyway — the tools share it — and it buys back the
    /// round the model used to spend finding out what is in the project.
    brief: await tools.brief(),
    tools: tools.declarations,
    execute: tools.execute,
  });

  /// The turn's own row, written after rather than around it: the orchestrator
  /// answers inside this request, so there is nothing to poll and no status to
  /// show — the row exists to be summed. Its tokens are the routing only; the
  /// agents it called through tools wrote rows of their own, and counting
  /// theirs here would bill one crop twice.
  await db.agentRun.create({
    data: {
      projectId,
      agent: AgentKind.ORCHESTRATOR,
      status: RunStatus.SUCCEEDED,
      /// The conversation as *sent*, plus what the window left behind — a turn
      /// the model answered without the first half of the exchange is one whose
      /// reply is explicable, and the count is the only trace of that.
      input: {
        message,
        history: window.length,
        ...(history.length > window.length && { historyDropped: history.length - window.length }),
      },
      output: {
        calls: calls.map((call) => call.name),
        attachments: attachments.length,
        /// Only when the model stopped for a reason other than having answered.
        /// A turn the director was given a sentence about instead of an answer is
        /// the one turn on the ledger whose tokens bought nothing, and without
        /// this the row is indistinguishable from one that worked.
        ...(finish && { finish }),
      },
      finishedAt: new Date(),
      ...spentColumns(model, usage),
    },
  });

  return { reply, attachments, calls, usage };
}
