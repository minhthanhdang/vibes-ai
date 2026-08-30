import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { storedBrief, vibesIntention } from "@/lib/vibes/vibes-brief";
import { vibesPageDesigned } from "@/lib/vibes/vibes-resume";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import { designPage } from "@/server/agents/designer/design";
import { designerReferences } from "@/server/agents/designer/references";

export type VibesOutcome =
  | {
      pageId: string;
      line: string;
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
  index: number;
}): Promise<VibesOutcome> {
  const board = await db.moodboard.findUnique({
    where: { id: boardId },
    select: { id: true, projectId: true, vibesBrief: true },
  });
  if (!board) throw new Error(`no board called ${boardId} — the run's board is gone`);

  const brief = storedBrief(board.vibesBrief);
  if (!brief) throw new Error(`the board ${boardId} was not started from a Vibes brief`);

  const { all } = await designerReferences({ db, projectId: board.projectId })();

  const outcome = await designPage({
    db,
    projectId: board.projectId,
    boardId: board.id,
    pageId,
    intention: vibesIntention({ brief, index, pictures: all }),
  });

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

  return "line" in outcome
    ? { pageId, line: outcome.line, empty, calls: outcome.calls, runId: outcome.runId }
    : { pageId, error: outcome.error };
}
