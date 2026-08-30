import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolReference } from "@/lib/agent/shared/reference";
import { MOVE_LIMIT } from "@/lib/agent/orchestrator/board-tools";
import { boardItems } from "@/lib/boards/board-contents";
import { boardLayout } from "@/lib/layout/custom-layout";
import { PAGE_PRESET_IDS } from "@/lib/layout/moodboard-layouts";
import {
  boardPages,
  pageById,
  pagePresetSize,
  pagesInReadingOrder,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { pageDigests } from "@/lib/pages/page-contents";
import { pageDuplication } from "@/lib/pages/page-duplicate";
import { pageRemoval } from "@/lib/pages/page-remove";
import { pageStandsAsComposed } from "@/lib/pages/page-fit";
import {
  PAGE_BACKGROUND_NONE,
  setPageBackground,
} from "@/lib/pages/page-background";
import { moveToPage } from "@/lib/pages/page-move";
import { resizePage } from "@/lib/pages/page-resize";
import { persistableElements, type SceneElement } from "@/lib/scene/moodboard-scene";
import { sceneWrite } from "@/server/moodboards/scene-write";

export type PageBoardShown = {
  board: PageBoardRow;
  elements: readonly SceneElement[];
  thumbUrlOf: (referenceId: string) => string | null | undefined;
  pageId?: string;
  discard?: boolean;
  discardsPage?: boolean;
};

export type PageOutcome = {
  result: Record<string, unknown>;
  shown?: PageBoardShown;
};

export const PAGE_EDIT_BOARD_SELECT = {
  id: true,
  title: true,
  revision: true,
  elements: true,
  layout: true,
  layoutSlots: true,
  widthPx: true,
  heightPx: true,
} as const;

export type PageBoardRow = {
  id: string;
  title: string;
  revision: number;
  elements: unknown;
  layout: string | null;
  layoutSlots: unknown;
  widthPx: number;
  heightPx: number;
};

export type PageToolReferences = () => Promise<{ all: ToolReference[] }>;

export type PageToolNotes = {
  noPage: string;
  noPageToCopy: string;
  fellOffPage: string;
  composedAtOldShape: string;
  readTheBoard: string;
  makePageFirst: string;
  composedPageJoined: string;
  discardOffer: string;
  emptiesBoardOffer: string;
  noPageToDiscard: string;
  otherRectangle: string;
};

export function pageSized(page: BoardPage, inReadingOrder: readonly BoardPage[]) {
  return {
    pageId: page.id,
    name: page.name,
    position: inReadingOrder.findIndex((other) => other.id === page.id) + 1,
    of: inReadingOrder.length,
    size: `${page.width}×${page.height}`,
    preset: page.preset,
  };
}

export function pageShown(elements: readonly SceneElement[], page: BoardPage) {
  const standing = pagesInReadingOrder(boardPages(elements));
  return {
    name: page.name,
    position: standing.findIndex((other) => other.id === page.id) + 1,
    of: standing.length,
  };
}

export function pageSaid(page: BoardPage) {
  return page.name ? `“${page.name}”` : "that page";
}

export function pageToolset({
  db,
  projectId,
  references,
  notes,
}: {
  db: PrismaClient;
  projectId: string;
  references: PageToolReferences;
  notes: PageToolNotes;
}) {
  async function resizeBoardPage(args: Record<string, unknown>): Promise<PageOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: PAGE_EDIT_BOARD_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    const standing = pagesInReadingOrder(boardPages(elements));
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const page = asked ? pageById(standing, asked) : null;

    if (!page) {
      return {
        result: {
          error: asked
            ? `no page called ${asked} on that board`
            : "say which page to reshape, by pageId — there is no default page",
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote: `that board has no pages on it — it is a canvas the user arranged, so there is no page to reshape. ${notes.noPage}`,
              }),
        },
      };
    }

    const preset = typeof args.preset === "string" ? args.preset.trim() : "";
    const size = pagePresetSize(preset);
    if (!size) {
      return {
        result: {
          error: `${preset || "that"} is not a page shape — name one of ${PAGE_PRESET_IDS.join(", ")}`,
          presetsNote: notes.otherRectangle,
        },
      };
    }

    if (page.width === size.width && page.height === size.height) {
      return {
        result: {
          boardId: board.id,
          title: board.title,
          page: pageSized(page, standing),
          status: `nothing changed — ${pageSaid(page)} is already ${size.width}×${size.height}. Tell the user it is the shape they asked for rather than that it was resized`,
        },
      };
    }

    const resized = resizePage({ elements, pageId: page.id, size })!;
    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    const setsBoardDefault = standing[0]?.id === page.id;

    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...sceneWrite(resized.elements),
        ...(setsBoardDefault && { widthPx: size.width, heightPx: size.height }),
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was reshaping a page of it — the user has it open, so tell them and ask again",
        },
      };
    }

    const layout = boardLayout(board);
    const wasComposed = pageStandsAsComposed(boardItems(elements), standing, page, layout);

    return {
      result: {
        boardId: board.id,
        title: board.title,
        page: pageSized(resized.page, pagesInReadingOrder(boardPages(resized.elements))),
        was: `${resized.was.width}×${resized.was.height}`,
        ...(resized.fellOff.pictures.length || resized.fellOff.lines.length
          ? {
              fellOffPage: resized.fellOff.pictures,
              ...(resized.fellOff.lines.length && { linesOffPage: resized.fellOff.lines }),
              fellOffPageNote: `the page is smaller than it was and those were outside it, so they are on no page now — still on the board exactly where they were, and no longer part of ${pageSaid(resized.page)}. Say that rather than that they were moved or removed, and ${notes.fellOffPage}`,
            }
          : {}),
        ...(resized.joined.pictures.length || resized.joined.lines.length
          ? {
              joinedPage: resized.joined.pictures,
              ...(resized.joined.lines.length && { linesJoinedPage: resized.joined.lines }),
              joinedPageNote:
                "the page is bigger than it was and now covers those, so they are on it where they already were — nothing moved, and a page read from now on describes them as this page's",
            }
          : {}),
        ...(resized.clipped.length && {
          clippedOnPage: resized.clipped,
          clippedOnPageNote:
            "those cross the new edge and are drawn cut off there — that is an overflow rather than a crop, so say they are hanging off the page",
        }),
        ...(resized.overlaps.length && {
          overlapsPages: resized.overlaps.map((other) => ({ pageId: other.id, name: other.name })),
          overlapsPagesNote:
            "the page now runs into those pages, and a picture where two pages overlap is read as being on the topmost of them alone — tell the user the pages are touching and ask them to drag one apart, or reshape it again",
        }),
        ...(wasComposed && {
          layoutNote: `${pageSaid(resized.page)} was standing exactly as ${layout?.id ?? "its template"} composed it, and the slots were cut for the old rectangle — so the arrangement is the old shape's on the new page. ${notes.composedAtOldShape}`,
        }),
        status: `done as a scene edit — no model call was made. ${pageSaid(resized.page)} is ${size.width}×${size.height} now and nothing on it moved${standing.length > 1 ? ", with the board's other pages untouched" : ""}`,
      },
      shown: {
        board,
        elements: resized.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        pageId: resized.page.id,
      },
    };
  }

  async function setBoardPageBackground(args: Record<string, unknown>): Promise<PageOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: PAGE_EDIT_BOARD_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    const standing = pagesInReadingOrder(boardPages(elements));
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const page = asked ? pageById(standing, asked) : null;

    if (!page) {
      return {
        result: {
          error: asked
            ? `no page called ${asked} on that board`
            : "say which page to paint, by pageId — there is no default page",
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote: `that board has no pages on it — it is a canvas the user arranged, and a board's own colour is not this call's to change. ${notes.noPage}`,
              }),
        },
      };
    }

    const edit = setPageBackground({ elements, page, colour: args.colour });

    if (!edit) {
      return {
        result: {
          error: `${typeof args.colour === "string" && args.colour.trim() ? `“${args.colour.trim()}”` : "that"} is not a colour — give a hex like #0c111c, or "${PAGE_BACKGROUND_NONE}" to take the page's colour off`,
        },
      };
    }

    if (!edit.elements) {
      return {
        result: {
          boardId: board.id,
          title: board.title,
          pageId: page.id,
          ...pageShown(elements, page),
          background: edit.colour,
          status: edit.colour
            ? `nothing changed — ${pageSaid(page)} is already ${edit.colour}. Tell the user it is the colour they asked for rather than that it was repainted`
            : `nothing changed — ${pageSaid(page)} stands on no colour of its own already`,
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
            "that board was changed while I was painting a page of it — the user has it open, so tell them and ask again",
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    return {
      result: {
        boardId: board.id,
        title: board.title,
        pageId: page.id,
        ...pageShown(edit.elements, page),
        background: edit.colour,
        ...(edit.was && { was: edit.was }),
        status: edit.colour
          ? `done as a scene edit — no model call was made. ${pageSaid(page)} stands on ${edit.colour} now and nothing on it moved, so anything already on it that was the colour of the old ground is unreadable against the new one`
          : `done as a scene edit — no model call was made. ${pageSaid(page)} stands on no colour of its own now, and nothing on it moved`,
      },
      shown: {
        board,
        elements: edit.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        pageId: page.id,
      },
    };
  }

  async function duplicateBoardPage(args: Record<string, unknown>): Promise<PageOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: PAGE_EDIT_BOARD_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const copy = asked
      ? pageDuplication({
          elements,
          pageId: asked,
          name: typeof args.name === "string" ? args.name : null,
        })
      : null;

    if (!copy) {
      const standing = boardPages(elements);
      return {
        result: {
          error: asked
            ? `no page called ${asked} on that board`
            : "say which page to copy, by pageId — there is no default page",
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote: `that board has no pages on it — it is a canvas the user arranged, so there is no page to copy. ${notes.noPageToCopy}`,
              }),
        },
      };
    }

    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...sceneWrite(copy.elements),
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was copying a page of it — the user has it open, so tell them and ask again",
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const pages = pagesInReadingOrder(boardPages(copy.elements));

    return {
      result: {
        boardId: board.id,
        title: board.title,
        page: pageSized(copy.page, pages),

        copyOfPage: { pageId: copy.source.id, name: copy.source.name },
        pictures: copy.pictures,
        ...(copy.lines.length && { lines: copy.lines }),
        ...(copy.sections
          ? {
              notCopied: copy.keptInSections,
              notCopiedNote:
                "the page was drawn over sections (plain frames) the user made, and what a section holds is the section's rather than the page's — so those pictures read as on the page that was copied and are not on the copy. Say so rather than letting them find it",
            }
          : {}),
        status: `done as a scene edit — no model call was made. This is a new page holding exactly what ${pageSaid(copy.source)} holds, in the same places, and nothing on the board changed: that board is now ${pages.length} page${pages.length === 1 ? "" : "s"}. Make the change they asked for on this page, by this pageId, and tell them ${pageSaid(copy.source)} is still there as it was`,
      },
      shown: {
        board,
        elements: copy.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        pageId: copy.page.id,
      },
    };
  }

  async function moveToBoardPage(args: Record<string, unknown>): Promise<PageOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: PAGE_EDIT_BOARD_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    const standing = pagesInReadingOrder(boardPages(elements));

    const askedFrom = typeof args.fromPageId === "string" ? args.fromPageId.trim() : "";
    const askedTo = typeof args.toPageId === "string" ? args.toPageId.trim() : "";
    const from = askedFrom ? pageById(standing, askedFrom) : null;
    const to = askedTo ? pageById(standing, askedTo) : null;

    const unknown = [
      ...(askedFrom && !from ? [askedFrom] : []),
      ...(askedTo && !to ? [askedTo] : []),
    ];
    if (!from || !to) {
      return {
        result: {
          error: unknown.length
            ? `no page called ${unknown.join(" or ")} on that board`
            : "say both pages: fromPageId is the page the pictures are on now and toPageId the page they are to go on",
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote: `that board has no pages on it — it is a canvas the user arranged, so there is nowhere to move a picture to. ${notes.noPage}`,
              }),
        },
      };
    }

    if (from.id === to.id) {
      return {
        result: {
          error: `${pageSaid(from)} is both ends of that move — name the page they are to go on as toPageId, or ${notes.makePageFirst}`,
          pages: pageDigests(elements),
        },
      };
    }

    const wanted = Array.isArray(args.referenceIds)
      ? [
          ...new Set(
            args.referenceIds
              .map((id) => (typeof id === "string" ? id.trim() : ""))
              .filter((id): id is string => !!id),
          ),
        ]
      : [];
    const asked = wanted.slice(0, MOVE_LIMIT);
    const overLimit = wanted.slice(MOVE_LIMIT);
    const dropped = overLimit.length && {
      notMoved: overLimit,
      notMovedNote: `only ${MOVE_LIMIT} pictures are carried across in one call — these were not, so call again with them rather than telling the user they moved`,
    };

    if (!asked.length) {
      return {
        result: {
          error: "say which pictures to carry across, by reference id",
          ...(dropped || {}),
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    const move = moveToPage({
      elements,
      pages: standing,
      from,
      to,
      referenceIds: asked,
      sizeOf: (id) => byId.get(id),
    });

    const missing = move.notOnFrom.length && {
      notOnThatPage: move.notOnFrom,
      notOnThatPageNote: `the read was against ${pageSaid(from)} alone — those pictures are not on it, though the board may hold them on another of its pages, so ${notes.readTheBoard}`,
    };

    if (!move.moved.length) {
      return {
        result: {
          error: move.alreadyThere.length
            ? `nothing moved — ${move.alreadyThere.join(", ")} ${move.alreadyThere.length === 1 ? "is" : "are"} already on ${pageSaid(to)}`
            : `nothing on ${pageSaid(from)} moved`,
          ...(missing || {}),
          ...(move.alreadyThere.length && { alreadyThere: move.alreadyThere }),
          ...(dropped || {}),
        },
      };
    }

    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...sceneWrite(move.elements),
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was moving pictures on it — the user has it open, so tell them and ask again",
        },
      };
    }

    const layout = boardLayout(board);
    const wasComposed = pageStandsAsComposed(boardItems(elements), standing, to, layout);

    return {
      result: {
        boardId: board.id,
        title: board.title,
        from: { pageId: from.id, name: from.name },
        to: { pageId: to.id, name: to.name },
        moved: move.moved,
        status: `done as a scene edit — no model call was made. ${move.moved.length === 1 ? "That picture is" : "Those pictures are"} off ${pageSaid(from)} and on ${pageSaid(to)}, below what was already there, and nothing else on either page moved${standing.length > 2 ? ", with the board's other pages untouched" : ""}`,
        ...(missing || {}),
        ...(move.alreadyThere.length && {
          alreadyThere: move.alreadyThere,
          alreadyThereNote: `${pageSaid(to)} already carried ${move.alreadyThere.join(", ")}, so ${move.alreadyThere.length === 1 ? "that copy" : "those copies"} came off ${pageSaid(from)} and nothing was drawn twice`,
        }),
        ...(wasComposed && {
          layoutNote: `${pageSaid(to)} was standing exactly as ${layout?.id ?? "its template"} composed it and now carries a picture below the slots — ${notes.composedPageJoined}`,
        }),
        ...(dropped || {}),
      },
      shown: {
        board,
        elements: move.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        pageId: to.id,
      },
    };
  }


  async function offerBoardPageDiscard(args: Record<string, unknown>): Promise<PageOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: PAGE_EDIT_BOARD_SELECT,
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    const askedPage = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const going = askedPage ? pageRemoval(elements, askedPage) : null;
    if (!going) {
      return {
        result: {
          error: `no page called ${askedPage} on that board`,
          ...(boardPages(elements).length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote: `that board has no pages on it at all — there is nothing to take off it, ${notes.noPageToDiscard}`,
              }),
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const { page, pictures, lines, sections, keptInSections, emptiesBoard } = going;

    return {
      result: {
        boardId: board.id,
        title: board.title,
        pageId: page.id,
        ...pageShown(elements, page),
        pictures: pictures.map(({ referenceId }) => referenceId),
        ...(pictures.some((picture) => picture.clipped) && {
          clipped: pictures.filter((picture) => picture.clipped).map((p) => p.referenceId),
          clippedNote:
            "those run over the page's edge, so the tile draws them cut off — they are on this page and go with it",
        }),
        ...(lines.length && { lines }),
        pageSize: `${page.width}×${page.height}`,
        ...(sections && {
          sectionsOnIt: sections,
          keptInSections,
          sectionsNote:
            "a frame the user drew is inside that page and is not the page's — it stays on the board with its own pictures, so say the page goes and their frame does not",
        }),
        ...(emptiesBoard && {
          emptiesBoard: true,
          emptiesBoardNote: `that is the board's only page — taking it leaves the board standing with nothing on it rather than deleting it, so say so, ${notes.emptiesBoardOffer}`,
        }),
        status: `offered, not done — nothing has been taken and that page is still on the board. ${notes.discardOffer} Say which page it is, what is on it that they would lose, that the photographs stay in the gallery and that the board's other pages are untouched; never say the page is gone, removed or deleted`,
      },
      shown: {
        board,
        elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        pageId: page.id,
        discard: true,
        discardsPage: true,
      },
    };
  }

  return {
    resizeBoardPage,
    setBoardPageBackground,
    duplicateBoardPage,
    moveToBoardPage,
    offerBoardPageDiscard,
  };
}
