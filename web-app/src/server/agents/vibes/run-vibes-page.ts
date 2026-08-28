import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { storedBrief, vibesIntention } from "@/lib/vibes/vibes-brief";
import { vibesSaid } from "@/lib/vibes/vibes-account";
import { vibesPageDesigned } from "@/lib/vibes/vibes-resume";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import { designPage } from "@/server/agents/designer/design";
import { designerReferences } from "@/server/agents/designer/references";
import type { Part } from "@/lib/agent/shared/conversation";

/// One page of a Vibes run, designed — the whole of what the `vibes.designPage`
/// mutation used to do below its ownership check, extracted so a caller
/// without a tRPC context can ask for it (multi-vibes-and-preview-prd §II.4).
/// The queue worker is that caller now, and the only one. Ownership is
/// therefore *not* checked here — it was checked by the enqueue that filed
/// the job, and the worker trusts the row the way the analyzer worker does.
///
/// The outcome comes back rather than being thrown, refusal and all: the
/// caller is a loop, and a loop told a page failed can stop with the pages
/// before it kept. What *does* throw is the structural failure — a board or a
/// brief that is gone — because that is not a page refusing, it is the run's
/// ground disappearing, and the worker's FAILED path is where that belongs.

export type VibesOutcome =
  | {
      pageId: string;
      conversationId: string;
      line: string;
      /// Not a refusal and not a halt: the loop counts the page out of what is
      /// designed and walks on, because the next page is as likely to finish
      /// as this one was.
      empty: boolean;
      calls: string[];
      runId: string;
    }
  | { pageId: string; conversationId: string; error: string };

export async function runVibesPage({
  db,
  boardId,
  pageId,
  index,
}: {
  db: PrismaClient;
  boardId: string;
  pageId: string;
  /// The page's position in the run, 0-based here and said to the model
  /// 1-based — the same number the browser held when it was the loop.
  index: number;
}): Promise<VibesOutcome> {
  const board = await db.moodboard.findUnique({
    where: { id: boardId },
    select: { id: true, projectId: true, conversationId: true, vibesBrief: true },
  });
  if (!board) throw new Error(`no board called ${boardId} — the run's board is gone`);

  /// A board with no brief on it was not made by this form, and designing a
  /// page of it from a form nobody filled in is the one thing this door must
  /// not invent.
  const brief = storedBrief(board.vibesBrief);
  if (!brief) throw new Error(`the board ${boardId} was not started from a Vibes brief`);

  /// The project's whole gallery, in the order `list_gallery` answers in —
  /// starred first, then newest — because the catalogue in the intention is
  /// capped at `CATALOG_LIMIT` and the cap is only defensible if what survives
  /// it is the front of that order. Not the canvas selection: the board is
  /// minutes old, so a selection on the one the user was looking at before
  /// the form means nothing here.
  const { all } = await designerReferences({ db, projectId: board.projectId })();

  /// No `budget`, alone among agent 8's callers. The ceilings are a turn's
  /// (§VII) and agent 6's door hands down the turn it is running inside; this
  /// is a page of its own, so each one opens its own — which is the honest
  /// reading of a run the user watches page by page and can stop.
  const outcome = await designPage({
    db,
    projectId: board.projectId,
    boardId: board.id,
    pageId,
    intention: vibesIntention({ brief, index, pictures: all }),
  });

  /// Did anything land? A design that runs out of rounds does not refuse — it
  /// answers with agent 8's own "I ran out of steps" line — so a run that took
  /// every line for a page reported six successes over a board with five pages
  /// on it (compositor-v2.md §IX.5). The scene is the only thing that knows,
  /// and it is asked the same way `vibes.resume` asks it, off the same reader,
  /// so the run's account and the offer the board makes when it is next opened
  /// cannot disagree.
  ///
  /// One read of the elements column against a design call that costs minutes
  /// and dollars, and only when the design answered: a refusal placed nothing
  /// by definition.
  const empty =
    "line" in outcome
      ? await db.moodboard
          .findUnique({ where: { id: board.id }, select: { elements: true } })
          .then((written) =>
            written
              ? !vibesPageDesigned({
                  elements: persistableElements(written.elements),
                  pageId,
                })
              : false,
          )
      : false;

  /// One assistant row per page, carrying agent 8's own closing line
  /// (compositor-v2.md §IX.2) — and carrying the refusal when there is no
  /// line, because the conversation is the only account of the run the user
  /// ever reads. A run that stopped at page four otherwise leaves three
  /// answers under an ask for six pages and nothing saying which page went
  /// missing or why.
  ///
  /// The row's sentence is `vibesSaid`'s and not built here: the ask and every
  /// answer under it are one account written by two doors, and the page number
  /// is on all of them because the line is on none of them. Into the run's own
  /// thread (orchestrator-tool-reference §VII.9), which the board is carrying —
  /// and into a thread opened here when it is not. Null happens twice: a board
  /// composed before conversations existed, and a board whose thread the user
  /// deleted mid-run. Writing no row in either case would leave a resumed run
  /// with no account of itself, which is the thing §IX.2 exists to prevent, so
  /// the run gets a thread rather than losing its record.
  ///
  /// `updatedAt` is deliberately left where the ask put it: the ask is when
  /// the user spoke, and a run answering its own pages for twenty minutes is
  /// not the user speaking again (§VII.1).
  const conversationId = await db.$transaction(async (tx) => {
    const id =
      board.conversationId ??
      (
        await tx.conversation.create({
          data: { projectId: board.projectId },
          select: { id: true },
        })
      ).id;
    if (!board.conversationId) {
      await tx.moodboard.update({ where: { id: board.id }, data: { conversationId: id } });
    }
    await tx.chatMessage.create({
      data: {
        conversationId: id,
        turnId: randomUUID(),
        role: "assistant",
        status: "sent",
        parts: [
          {
            type: "text",
            text: vibesSaid({
              index,
              total: brief.pages,
              outcome:
                "line" in outcome ? { line: outcome.line, empty } : { error: outcome.error },
            }),
          },
        ] satisfies Part[] as unknown as Prisma.InputJsonValue,
      },
    });
    return id;
  });

  /// The thread rides back on both branches: the caller is the only thing that
  /// knows a row was just written into a conversation the browser may be
  /// showing, and nothing else would tell that column about it (§VII.9).
  return "line" in outcome
    ? {
        pageId,
        conversationId,
        line: outcome.line,
        empty,
        calls: outcome.calls,
        runId: outcome.runId,
      }
    : { pageId, conversationId, error: outcome.error };
}
