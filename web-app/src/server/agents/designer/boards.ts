import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import {
  DESIGNER_REWORD_ON_BOARD,
  DESIGNER_SWAP_ON_BOARD,
} from "@/lib/agent/designer/board-tools";
import { keyedQueue } from "@/lib/util/keyed-queue";
import { boardToolset } from "@/server/boards/tool-boards";
import type { DesignerBoardEdits } from "@/server/agents/designer/canvas";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import {
  designerReferences,
  type DesignerReferences,
} from "@/server/agents/designer/references";

/// Agent 8's two board edits (compositor-v2.md §III, §IV.2).
///
/// The thinnest toolset here after the canvas one, and for the same reason: both
/// tools are agent 6's, unforked, in `@/server/boards/tool-boards`. Nothing in
/// this file decides what a swap does or when a reword is refused — it is the
/// door agent 8 reaches them through, and everything in it is one of the three
/// things that door settles.
///
/// The tile, dropped: nothing agent 8 does is ever shown to a user (§III), so
/// `shown` is built by nobody here.
///
/// The four clauses of `BoardToolNotes`, which name tools: agent 6 reads a board
/// with `inspect_board` and this agent reads a page with `get_page`, and the
/// loose-in-slot advice is left out entirely — it is about a picture sitting in
/// a *template's* slot with page showing around it, and agent 8 has no templates
/// and draws every box itself.
///
/// And the queue, taken from the caller rather than made here, exactly as the
/// canvas and page toolsets take it: a swap, a reword and a `put_on_canvas` in
/// one round are three revision-guarded writes to one row, and a queue each
/// would serialise none of them against the others.

export type DesignerBoardToolset = {
  declarations: ToolDeclaration[];
  /// Null for a name this toolset does not own, on the other toolsets' terms:
  /// the unknown-tool error belongs to whoever holds every name.
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

export function designerBoardToolset({
  db,
  projectId,
  references = designerReferences({ db, projectId }),
  boardEdits = keyedQueue(),
}: {
  db: PrismaClient;
  projectId: string;
  /// The project's pictures, shared with every other toolset in the call: a
  /// picture swapped onto a page and a line in the gallery name the same row.
  references?: DesignerReferences;
  boardEdits?: DesignerBoardEdits;
}): DesignerBoardToolset {
  const boards = boardToolset({
    db,
    projectId,
    references,
    notes: {
      readThePage: "read the page with get_page",
      readTheBoard: "read it with read_canvas",
      removeALine: "remove_from_canvas",
    },
  });

  const boardKey = (args: Record<string, unknown>) =>
    typeof args.boardId === "string" ? args.boardId.trim() : "";

  /// `shown` dropped, which is the whole of what these two do differently here.
  const wordsOnly = async (edit: Promise<{ result: Record<string, unknown> }>) => ({
    result: (await edit).result,
  });

  return {
    declarations: [DESIGNER_SWAP_ON_BOARD, DESIGNER_REWORD_ON_BOARD],

    async execute({ name, args }) {
      switch (name) {
        case DESIGNER_SWAP_ON_BOARD.name:
          return wordsOnly(boardEdits.run(boardKey(args), () => boards.swapPictures(args)));

        case DESIGNER_REWORD_ON_BOARD.name:
          return wordsOnly(boardEdits.run(boardKey(args), () => boards.rewordLines(args)));

        default:
          return null;
      }
    },
  };
}
