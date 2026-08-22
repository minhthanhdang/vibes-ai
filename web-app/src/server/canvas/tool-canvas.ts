import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  CANVAS_PUT_LIMIT,
  CANVAS_REMOVE_LIMIT,
  CANVAS_REORDER_LIMIT,
  CANVAS_TRANSFORM_LIMIT,
  referenceDigest,
  type ToolReference,
} from "@/lib/agent/agent-tools";
import { putObjects, type PutRequest } from "@/lib/canvas-objects/object-put";
import { canvasObjects } from "@/lib/canvas-objects/object-read";
import { removeObjects } from "@/lib/canvas-objects/object-remove";
import { reorderObjects, type ReorderMove } from "@/lib/canvas-objects/object-reorder";
import { transformObjects, type TransformChange } from "@/lib/canvas-objects/object-transform";
import { boardPages, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { pageDigests } from "@/lib/pages/page-contents";
import { persistableElements, type SceneElement } from "@/lib/scene/moodboard-scene";
import { sceneWrite } from "@/server/moodboards/scene-write";

/// The five canvas tools, written once for both agents (canvas.md §XI,
/// compositor-v2.md §IV.1).
///
/// Lifted out of agent 6's tool closure with nothing changed on the way, for the
/// reason §IV.1 gives: two agents writing one scene through two implementations
/// is how the user's board and the model's board drift. Every handle, every
/// y-first box, every refusal and every revision-guarded write is the one agent 6
/// has had since canvas.md §XI landed.
///
/// What the callers still own is the two things that are not about the scene.
/// The queue an edit runs in belongs to the turn or the call that owns the
/// contention, not to the tools. And the board tile belongs to whoever has a
/// chat to put it in: agent 6's replies end in a picture under a message, and
/// nothing agent 8 does is ever shown to a user (compositor-v2.md §III). So an
/// answer here ends at `result` and at the facts a tile is made of, and building
/// the tile is the caller's last step rather than a branch in the middle of this
/// one.

/// The board a canvas answer would show, in the shape `boardShown` takes.
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

/// The scene `read_canvas` read its geometry off, handed back for the caller
/// that draws it (§IV.1's one addition).
///
/// The scene rather than a boardId to read again, which is §III.3's invariant
/// spelled as a type: a second read can find a board that has moved, and a
/// picture of one revision beside boxes from another is two answers about two
/// boards in one. Absent wherever there was no geometry to draw — a board this
/// project does not carry, a page that board does not.
export type CanvasSceneRead = {
  boardId: string;
  /// Absent where the read was of the whole board, present where it was scoped
  /// to a page. A page-scoped answer lists that page's objects alone, so a
  /// picture of the whole board beside it would show things the words never
  /// accounted for — which is the drift §IV.1 exists to prevent.
  pageId?: string;
  revision: number;
  elements: unknown;
  appState: unknown;
};

export type CanvasReadOutcome = CanvasOutcome & { scene?: CanvasSceneRead };

/// The columns every canvas tool reads. `layout` and `layoutSlots` are for the
/// tile — a board laid out from a layout image has no template to be standing in
/// without them — and the two sizes are what an object put on a board with no
/// page on it is measured against.
export const CANVAS_BOARD_SELECT = {
  id: true,
  title: true,
  revision: true,
  elements: true,
  /// One small column, read for the picture alone: the background a render draws
  /// behind the scene is the app state's own, and fetching it in a second query
  /// would be fetching it at a revision this answer is not about.
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

/// Why an id a canvas edit named can match nothing: the handles are element
/// ids from `read_canvas`, and the id the model reaches for instead is the
/// referenceId it knows the picture by — which names a photograph, not a place
/// on the board, and the same photo placed twice is two objects.
export const NOT_A_HANDLE_NOTE =
  "no object with that id on this board — every handle comes from read_canvas, and a referenceId is not one: the same photo placed twice is two objects";

/// The project's pictures as either agent's loader hands them over: one list, in
/// gallery order, read once for the turn or the call it belongs to. Read here for
/// the titles alone — an image the model is shown as a bare id is one it has to
/// cross-reference by hand.
export type CanvasReferences = () => Promise<{ all: ToolReference[] }>;

export function canvasToolset({
  db,
  projectId,
  references,
}: {
  db: PrismaClient;
  projectId: string;
  references: CanvasReferences;
}) {
  /// The read every canvas tool starts with, scoped to the project like every
  /// other board read here: the id is a model argument, so it is checked
  /// rather than trusted.
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

  /// The geometric read of a board (§XI): every object with the handle the four
  /// canvas edits take. `inspect_board` answers what a board holds; this
  /// answers where each thing is and by what id — so it is the read those
  /// edits' declarations send the model to first.
  async function readCanvas(args: Record<string, unknown>): Promise<CanvasReadOutcome> {
    const { boardId, board } = await canvasBoard(args);
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const objects = canvasObjects(elements, asked ? { pageId: asked } : {});
    /// Null is "no such page", which is a different answer from an empty one —
    /// refused with the ids that would have worked, as every page refusal is.
    if (objects === null) {
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
    /// Titles are a database join the pure read cannot make, and without them
    /// an image is a bare id the model has to cross-reference by hand.
    const named = objects.map((object) => {
      const reference =
        object.kind === "image" && object.referenceId ? byId.get(object.referenceId) : null;
      return reference ? { ...object, title: referenceDigest(reference).title } : object;
    });

    return {
      result: {
        boardId: board.id,
        title: board.title,
        objects: named,
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

  /// Objects put where the user said (§XI): a named thing at a named place is a
  /// scene edit, not a rebuild — `compose_moodboard` is for arranging a set.
  async function putOnCanvas(args: Record<string, unknown>): Promise<CanvasOutcome> {
    const { boardId, board } = await canvasBoard(args);
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    /// Truncated and said, on the swap's own argument: a bound nobody is told
    /// about is indistinguishable from work that was never asked for.
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
    /// A picture outside the project is refused before the write, as the
    /// swap's is: the id is a model argument resolved against this project's
    /// own list, never trusted onto a scene as a fileId.
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

    /// Guarded on the revision that was read, as every server-side write to a
    /// board's scene is; the stored render is a picture of the board without
    /// what just landed on it.
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

  /// Objects taken off a board with everything else left standing (§XI). The
  /// removal drops elements from the array — the existing convention — and
  /// nothing leaves the project.
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

  /// Moves, rotations and resizes as pure geometry (§XI): the rules — page
  /// rotation refused, rigid groups, locked refused, aspect kept — live in the
  /// pure module; this is the plumbing around it.
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

    /// The no-op skip: a call that changes nothing writes nothing — no
    /// spurious revision conflict for an open tab, no render disowned.
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

  /// Stacking changed and nothing moved (§XI). The declaration flattens the
  /// module's union destination into three sibling fields, so this is where
  /// `{ to?, above?, below? }` becomes front/back/{above}/{below} — and a move
  /// naming none or two of them is answered, never guessed at.
  async function reorderOnCanvas(args: Record<string, unknown>): Promise<CanvasOutcome> {
    const { boardId, board } = await canvasBoard(args);
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    /// Refused with the ids that would have worked, as every page refusal in
    /// this file is.
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

    /// `front` on the frontmost skips the write entirely, like the transform's
    /// echo: no spurious conflict, no render disowned.
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


  return { readCanvas, putOnCanvas, removeFromCanvas, transformOnCanvas, reorderOnCanvas };
}

/// A put request as the model emitted it. Only the shape is checked here — an
/// entry that is not an object at all has no kind to be refused by, so it is
/// counted; everything else the pure module answers by name, which is the
/// exactly-one-bucket rule the declarations promise.
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

/// Remove selectors are strings, deduplicated here so the cap counts what the
/// model asked rather than how many times it repeated itself.
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

/// A transform change needs an object to be about; what is asked of that
/// object — the to, the angle, the size — the pure module reads and refuses
/// by name, so only a change naming no object is counted here.
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

/// The declaration flattens the module's union destination into three sibling
/// fields, because the declaration dialect carries no union types. Folded back
/// here — and a move naming none of the three, or two at once, is counted
/// rather than guessed at, since "front, but also above X" has two meanings
/// and either guess writes the wrong board.
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
    /// An unreadable named end — `above: 5`, an empty id — rides through as
    /// given: the module refuses it with the objectId attached, which beats a
    /// count with no name in it.
    moves.push({
      objectId,
      to: (to !== undefined ? to : above !== undefined ? { above } : { below }) as ReorderMove["to"],
    });
  }
  return { moves, unreadable };
}
