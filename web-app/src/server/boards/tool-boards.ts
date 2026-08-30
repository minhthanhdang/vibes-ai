import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolReference } from "@/lib/agent/shared/reference";
import { REWORD_LIMIT, SWAP_LIMIT } from "@/lib/agent/orchestrator/board-tools";
import { boardItems } from "@/lib/boards/board-contents";
import { swapOnBoard, type SwapRequest } from "@/lib/boards/board-swap";
import { rewordOnBoard, type RewordRequest } from "@/lib/boards/board-text";
import { boardLayout } from "@/lib/layout/custom-layout";
import { boardPages, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageDigests } from "@/lib/pages/page-contents";
import { pagedLooseFits } from "@/lib/pages/page-fit";
import { persistableElements, type SceneElement } from "@/lib/scene/moodboard-scene";
import { sceneWrite } from "@/server/moodboards/scene-write";
import { pageSaid } from "@/server/pages/tool-pages";

export type BoardEditShown = {
  board: BoardEditRow;
  elements: readonly SceneElement[];
  thumbUrlOf: (referenceId: string) => string | null | undefined;
  pageId?: string;
};

export type BoardEditOutcome = {
  result: Record<string, unknown>;
  shown?: BoardEditShown;
};

export const BOARD_EDIT_SELECT = {
  id: true,
  title: true,
  revision: true,
  elements: true,
  layout: true,
  layoutSlots: true,
  widthPx: true,
  heightPx: true,
} as const;

export type BoardEditRow = {
  id: string;
  title: string;
  revision: number;
  elements: unknown;
  layout: string | null;
  layoutSlots: unknown;
  widthPx: number;
  heightPx: number;
};

export type BoardToolReferences = () => Promise<{ all: ToolReference[] }>;

export type BoardToolNotes = {
  readThePage: string;
  readTheBoard: string;
  removeALine: string;
  looseInSlot?: string;
};

export function boardToolset({
  db,
  projectId,
  references,
  notes,
}: {
  db: PrismaClient;
  projectId: string;
  references: BoardToolReferences;
  notes: BoardToolNotes;
}) {
  async function swapPictures(args: Record<string, unknown>): Promise<BoardEditOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: BOARD_EDIT_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const parsed = swapRequests(args.swaps);
    const asked = parsed.swaps.slice(0, SWAP_LIMIT);
    const overLimit = parsed.swaps.slice(SWAP_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notMade: overLimit,
        notMadeNote: `only ${SWAP_LIMIT} exchanges are made in one call — these were not, so call again with them rather than telling the user they were done`,
      }),
      ...(parsed.unreadable > 0 && {
        unreadable: parsed.unreadable,
        unreadableNote:
          "exchanges that named only one end of the pair, so they were not made — each one needs both takeOff and putOn",
      }),
    };

    if (!asked.length) {
      return {
        result: {
          error: "say which picture to take off the board and which to put in its place",
          ...dropped,
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const notFound = [...new Set(asked.map((swap) => swap.putOn))].filter((id) => !byId.has(id));
    const runnable = asked.filter((swap) => byId.has(swap.putOn));

    const elements = persistableElements(board.elements);
    const layout = boardLayout(board);

    const standing = pagesInReadingOrder(boardPages(elements));
    const askedPage = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const onPage = askedPage ? pageById(standing, askedPage) : null;
    if (askedPage && !onPage) {
      return {
        result: {
          error: `no page called ${askedPage} on that board`,
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so call this again without a pageId",
              }),
          ...dropped,
        },
      };
    }

    const swap = swapOnBoard({
      elements,
      layout,
      swaps: runnable,
      sizeOf: (id) => byId.get(id),
      onPage,
    });

    const missing = swap.notOnBoard.length && {
      notOnBoard: swap.notOnBoard,
      ...(onPage && {
        notOnBoardNote: `the read was against ${pageSaid(onPage)} alone — those pictures are not on it, though the board may hold them on another of its pages, so ${notes.readThePage} before naming one again`,
      }),
    };

    if (!swap.swapped.length && !swap.traded.length) {
      return {
        result: {
          error: onPage ? `nothing on ${pageSaid(onPage)} changed` : "nothing on that board changed",
          ...(notFound.length && { notInThisProject: notFound }),
          ...missing,
          ...(swap.alreadyOnBoard.length && { alreadyOnBoard: swap.alreadyOnBoard }),
          ...dropped,
        },
      };
    }

    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...sceneWrite(swap.elements),
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was editing it — the user has it open, so tell them and ask again",
        },
      };
    }

    const items = boardItems(swap.elements);
    const paged = layout ? pagedLooseFits(items, boardPages(swap.elements), layout) : [];
    const loose =
      onPage && standing.length > 1 ? paged.filter((fit) => fit.pageId === onPage.id) : paged;

    return {
      result: {
        boardId: board.id,
        title: board.title,
        ...(onPage && { page: { pageId: onPage.id, name: onPage.name } }),
        ...(swap.swapped.length && { swapped: swap.swapped }),
        ...(swap.traded.length && { tradedPlaces: swap.traded }),
        status: onPage
          ? `done as a scene edit on ${pageSaid(onPage)} — every other picture on that page is exactly where it was and nothing was laid out again${standing.length > 1 ? `, and the board's other ${standing.length === 2 ? "page is" : "pages are"} untouched` : ", so say the board is otherwise untouched"}`
          : "done as a scene edit — every other picture on that board is exactly where it was and nothing was laid out again, so say that the board is otherwise untouched",
        ...(notFound.length && { notInThisProject: notFound }),
        ...missing,
        ...(swap.alreadyOnBoard.length && { alreadyOnBoard: swap.alreadyOnBoard }),
        ...dropped,
        ...(loose.length && notes.looseInSlot
          ? { looseInSlot: loose, looseInSlotNote: notes.looseInSlot }
          : {}),
      },
      shown: {
        board,
        elements: swap.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        ...(onPage && { pageId: onPage.id }),
      },
    };
  }


  async function rewordLines(args: Record<string, unknown>): Promise<BoardEditOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: BOARD_EDIT_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const parsed = rewordRequests(args.rewordings);
    const asked = parsed.rewordings.slice(0, REWORD_LIMIT);
    const overLimit = parsed.rewordings.slice(REWORD_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notReworded: overLimit,
        notRewordedNote: `only ${REWORD_LIMIT} lines are rewritten in one call — these were not, so call again with them rather than telling the user the board says them`,
      }),
      ...(parsed.unreadable > 0 && {
        unreadable: parsed.unreadable,
        unreadableNote: `rewordings that named only one end of the pair, so nothing was written — each one needs the line as the board carries it now and what it should say instead, and a line is taken off with ${notes.removeALine} rather than with a blank`,
      }),
    };

    if (!asked.length) {
      return {
        result: {
          error: `say which line on the board to rewrite and what it should say instead — to take a line off, use ${notes.removeALine}`,
          ...dropped,
        },
      };
    }

    const elements = persistableElements(board.elements);

    const standing = pagesInReadingOrder(boardPages(elements));
    const askedPage = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const onPage = askedPage ? pageById(standing, askedPage) : null;
    if (askedPage && !onPage) {
      return {
        result: {
          error: `no page called ${askedPage} on that board`,
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so call this again without a pageId",
              }),
          ...dropped,
        },
      };
    }

    const edit = rewordOnBoard({ elements, rewordings: asked, onPage });

    const missing = edit.notOnBoard.length && {
      notOnBoard: edit.notOnBoard,
      notOnBoardNote: onPage
        ? `that wording is not on ${pageSaid(onPage)} — the board may say it on another of its pages, so ${notes.readThePage} and quote the line as that page carries it, or leave the pageId out to reword wherever it is`
        : `that wording is not on the board — ${notes.readTheBoard} and quote the line as the board carries it`,
    };

    if (!edit.reworded.length) {
      return {
        result: {
          error: onPage ? `nothing on ${pageSaid(onPage)} changed` : "nothing on that board changed",
          ...missing,
          ...(edit.unchanged.length && { alreadySaysThat: edit.unchanged }),
          ...dropped,
        },
      };
    }

    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...sceneWrite(edit.elements),
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was editing it — the user has it open, so tell them and ask again",
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    return {
      result: {
        boardId: board.id,
        title: board.title,
        ...(onPage && { page: { pageId: onPage.id, name: onPage.name } }),
        reworded: edit.reworded,
        status: onPage
          ? `done as a scene edit on ${pageSaid(onPage)} — no model call was made, the line kept its place and every picture on that page is exactly where it was${standing.length > 1 ? `, and the board's other ${standing.length === 2 ? "page is" : "pages are"} untouched` : ", so say the board is otherwise untouched"}`
          : "done as a scene edit — no model call was made, the line kept its place and every picture on that board is exactly where it was, so say the board is otherwise untouched",
        ...missing,
        ...(edit.unchanged.length && { alreadySaysThat: edit.unchanged }),
        ...dropped,
      },
      shown: {
        board,
        elements: edit.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        ...(onPage && { pageId: onPage.id }),
      },
    };
  }
  return { swapPictures, rewordLines };
}


function swapRequests(value: unknown): { swaps: SwapRequest[]; unreadable: number } {
  if (!Array.isArray(value)) return { swaps: [], unreadable: 0 };
  const swaps: SwapRequest[] = [];
  let unreadable = 0;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      unreadable += 1;
      continue;
    }
    const { takeOff, putOn } = entry as Record<string, unknown>;
    if (typeof takeOff !== "string" || typeof putOn !== "string") {
      unreadable += 1;
      continue;
    }
    if (!takeOff.trim() || !putOn.trim()) {
      unreadable += 1;
      continue;
    }
    swaps.push({ takeOff: takeOff.trim(), putOn: putOn.trim() });
  }
  return { swaps, unreadable };
}

function rewordRequests(value: unknown): { rewordings: RewordRequest[]; unreadable: number } {
  if (!Array.isArray(value)) return { rewordings: [], unreadable: 0 };
  const rewordings: RewordRequest[] = [];
  let unreadable = 0;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      unreadable += 1;
      continue;
    }
    const { from, to } = entry as Record<string, unknown>;
    if (typeof from !== "string" || typeof to !== "string") {
      unreadable += 1;
      continue;
    }
    if (!from.trim() || !to.trim()) {
      unreadable += 1;
      continue;
    }
    rewordings.push({ from, to });
  }
  return { rewordings, unreadable };
}
