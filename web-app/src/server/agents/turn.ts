import "server-only";
import { orchestrate } from "@/server/agents/orchestrator";
import { referenceToolset, type AttachedPage } from "@/server/agents/tools";
import { spentColumns } from "@/lib/agent/model-cost";
import { historyWindow } from "@/lib/agent/chat-history";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { Turn } from "@/server/agents/orchestrator";
import type { PrismaClient } from "@/generated/prisma/client";

/// One user message in, one assistant reply out — plus whatever the tools
/// put in front of them.
///
/// Lifted out of the tRPC procedure so that the thing which runs against Vertex
/// from the command line (`npm run smoke`) is the same code the chat runs, down
/// to the run row. A harness that measures a copy of the turn measures the copy.
export async function runOrchestratorTurn({
  db,
  projectId,
  message,
  /// The pages the user attached to this message (§V.5). Pointers, not
  /// content: a board, a page on it, the revision the picture was taken at and
  /// the uri it was put at. What the model is shown is built from the stored
  /// scene below, so a user cannot describe their own page to it.
  pages = [],
  history = [],
  /// The routing call, injected — the same seam the three agents below already
  /// have. What is worth asserting here is the row: that a turn is billed for
  /// its own routing and not for the crops it ordered.
  run = orchestrate,
}: {
  db: PrismaClient;
  projectId: string;
  message: string;
  pages?: readonly AttachedPage[];
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
  /// Built before the model is asked anything, off the same reference read the
  /// priming below uses. A page the user picked and the board rows the brief
  /// names are one question to the database, not two.
  const attached = await tools.attachedPages(pages);
  const { reply, attachments, calls, model, usage, finish, rounds, roundsDropped, modelCalls } = await run({
    message,
    attached: attached.parts,
    history: window,
    /// Read before the model is asked anything. It is one database query the
    /// turn was going to make anyway — the tools share it — and it buys back the
    /// round the model used to spend finding out what is in the project. Passed
    /// as the function rather than as its answer for the reason the declarations
    /// are: both reads behind it are cached and appended to as the turn files
    /// things, so a picture drawn on one round is in the catalog on the next.
    brief: tools.brief,
    /// The same three counts the declarations are gated on, so the instruction
    /// never describes a tool this turn was not given — and, read per round,
    /// never withholds the sections for tools it just was.
    state: tools.state,
    /// A function rather than a list: a turn that files the first board should be
    /// able to read it on the round after, and a list settled here could not say
    /// so. Both reads behind it are cached, so the extra rounds cost nothing.
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
        /// Which pages the user put in front of the model, and whether each
        /// went up with its picture. The turn is not replayable from the row
        /// without them: the same sentence about the same board reads differently
        /// when a page of it was attached, and a page that went up as text only
        /// is the one case where the model answered about a picture it never saw.
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
        /// The shape of the spend beside its size. A turn's input is close to
        /// `modelCalls` times the instruction-plus-declarations base, so this is
        /// the column that says whether an expensive turn was an expensive
        /// question or simply a long walk to an answer.
        rounds,
        /// Beside `historyDropped` above and by the same convention: a reply the
        /// model wrote without the first half of its own turn's work is one whose
        /// reply is explicable, and the count is the only trace of that. Written
        /// only when the window took something, so an ordinary turn's row says
        /// nothing about a bound it never reached.
        ...(roundsDropped > 0 && { roundsDropped }),
        modelCalls,
        /// Only when the model stopped for a reason other than having answered.
        /// A turn the user was given a sentence about instead of an answer is
        /// the one turn on the ledger whose tokens bought nothing, and without
        /// this the row is indistinguishable from one that worked.
        ...(finish && { finish }),
      },
      finishedAt: new Date(),
      ...spentColumns(model, usage),
    },
  });

  return { reply, attachments, calls, usage, rounds, roundsDropped, modelCalls };
}
