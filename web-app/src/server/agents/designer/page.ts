import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { SET_PAGE_BACKGROUND } from "@/lib/agent/shared/canvas-tools";
import { DESIGNER_DISCARD_PAGE, DESIGNER_DUPLICATE_PAGE, DESIGNER_MOVE_TO_PAGE, DESIGNER_RESIZE_PAGE, GET_PAGE } from "@/lib/agent/designer/page-tools";
import { boardItems } from "@/lib/boards/board-contents";
import { readableTarget } from "@/lib/canvas-objects/object-read";
import { boardLayout } from "@/lib/layout/custom-layout";
import { boardPages, itemsOnPage, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageBlocks } from "@/lib/pages/page-blocks";
import { pageBriefText } from "@/lib/pages/page-brief";
import { pageStandsAsComposed } from "@/lib/pages/page-fit";
import { contrastNote } from "@/lib/render/contrast";
import { occupancyNote } from "@/lib/render/occupancy";
import { undrawnNote } from "@/lib/render/render-plan";
import { BOARD_RENDER_CONTENT_TYPE } from "@/lib/scene/moodboard-render";
import { keyedQueue } from "@/lib/util/keyed-queue";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import type { DesignerBoardEdits } from "@/server/agents/designer/canvas";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import {
  designerReferences,
  type DesignerReferences,
} from "@/server/agents/designer/references";
import { pageToolset } from "@/server/pages/tool-pages";
import { renderForModel } from "@/server/render/for-model";

const PAGE_BOARD_SELECT = {
  id: true,
  title: true,
  revision: true,
  elements: true,
  appState: true,
  layout: true,
  layoutSlots: true,
} as const;

export type DesignerPageToolset = {
  declarations: ToolDeclaration[];
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const boardKey = (args: Record<string, unknown>) => asString(args.boardId);

export function designerPageToolset({
  db,
  projectId,
  references = designerReferences({ db, projectId }),
  render = renderForModel,
  boardEdits = keyedQueue(),
}: {
  db: PrismaClient;
  projectId: string;
  references?: DesignerReferences;
  render?: typeof renderForModel;
  boardEdits?: DesignerBoardEdits;
}): DesignerPageToolset {
  const pages = pageToolset({
    db,
    projectId,
    references,
    notes: {
      noPage: 'Draw one with put_on_canvas, kind "page", and a box the shape the work wants',
      noPageToCopy:
        'Draw one with put_on_canvas, kind "page", and a box the shape the work wants — there is nothing here yet to make a variation of',
      fellOffPage:
        "put them back on it yourself with transform_on_canvas — you are the one arranging this page",
      composedAtOldShape:
        "so move what is on it onto the new rectangle with transform_on_canvas rather than leaving an arrangement cut for a shape the page no longer has",
      readTheBoard: "read the board with read_canvas before naming a page again",
      makePageFirst: 'draw it with put_on_canvas, kind "page", first if it does not exist yet',
      composedPageJoined:
        "so put it into the arrangement yourself with transform_on_canvas rather than leaving it standing below the slots",
      discardOffer:
        "Nothing you call puts a button in front of the user: this answer is the whole of the offer, so the choice is one you put to them in your closing line.",
      emptiesBoardOffer:
        "and say the empty board would still be there — losing the board itself is not something you can offer, so tell them that is what they would have to ask for",
      noPageToDiscard:
        "it is a canvas the user arranged rather than a board laid out in pages, so what is standing on it comes off with remove_from_canvas",
      otherRectangle:
        'this call has three shapes and no others — a page that belongs at any other rectangle is one you put with put_on_canvas, kind "page", at that box',
    },
  });

  async function getPage(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const boardId = asString(args.boardId);
    const pageId = asString(args.pageId);

    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: PAGE_BOARD_SELECT,
        })
      : null;
    if (!board) {
      return { result: { error: `no board called ${boardId} in this project` } };
    }

    const elements = persistableElements(board.elements);
    const inOrder = pagesInReadingOrder(boardPages(elements));
    const page = pageById(inOrder, pageId);
    if (!page) {
      return {
        result: {
          error: `there is no page called ${pageId} on the board ${boardId} — read_canvas lists the pages that board has`,
        },
      };
    }

    const [{ all }, drawn] = await Promise.all([
      references(),
      render({
        boardId: board.id,
        pageId: page.id,
        scene: {
          projectId,
          revision: board.revision,
          elements: board.elements,
          appState: board.appState,
        },
      }),
    ]);

    const items = boardItems(elements, { shapes: true });
    const layout = boardLayout(board);
    const failed = "failed" in drawn;
    const note = failed ? "" : undrawnNote(drawn.undrawn);
    const standing = drawn.occupancy ? occupancyNote(drawn.occupancy) : "";
    const restylable = new Set(
      elements.flatMap((element) => (readableTarget(element) ? [element.id] : [])),
    );
    const legibility = drawn.contrast ? contrastNote(drawn.contrast, restylable) : "";

    const text = pageBriefText(
      {
        page: {
          boardId: board.id,
          pageId: page.id,
          boardTitle: board.title,
          name: page.name,
          position: inOrder.indexOf(page) + 1,
          of: inOrder.length,
          width: page.width,
          height: page.height,
          preset: page.preset,
          ...(pageStandsAsComposed(items, inOrder, page, layout) && { layout: board.layout }),
        },
        ...pageBlocks(itemsOnPage(items, inOrder, page), page),
        rendered: !failed,
        door: "asked",
        ...(standing && { standingNote: standing }),
        ...(legibility && { legibilityNote: legibility }),
                ...(failed ? { renderFailure: drawn.reason } : note ? { undrawnNote: note } : {}),
      },
      all,
    );

    const result = {
      boardId: board.id,
      pageId: page.id,
      revision: board.revision,
      page: text,
    };

    return failed
      ? { result }
      : {
          result,
          pictures: [{ fileData: { fileUri: drawn.uri, mimeType: BOARD_RENDER_CONTENT_TYPE } }],
        };
  }

  return {
    declarations: [
      GET_PAGE,
      DESIGNER_DUPLICATE_PAGE,
      DESIGNER_RESIZE_PAGE,
      DESIGNER_MOVE_TO_PAGE,
      SET_PAGE_BACKGROUND,
      DESIGNER_DISCARD_PAGE,
    ],

    async execute({ name, args }) {
      switch (name) {
        case GET_PAGE.name:
          return getPage(args);

        case DESIGNER_DUPLICATE_PAGE.name:
          return {
            result: (
              await boardEdits.run(boardKey(args), () => pages.duplicateBoardPage(args))
            ).result,
          };

        case DESIGNER_RESIZE_PAGE.name:
          return {
            result: (
              await boardEdits.run(boardKey(args), () => pages.resizeBoardPage(args))
            ).result,
          };

        case DESIGNER_MOVE_TO_PAGE.name:
          return {
            result: (await boardEdits.run(boardKey(args), () => pages.moveToBoardPage(args)))
              .result,
          };

        case SET_PAGE_BACKGROUND.name:
          return {
            result: (
              await boardEdits.run(boardKey(args), () => pages.setBoardPageBackground(args))
            ).result,
          };

        case DESIGNER_DISCARD_PAGE.name:
          return { result: (await pages.offerBoardPageDiscard(args)).result };

        default:
          return null;
      }
    },
  };
}
