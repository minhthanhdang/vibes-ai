import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { referenceDigest, type ToolReference } from "@/lib/agent/shared/reference";
import { CANVAS_PUT_LIMIT, CANVAS_REMOVE_LIMIT, CANVAS_REORDER_LIMIT, CANVAS_RESTYLE_LIMIT, CANVAS_TRANSFORM_LIMIT } from "@/lib/agent/shared/canvas-tools";
import { legibilityChange } from "@/lib/canvas-objects/object-legibility";
import {
  fontVariantAsked,
  type FontResolution,
  type StyleAsked,
} from "@/lib/canvas-objects/object-style";
import { putObjects, type PutRequest } from "@/lib/canvas-objects/object-put";
import { fontVariantKey } from "@/lib/render/font-google";
import { resolveGoogleFont } from "@/server/render/google-fonts";
import { canvasRead } from "@/lib/canvas-objects/object-read";
import { removeObjects } from "@/lib/canvas-objects/object-remove";
import { reorderObjects, type ReorderMove } from "@/lib/canvas-objects/object-reorder";
import { restyleObjects, type RestyleChange } from "@/lib/canvas-objects/object-restyle";
import { transformObjects, type TransformChange } from "@/lib/canvas-objects/object-transform";
import { boardPages, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageDigests } from "@/lib/pages/page-contents";
import { CONTRAST_NOTE_LIMIT, type ContrastPair } from "@/lib/render/contrast";
import { persistableElements, type SceneElement } from "@/lib/scene/moodboard-scene";
import { sceneWrite } from "@/server/moodboards/scene-write";

export type CanvasBoardShown = {
  board: CanvasBoardRow;
  elements: readonly SceneElement[];
  thumbUrlOf: (referenceId: string) => string | null | undefined;
  pageId?: string;
};

export type CanvasOutcome = {
  result: Record<string, unknown>;
  shown?: CanvasBoardShown;
};

export type CanvasSceneRead = {
  boardId: string;
  pageId?: string;
  revision: number;
  elements: unknown;
  appState: unknown;
};

export type CanvasReadOutcome = CanvasOutcome & { scene?: CanvasSceneRead };

export const CANVAS_BOARD_SELECT = {
  id: true,
  title: true,
  revision: true,
  elements: true,
  appState: true,
  layout: true,
  layoutSlots: true,
  widthPx: true,
  heightPx: true,
} as const;

export type CanvasBoardRow = {
  id: string;
  title: string;
  revision: number;
  elements: unknown;
  appState: unknown;
  layout: string | null;
  layoutSlots: unknown;
  widthPx: number;
  heightPx: number;
};

export const NOT_A_HANDLE_NOTE =
  "no object with that id on this board — every handle comes from read_canvas, and a referenceId is not one: the same photo placed twice is two objects";

async function resolvedFonts(
  asks: readonly { asked: StyleAsked; element?: Record<string, unknown> }[],
): Promise<Map<string, FontResolution> | undefined> {
  const variants = new Map<string, { family: string; weight?: number; italic?: boolean }>();
  for (const { asked, element } of asks) {
    const variant = fontVariantAsked(asked, element);
    if (variant) variants.set(fontVariantKey(variant.family, variant.weight, variant.italic), variant);
  }
  if (!variants.size) return undefined;

  const resolved = new Map<string, FontResolution>();
  await Promise.all(
    [...variants].map(async ([key, variant]) => {
      const answer = await resolveGoogleFont(variant);
      resolved.set(key, "refusal" in answer ? answer : { int: answer.int, font: answer.font });
    }),
  );
  return resolved;
}

function canvasBackground(board: CanvasBoardRow): unknown {
  return (board.appState as { viewBackgroundColor?: unknown } | null)?.viewBackgroundColor;
}

function unreadableFields(pairs: readonly ContrastPair[], note: string) {
  if (!pairs.length) return {};
  const named = pairs.slice(0, CONTRAST_NOTE_LIMIT);
  const rest = pairs.length - named.length;
  return {
    cannotBeRead: named.map((pair) => ({
      objectId: pair.textId,
      ink: pair.ink,
      ground: pair.ground,
      ratio: Number(pair.ratio.toFixed(1)),
      wants: pair.wants,
      fontSize: Math.round(pair.fontSize),
    })),
    ...(rest > 0 && { cannotBeReadMore: rest }),
    cannotBeReadNote: note,
  };
}

export type CanvasReferences = () => Promise<{ all: ToolReference[] }>;

export type CanvasToolNotes = {
  typeClamp: string;
  textWrap: string;
  typeFloor: string;
  legibility: string;
};

export function canvasToolset({
  db,
  projectId,
  references,
  notes,
}: {
  db: PrismaClient;
  projectId: string;
  references: CanvasReferences;
  notes?: CanvasToolNotes;
}) {
  async function canvasBoard(args: Record<string, unknown>) {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: CANVAS_BOARD_SELECT,
        })
      : null;
    return { boardId, board };
  }

  const legibility = (before: unknown, after: unknown, board: CanvasBoardRow) =>
    notes
      ? unreadableFields(
          legibilityChange(before, after, { background: canvasBackground(board) }).arrived,
          notes.legibility,
        )
      : {};

  async function readCanvas(args: Record<string, unknown>): Promise<CanvasReadOutcome> {
    const { boardId, board } = await canvasBoard(args);
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const read = canvasRead(elements, asked ? { pageId: asked } : {});
    if (read === null) {
      const pages = pagesInReadingOrder(boardPages(elements));
      return {
        result: {
          error: `no page called ${asked} on that board`,
          ...(pages.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so read it without a pageId",
              }),
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const named = read.objects.map((object) => {
      const reference =
        object.kind === "image" && object.referenceId ? byId.get(object.referenceId) : null;
      return reference ? { ...object, title: referenceDigest(reference).title } : object;
    });

    return {
      result: {
        boardId: board.id,
        title: board.title,
        objects: named,
        ...(read.unaddressable && { unaddressable: read.unaddressable }),
        status:
          "read only — nothing on the board changed. objectId is the handle every canvas edit takes; box is [ymin, xmin, ymax, xmax] in the object's own boxUnit, and z stacks it among its own company with 0 at the back",
      },
      scene: {
        boardId: board.id,
        ...(asked && { pageId: asked }),
        revision: board.revision,
        elements: board.elements,
        appState: board.appState,
      },
    };
  }

  async function putOnCanvas(args: Record<string, unknown>): Promise<CanvasOutcome> {
    const { boardId, board } = await canvasBoard(args);
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const parsed = putRequests(args.objects);
    const asked = parsed.requests.slice(0, CANVAS_PUT_LIMIT);
    const overLimit = parsed.requests.slice(CANVAS_PUT_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notPut: overLimit,
        notPutNote: `only ${CANVAS_PUT_LIMIT} objects go on in one call — these were not put on, so call again with them rather than telling the user they were placed`,
      }),
      ...(parsed.unreadable > 0 && {
        unreadable: parsed.unreadable,
        unreadableNote: "entries that were not readable as objects — each one names its kind",
      }),
    };

    if (!asked.length) {
      return {
        result: {
          error:
            "say what to put on the board — each object names its kind, and an image its referenceId, text its words, a page an optional name",
          ...dropped,
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const wantedReference = (request: PutRequest) =>
      request.kind === "image" && typeof request.referenceId === "string"
        ? request.referenceId.trim()
        : "";
    const notFound = [
      ...new Set(
        asked.map(wantedReference).filter((referenceId) => referenceId && !byId.has(referenceId)),
      ),
    ];
    const runnable = asked.filter((request) => {
      const referenceId = wantedReference(request);
      return !referenceId || byId.has(referenceId);
    });

    const elements = persistableElements(board.elements);
    const edit = putObjects(elements, runnable, {
      defaultSize: { width: board.widthPx, height: board.heightPx },
      sizeOf: (referenceId) => byId.get(referenceId),
      fonts: await resolvedFonts(runnable.map((request) => ({ asked: request as StyleAsked }))),
    });

    const remainders = {
      ...(notFound.length && { notInThisProject: notFound }),
      ...(edit.alreadyOn.length && {
        alreadyOn: edit.alreadyOn,
        alreadyOnNote:
          "the target page or board already carries these, so they were not doubled",
      }),
      ...(edit.refused.length && { refused: edit.refused }),
      ...dropped,
    };

    if (!edit.elements) {
      return { result: { error: "nothing joined that board", ...remainders } };
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
            "that board was changed while I was putting objects on it — the user has it open, so tell them and ask again",
        },
      };
    }

    return {
      result: {
        boardId: board.id,
        title: board.title,
        put: edit.put,
        ...(notes && edit.clamped.length
          ? { typeSet: edit.clamped, typeSetNote: notes.typeClamp }
          : {}),
        ...(notes && edit.wrapped.length
          ? { textSet: edit.wrapped, textSetNote: notes.textWrap }
          : {}),
        ...legibility(elements, edit.elements, board),
        status:
          "done as a scene edit — nothing already on the board moved and it was not laid out again. Each put object's objectId is the handle transform_on_canvas, reorder_on_canvas and remove_from_canvas take",
        ...remainders,
      },
      shown: {
        board,
        elements: edit.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
      },
    };
  }

  async function removeFromCanvas(args: Record<string, unknown>): Promise<CanvasOutcome> {
    const { boardId, board } = await canvasBoard(args);
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const parsed = canvasSelectors(args.objects);
    const asked = parsed.selectors.slice(0, CANVAS_REMOVE_LIMIT);
    const overLimit = parsed.selectors.slice(CANVAS_REMOVE_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notRemoved: overLimit,
        notRemovedNote: `only ${CANVAS_REMOVE_LIMIT} selectors are taken in one call — these were not removed, so call again with them rather than telling the user they are off`,
      }),
      ...(parsed.unreadable > 0 && {
        unreadable: parsed.unreadable,
        unreadableNote:
          "entries that were not text — each selector is an objectId, a referenceId, a line's words or a pageId",
      }),
    };

    if (!asked.length) {
      return {
        result: {
          error:
            "say what to take off — an objectId from read_canvas, a referenceId, a line's words or a pageId",
          ...dropped,
        },
      };
    }

    const elements = persistableElements(board.elements);
    const edit = removeObjects(elements, asked);

    const remainders = {
      ...(edit.notOnBoard.length && {
        notOnBoard: edit.notOnBoard,
        notOnBoardNote:
          "matched nothing on this board as an objectId, a referenceId, a line's words or a pageId — read the board with read_canvas before naming one again",
      }),
      ...(edit.refused.length && { refused: edit.refused }),
      ...dropped,
    };

    if (!edit.elements) {
      return { result: { error: "nothing came off that board", ...remainders } };
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
            "that board was changed while I was taking objects off it — the user has it open, so tell them and ask again",
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    return {
      result: {
        boardId: board.id,
        title: board.title,
        removed: edit.removed,
        ...legibility(elements, edit.elements, board),
        status:
          "done as a scene edit — everything else is exactly where it was, and nothing left the project: a picture off a board is still in the gallery, and putting it back is one put_on_canvas call",
        ...remainders,
      },
      shown: {
        board,
        elements: edit.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
      },
    };
  }

  async function transformOnCanvas(args: Record<string, unknown>): Promise<CanvasOutcome> {
    const { boardId, board } = await canvasBoard(args);
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const parsed = transformRequests(args.changes);
    const asked = parsed.changes.slice(0, CANVAS_TRANSFORM_LIMIT);
    const overLimit = parsed.changes.slice(CANVAS_TRANSFORM_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notTransformed: overLimit.map((change) => change.objectId),
        notTransformedNote: `only ${CANVAS_TRANSFORM_LIMIT} changes are made in one call — these were not, so call again with them rather than telling the user they were done`,
      }),
      ...(parsed.unreadable > 0 && {
        unreadable: parsed.unreadable,
        unreadableNote: "changes that named no object — each one takes an objectId from read_canvas",
      }),
    };

    if (!asked.length) {
      return {
        result: {
          error:
            "say which objects to change, by objectId from read_canvas, and what about each — a to, an angle or a size",
          ...dropped,
        },
      };
    }

    const elements = persistableElements(board.elements);
    const edit = transformObjects(elements, asked);

    const remainders = {
      ...(edit.unchanged.length && {
        unchanged: edit.unchanged,
        unchangedNote: "asked for what is already true, so nothing was written for them",
      }),
      ...(edit.notFound.length && {
        notOnBoard: edit.notFound,
        notOnBoardNote: NOT_A_HANDLE_NOTE,
      }),
      ...(edit.refused.length && { refused: edit.refused }),
      ...dropped,
    };

    if (!edit.elements) {
      return { result: { error: "nothing on that board changed", ...remainders } };
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
            "that board was changed while I was moving things on it — the user has it open, so tell them and ask again",
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    return {
      result: {
        boardId: board.id,
        title: board.title,
        transformed: edit.transformed,
        ...(notes && edit.clamped.length
          ? { typeSet: edit.clamped, typeSetNote: notes.typeFloor }
          : {}),
        ...legibility(elements, edit.elements, board),
        status:
          "done as a scene edit — only the objects named moved and everything else is exactly where it was, so say the board was not laid out again",
        ...remainders,
      },
      shown: {
        board,
        elements: edit.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
      },
    };
  }

  async function reorderOnCanvas(args: Record<string, unknown>): Promise<CanvasOutcome> {
    const { boardId, board } = await canvasBoard(args);
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

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
        },
      };
    }

    const parsed = reorderRequests(args.moves);
    const asked = parsed.moves.slice(0, CANVAS_REORDER_LIMIT);
    const overLimit = parsed.moves.slice(CANVAS_REORDER_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notReordered: overLimit.map((move) => move.objectId),
        notReorderedNote: `only ${CANVAS_REORDER_LIMIT} moves are made in one call — these were not, so call again with them rather than telling the user they were done`,
      }),
      ...(parsed.unreadable > 0 && {
        unreadable: parsed.unreadable,
        unreadableNote:
          "moves that did not name one object and exactly one destination — to front or back, above or below another object",
      }),
    };

    if (!asked.length) {
      return {
        result: {
          error:
            "say which objects to restack, by objectId from read_canvas, each with exactly one destination — to front or back, above or below another object",
          ...dropped,
        },
      };
    }

    const edit = reorderObjects(elements, asked, onPage ? { pageId: onPage.id } : {});

    const remainders = {
      ...(edit.unchanged.length && {
        unchanged: edit.unchanged,
        unchangedNote: "already stacked that way, so nothing was written for them",
      }),
      ...(edit.notFound.length && {
        notOnBoard: edit.notFound,
        notOnBoardNote: NOT_A_HANDLE_NOTE,
      }),
      ...(edit.refused.length && { refused: edit.refused }),
      ...dropped,
    };

    if (!edit.elements) {
      return { result: { error: "nothing on that board changed", ...remainders } };
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
            "that board was changed while I was restacking it — the user has it open, so tell them and ask again",
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
        reordered: edit.reordered,
        ...legibility(elements, edit.elements, board),
        status:
          "done as a scene edit — stacking changed and nothing moved: every object stands exactly where it was",
        ...remainders,
      },
      shown: {
        board,
        elements: edit.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        pageId: onPage?.id,
      },
    };
  }


  async function restyleOnCanvas(args: Record<string, unknown>): Promise<CanvasOutcome> {
    const { boardId, board } = await canvasBoard(args);
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const parsed = restyleRequests(args.changes);
    const asked = parsed.changes.slice(0, CANVAS_RESTYLE_LIMIT);
    const overLimit = parsed.changes.slice(CANVAS_RESTYLE_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notRestyled: overLimit.map((change) => change.objectId),
        notRestyledNote: `only ${CANVAS_RESTYLE_LIMIT} objects are restyled in one call — these were not, so call again with them rather than telling the user they were done`,
      }),
      ...(parsed.unreadable > 0 && {
        unreadable: parsed.unreadable,
        unreadableNote: "changes that named no object — each one takes an objectId from read_canvas",
      }),
    };

    if (!asked.length) {
      return {
        result: {
          error:
            "say which objects to restyle, by objectId from read_canvas, and what about each — a fill, a stroke, an ink, a family, a size or an opacity",
          ...dropped,
        },
      };
    }

    const elements = persistableElements(board.elements);
    const byElementId = new Map(elements.map((element) => [element.id, element]));
    const edit = restyleObjects(
      elements,
      asked,
      await resolvedFonts(
        asked.map((change) => ({ asked: change, element: byElementId.get(change.objectId) })),
      ),
    );

    const remainders = {
      ...(edit.unchanged.length && {
        unchanged: edit.unchanged,
        unchangedNote: "already looked like that, so nothing was written for them",
      }),
      ...(edit.notFound.length && {
        notOnBoard: edit.notFound,
        notOnBoardNote: NOT_A_HANDLE_NOTE,
      }),
      ...(edit.refused.length && { refused: edit.refused }),
      ...dropped,
    };

    if (!edit.elements) {
      return { result: { error: "nothing on that board changed", ...remainders } };
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
            "that board was changed while I was restyling it — the user has it open, so tell them and ask again",
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    return {
      result: {
        boardId: board.id,
        title: board.title,
        restyled: edit.restyled,
        ...legibility(elements, edit.elements, board),
        status:
          "done as a scene edit — only how the objects named look changed, and nothing moved, resized or restacked",
        ...remainders,
      },
      shown: {
        board,
        elements: edit.elements,
        thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
      },
    };
  }

  return {
    readCanvas,
    putOnCanvas,
    removeFromCanvas,
    transformOnCanvas,
    reorderOnCanvas,
    restyleOnCanvas,
  };
}

function putRequests(value: unknown): { requests: PutRequest[]; unreadable: number } {
  if (!Array.isArray(value)) return { requests: [], unreadable: 0 };
  const requests: PutRequest[] = [];
  let unreadable = 0;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      unreadable += 1;
      continue;
    }
    requests.push(entry as PutRequest);
  }
  return { requests, unreadable };
}

function canvasSelectors(value: unknown): { selectors: string[]; unreadable: number } {
  const listed = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const selectors: string[] = [];
  let unreadable = 0;
  for (const entry of listed) {
    const selector = typeof entry === "string" ? entry.trim() : "";
    if (selector) selectors.push(selector);
    else unreadable += 1;
  }
  return { selectors: [...new Set(selectors)], unreadable };
}

function transformRequests(value: unknown): { changes: TransformChange[]; unreadable: number } {
  if (!Array.isArray(value)) return { changes: [], unreadable: 0 };
  const changes: TransformChange[] = [];
  let unreadable = 0;
  for (const entry of value) {
    const change =
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    const objectId = typeof change?.objectId === "string" ? change.objectId.trim() : "";
    if (!change || !objectId) {
      unreadable += 1;
      continue;
    }
    changes.push({ ...change, objectId } as TransformChange);
  }
  return { changes, unreadable };
}

function restyleRequests(value: unknown): { changes: RestyleChange[]; unreadable: number } {
  if (!Array.isArray(value)) return { changes: [], unreadable: 0 };
  const changes: RestyleChange[] = [];
  let unreadable = 0;
  for (const entry of value) {
    const change =
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    const objectId = typeof change?.objectId === "string" ? change.objectId.trim() : "";
    if (!change || !objectId) {
      unreadable += 1;
      continue;
    }
    changes.push({ ...change, objectId } as RestyleChange);
  }
  return { changes, unreadable };
}

function reorderRequests(value: unknown): { moves: ReorderMove[]; unreadable: number } {
  if (!Array.isArray(value)) return { moves: [], unreadable: 0 };
  const moves: ReorderMove[] = [];
  let unreadable = 0;
  for (const entry of value) {
    const move =
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    const objectId = typeof move?.objectId === "string" ? move.objectId.trim() : "";
    if (!move || !objectId) {
      unreadable += 1;
      continue;
    }
    const { to, above, below } = move;
    if ([to, above, below].filter((destination) => destination !== undefined).length !== 1) {
      unreadable += 1;
      continue;
    }
    moves.push({
      objectId,
      to: (to !== undefined ? to : above !== undefined ? { above } : { below }) as ReorderMove["to"],
    });
  }
  return { moves, unreadable };
}
