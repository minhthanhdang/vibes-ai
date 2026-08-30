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

export type DesignerBoardToolset = {
  declarations: ToolDeclaration[];
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
