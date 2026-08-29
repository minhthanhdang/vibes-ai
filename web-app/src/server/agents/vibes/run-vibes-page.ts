import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { storedBrief, vibesIntention } from "@/lib/vibes/vibes-brief";
import { vibesPageDesigned } from "@/lib/vibes/vibes-resume";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import { designPage } from "@/server/agents/designer/design";
import { designerReferences } from "@/server/agents/designer/references";

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
      line: string;
      /// Not a refusal and not a halt: the loop counts the page out of what is
      /// designed and walks on, because the next page is as likely to finish
      /// as this one was.
      empty: boolean;
      calls: string[];
      runId: string;
    }
  | { pageId: string; error: string };

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
    select: { id: true, projectId: true, vibesBrief: true },
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

  /// The page's own account is its `AgentRun` row and nothing else. A run used
  /// to append an assistant row per page into a conversation opened for the
  /// board, and that thread is gone (`vibes.ts`): nobody typed in it and nobody
  /// read it. What the run panel shows is read off the `VIBES` rows themselves,
  /// which is where the refusal and the page number already were.
  return "line" in outcome
    ? { pageId, line: outcome.line, empty, calls: outcome.calls, runId: outcome.runId }
    : { pageId, error: outcome.error };
}
