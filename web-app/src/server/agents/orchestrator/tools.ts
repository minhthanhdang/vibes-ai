import "server-only";
import type { ProjectState, ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { drawnFrom, referenceCatalog, referenceDigest, referenceProperties, type ReferenceProperties, type ToolReference, UNREAD_CATALOG_NOTE, UNREAD_MARK, unreadReason } from "@/lib/agent/shared/reference";
import { attachmentOf, boardAttachmentOf, type ToolOutcome } from "@/lib/agent/shared/attachments";
import { PUT_ON_CANVAS, READ_CANVAS, REMOVE_FROM_CANVAS, REORDER_ON_CANVAS, RESTYLE_ON_CANVAS, SET_CANVAS_BACKGROUND, SET_PAGE_BACKGROUND, TRANSFORM_ON_CANVAS } from "@/lib/agent/shared/canvas-tools";
import { boardLine, boardsList, catalogBrief, currentBoardBrief, projectBrief } from "@/lib/agent/orchestrator/priming";
import { EDIT_REFERENCE, DISCARD_REFERENCE, GENERATE_IMAGE, LIST_REFERENCES, pickReferences, READ_LIMIT, READ_REFERENCES, SHOW_REFERENCES, SHOWN_LIMIT } from "@/lib/agent/orchestrator/reference-tools";
import { ADD_BOARD, ADD_PAGE, DISCARD_BOARD, DISCARD_PAGE, DUPLICATE_BOARD, DUPLICATE_PAGE, GET_BOARD_BRIEF, INSPECT_BOARD, LIST_BOARDS, MOVE_TO_PAGE, RESIZE_PAGE, REWORD_ON_BOARD, SWAP_ON_BOARD } from "@/lib/agent/orchestrator/board-tools";
import { DESIGN_PAGE } from "@/lib/agent/orchestrator/handoff-tools";
import { COMPOSE_MOODBOARD } from "@/lib/agent/orchestrator/deprecated/compose-tools";
import { orchestratorTools } from "@/lib/agent/orchestrator/tools";
import {
  boardsStandingOn,
  cropOfferCaption,
  cropOfferShape,
  standingOnNote,
} from "@/lib/crop/crop-offer";
import { pictureNoun } from "@/lib/references/reference-discard";
import { isGeneratedOrigin } from "@/lib/references/reference-filter";
import {
  boardReferenceUsage,
  referenceUsageIndex,
  removalUsage,
  type UsingBoard,
} from "@/lib/references/reference-usage";
import {
  versionDescendants,
} from "@/lib/references/reference-version";
import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import type { EditOp } from "@/lib/edit/edit-ops";
import { editSaid } from "@/lib/edit/edit-said";
import type { EditPreviewing } from "@/server/references/edits";
import type { Cut } from "@/server/references/cut";
import type { UploadContentType } from "@/lib/intake/image-types";
import { storeProjectUpload } from "@/server/references/upload";
import {
  drawPicture,
  drawnFailed,
  type GenerationTally,
} from "@/server/references/tool-generation";
import {
  cutFailed,
  cutTarget,
  makeCut,
  targetFailed,
  type CropTally,
} from "@/server/references/tool-crop";
import { editReference } from "@/server/agents/image-editor/image-editor";
import { generateImage } from "@/server/agents/image-generator/image-generator";
import { readLayout } from "@/server/agents/deprecated/layout-reader";
import { type GeneratePart } from "@/server/google/vertex";
import { spentColumns, spentThrown } from "@/lib/agent/shared/model-cost";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import {
  COMPOSE_BLOCK_LIMIT,
  LINES_NOT_OFFERED_NOTE,
  boardSelection,
  changesContentsOnly,
  composedBoardTitle,
  composedScene,
  layoutBlocks,
  lineSelection,
  linesNotOffered,
  linesWithNoSlot,
  linesWithNoSlotNote,
  renamesOnly,
} from "@/lib/layout/moodboard-compose";
import { boardLayout, customLayoutColumns } from "@/lib/layout/custom-layout";
import {
  CUSTOM_LAYOUT,
  PAGE_PRESETS,
  layoutForBoard,
  planAssignments,
  seatUnplaced,
  type AssignmentPlan,
  type LayoutBlock,
  type MoodboardLayout,
  type Placement,
  type SeatedPlan,
} from "@/lib/layout/moodboard-layouts";
import { keptSeats } from "@/lib/layout/moodboard-seats";
import { keyedQueue } from "@/lib/util/keyed-queue";
import {
  LOOSE_IN_SLOT_NOTE,
  looseFits,
  nearestCropAspect,
  standsAsComposed,
} from "@/lib/layout/slot-fit";
import { boardContents, boardItems } from "@/lib/boards/board-contents";
import {
  CANVAS_BACKGROUND_DEFAULT,
  setCanvasBackground,
} from "@/lib/boards/board-background";
import { pageBackgroundColour } from "@/lib/pages/page-background";
import {
  boardPages,
  itemsOnPage,
  nextPageName,
  pageById,
  pagePresetSize,
  pagesInReadingOrder,
  renamePage,
} from "@/lib/pages/board-pages";
import { sceneWrite } from "@/server/moodboards/scene-write";
import { canvasToolset, type CanvasOutcome } from "@/server/canvas/tool-canvas";
import { boardToolset, type BoardEditOutcome } from "@/server/boards/tool-boards";
import {
  pageSaid,
  pageShown,
  pageSized,
  pageToolset,
  type PageOutcome,
} from "@/server/pages/tool-pages";
import { addPage } from "@/lib/pages/page-add";
import { pageContents, pageDigests, picturesOffPages } from "@/lib/pages/page-contents";
import { pageBlocks } from "@/lib/pages/page-blocks";
import { PAGES_PER_MESSAGE, pageBriefText } from "@/lib/pages/page-brief";
import {
  layoutForPage,
  newPageBox,
  pageBackgroundElement,
  pageCarriesShapes,
  pageLocalItems,
  sceneOffPage,
} from "@/lib/pages/page-compose";
import { pagedLooseFits, pagedSlotShape, pageStandsAsComposed } from "@/lib/pages/page-fit";
import { placeLinesOnPage, placeOnPage } from "@/lib/pages/page-place";
import type { BoardPage } from "@/lib/pages/board-pages";
import { boardPreview } from "@/lib/boards/board-preview";
import { boardShown } from "@/lib/boards/board-shown";
import { placeOnBoard } from "@/lib/boards/board-place";
import { LINE_NOT_ON_BOARD_NOTE, placeLinesOnBoard } from "@/lib/boards/board-line";
import {
  persistableElements,
  persistedAppState,
  sceneReferenceIds,
  type SceneElement,
} from "@/lib/scene/moodboard-scene";
import { duplicateBoardTitle, normalizedBoardTitle } from "@/lib/scene/moodboard-boards";
import { BOARD_RENDER_CONTENT_TYPE, boardRenderIsCurrent } from "@/lib/scene/moodboard-render";
import { boardRenderGcsUri, copyBoardRender, pageRenderGcsUri } from "@/server/moodboards/render";
import { blockBrief, composeMoodboard, pageBrief } from "@/server/agents/deprecated/compositor";
import { designPage } from "@/server/agents/designer/design";
import {
  GALLERY_ORDER,
  TOOL_REFERENCE_SELECT,
  toolReferences,
  unreadReasons,
  type ReferenceRow,
} from "@/server/references/tool-references";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

export type Toolset = {
  declarations: () => Promise<ToolDeclaration[]>;
  state: () => Promise<ProjectState>;
  execute: (call: { name: string; args: Record<string, unknown> }) => Promise<ToolOutcome>;
  brief: () => Promise<string>;
  attachedPages: (pages: readonly AttachedPage[]) => Promise<AttachedPageParts>;
};

export type AttachedPage = {
  boardId: string;
  pageId: string;
  revision: number;
  renderUri?: string | null;
};

export type AttachedPageParts = {
  parts: GeneratePart[];
  pages: { boardId: string; pageId: string; name: string; rendered: boolean }[];
};

const NOT_READ_YET_NOTE =
  "the property analyzer has not read these yet, so they were arranged on shape alone and not on their look — tell the user the board can be laid out again once the tags land, and do not describe what these pictures are of";

const NOT_ON_PAGE_NOTE =
  "read against that page alone — a picture on another page of the board, or loose on its canvas beside the pages, is not on this one. Read the board with inspect_board to see which page holds it";

const ARRANGEMENT_NOTE =
  "where each block sits on the page: box is [ymin, xmin, ymax, xmax], y first, as thousandths of the page rather than pixels — so 0 is the top or left edge, 1000 the bottom or right, and a block from 0 to 500 across fills the left half. z is stacking order with 0 at the back, which is what says which of two overlapping pictures is on top. Read positions off these when the user says 'the one on the left', 'above it' or 'the big one'";

type BoardRow = {
  id: string;
  title: string;
  widthPx: number;
  heightPx: number;
  layout: string | null;
  pageCount: number;
  pageNames: string[];
};

const BOARD_ROW_SELECT = {
  id: true,
  title: true,
  widthPx: true,
  heightPx: true,
  layout: true,
  pageCount: true,
  pageNames: true,
} as const;

export function referenceToolset({
  db,
  projectId,
  currentBoardId,
  compose = composeMoodboard,
  edit = editReference,
  readPage = readLayout,
  design = designPage,
  generate = generateImage,
  storeImage = (contentType: UploadContentType, bytes: Uint8Array) =>
    storeProjectUpload(projectId, contentType, bytes),
  cutRegion = async (gcsUri: string, region: CropRegion, ops?: readonly EditOp[]) => {
    const { cutFromOriginal } = await import("@/server/references/cut");
    return cutFromOriginal(gcsUri, region, ops);
  },
  previewEdit,
  kickAnalyzer = () => {
    void import("@/server/agents/analyzer/analysis-queue").then(({ kickAnalyzerWorker }) =>
      kickAnalyzerWorker(),
    );
  },
  kickThumbnail = (referenceId: string, bytes: Uint8Array) => {
    void import("@/server/references/thumbnail-queue").then(({ kickReferenceThumbnail }) =>
      kickReferenceThumbnail({ projectId, referenceId, bytes }),
    );
  },
  copyRender = async (sourceBoardId: string, targetBoardId: string) => {
    await copyBoardRender(projectId, sourceBoardId, targetBoardId);
    return boardRenderGcsUri(projectId, targetBoardId);
  },
  pageRender = (boardId: string, pageId: string, revision: number) =>
    pageRenderGcsUri(projectId, boardId, pageId, revision),
}: {
  db: PrismaClient;
  projectId: string;
  currentBoardId?: string;
  compose?: typeof composeMoodboard;
  edit?: typeof editReference;
  readPage?: typeof readLayout;
  design?: typeof designPage;
  generate?: typeof generateImage;
  storeImage?: (contentType: UploadContentType, bytes: Uint8Array) => Promise<string>;
  cutRegion?: (gcsUri: string, region: CropRegion, ops?: readonly EditOp[]) => Promise<Cut>;
  previewEdit?: (gcsUri: string) => Promise<EditPreviewing | undefined>;
  kickAnalyzer?: () => void;
  kickThumbnail?: (referenceId: string, bytes: Uint8Array) => void;
  copyRender?: (sourceBoardId: string, targetBoardId: string) => Promise<string>;
  pageRender?: (boardId: string, pageId: string, revision: number) => string;
}): Toolset {
  let loaded: Promise<{
    photos: ToolReference[];
    all: ToolReference[];
    frames: Map<string, ReferenceRow>;
  }> | null = null;

  function references() {
    loaded ??= db.reference
      .findMany({
        where: { projectId },
        orderBy: [...GALLERY_ORDER],
        select: TOOL_REFERENCE_SELECT,
      })
      .then(async (rows) => {
        const all = toolReferences(rows, await unreadReasons(db, projectId, rows));
        return {
          all,
          photos: all.filter((reference) => !reference.source),
          frames: new Map(rows.map((row) => [row.id, row])),
        };
      });
    return loaded;
  }

  function filePicture(row: ReferenceRow): ToolReference {
    const [picture] = toolReferences(
      [row],
      new Map([[row.id, unreadReason({ status: RunStatus.QUEUED })]]),
    );
    const made = picture!;
    loaded = (loaded ?? references()).then(({ all, frames }) => {
      const under = all.findIndex((reference) => !reference.favorite);
      const withIt =
        under < 0 ? [...all, made] : [...all.slice(0, under), made, ...all.slice(under)];
      return {
        all: withIt,
        photos: withIt.filter((reference) => !reference.source),
        frames: new Map(frames).set(row.id, row),
      };
    });
    return made;
  }

  let boardRows: Promise<BoardRow[]> | null = null;

  function boards() {
    boardRows ??= db.moodboard.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: BOARD_ROW_SELECT,
    });
    return boardRows;
  }

  function boardDigest({ id, title, widthPx, heightPx, layout, pageCount, pageNames }: BoardRow) {
    return {
      id,
      title,
      width: widthPx,
      height: heightPx,
      layout,
      pages: pageCount,
      pageNames,
    };
  }

  function fileBoard(row: BoardRow) {
    boardRows = boards().then((rows) => [row, ...rows]);
  }

  let projectRow: Promise<{ title: string; brief: string } | null> | null = null;

  function project() {
    projectRow ??= db.project.findUnique({
      where: { id: projectId },
      select: { title: true, brief: true },
    });
    return projectRow;
  }

  const crops: CropTally = { asked: 0, filed: 0 };

  const pictures: GenerationTally = { asked: 0, filed: 0 };

  const boardEdits = keyedQueue();

  const boardKey = (args: Record<string, unknown>) =>
    typeof args.boardId === "string" ? args.boardId.trim() : "";

  const canvas = canvasToolset({ db, projectId, references });

  const pages = pageToolset({
    db,
    projectId,
    references,
    notes: {
      noPage: "Call add_page to draw its first page around what it already holds",
      noPageToCopy:
        "Call add_page to draw its first page around what it already holds, or duplicate_board to copy the whole of it",
      fellOffPage: "offer to design the page again to bring them back onto it",
      composedAtOldShape:
        "Say so; do not design it again without asking, which is an arrangement they did not ask for",
      readTheBoard: "read the board with inspect_board before naming a page again",
      makePageFirst: "add_page first if it does not exist yet",
      composedPageJoined:
        "offer to design that page again with design_page, and do not do it without asking",
      discardOffer: "The user has a Discard button beside your reply and it is theirs to press.",
      emptiesBoardOffer:
        "and offer discard_board instead if the board is what they meant to lose",
      noPageToDiscard: "and discard_board is the call if they want the board gone",
      otherRectangle:
        "any other rectangle is the user's own to drag on the canvas: these are the shapes the layout templates are cut for",
    },
  });

  const boardEditor = boardToolset({
    db,
    projectId,
    references,
    notes: {
      readThePage: "read the page with inspect_board",
      readTheBoard: "read it with inspect_board",
      removeALine: "design_page",
      looseInSlot: LOOSE_IN_SLOT_NOTE,
    },
  });

  const asShown = ({ result, shown }: CanvasOutcome | PageOutcome | BoardEditOutcome): ToolOutcome => ({
    result,
    ...(shown && { attachments: [boardShown(shown)] }),
  });

  async function readPictures(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { all } = await references();
    const asked = asStringArray(args.referenceIds);
    if (!asked.length) {
      return { result: { error: "name the pictures whose properties you want, by their ids" } };
    }

    const { found, missing, overLimit } = pickReferences(all, asked, READ_LIMIT);

    const read: ReferenceProperties[] = [];
    const notRead: { id: string; mark?: string; drawnFrom?: string }[] = [];
    let anyDrawn = false;

    for (const reference of found) {
      const properties = referenceProperties(reference);
      if (properties) {
        read.push(properties);
        anyDrawn ||= properties.drawnFrom != null;
        continue;
      }
      const asked = drawnFrom(reference);
      anyDrawn ||= asked != null;
      notRead.push({
        id: reference.id,
        ...(reference.unread && { mark: UNREAD_MARK[reference.unread] }),
        ...(asked && { drawnFrom: asked }),
      });
    }

    return {
      result: {
        read,
        ...(notRead.length && {
          notRead,
          notReadNote:
            "no properties are stored for these, so nothing in this answer says what they look like, unless one carries a “drawn from” — do not describe the rest as plain. A picture marked “not read yet” gets them on its own; one marked “could not be read” or “never read” does not, and only the user can ask for a reading, from that picture's properties panel.",
        }),
        ...(anyDrawn && {
          drawnFromNote:
            "a “drawn from” is the description this assistant drew that picture at — what was asked for rather than what a reader saw, so it is what to vary when the user wants another like it, and the only account of a drawing the analyzer has not reached yet.",
        }),
        ...(missing.length && { notFound: missing }),
        ...(overLimit.length && {
          notLookedUp: overLimit,
          notLookedUpNote: `only ${READ_LIMIT} pictures' properties fit in one answer — ask for these in another call rather than describing them`,
        }),
      },
    };
  }

  async function makeCrop(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { frames } = await references();
    const referenceId = typeof args.referenceId === "string" ? args.referenceId : "";
    const targeting = cutTarget({
      frames,
      referenceId,
      intention: typeof args.intention === "string" ? args.intention.trim() : "",
      shapeSaid: typeof args.aspect === "string" ? args.aspect.trim() : "",
      noun: "reference",
    });
    if (targetFailed(targeting)) return { result: { error: targeting.error } };
    const { named, frame, nudge, loose, aspect } = targeting;

    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: { id: true, title: true, elements: true, layout: true, layoutSlots: true },
        })
      : null;
    if (boardId && !board) {
      return { result: { error: `no board called ${boardId} in this project` } };
    }
    const scene = board ? persistableElements(board.elements) : [];

    const pagesOn = pagesInReadingOrder(boardPages(scene));
    const askedPage = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const onPage = askedPage ? pageById(pagesOn, askedPage) : null;
    if (board && askedPage && !onPage) {
      return {
        result: {
          error: `no page called ${askedPage} on that board`,
          ...(pagesOn.length
            ? { pages: pageDigests(scene) }
            : {
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so call this again without a pageId",
              }),
        },
      };
    }

    const placed = board
      ? onPage
        ? pageContents(scene, onPage).pictures.map((picture) => picture.referenceId)
        : sceneReferenceIds(scene)
      : [];
    const onBoard = placed.includes(named.id)
      ? named.id
      : placed.includes(frame.id)
        ? frame.id
        : null;
    const swapTarget =
      board && onBoard
        ? {
            boardId: board.id,
            title: board.title,
            ...(onBoard !== frame.id && { takeOff: onBoard }),
          }
        : null;

    const layout =
      swapTarget && board?.layout && frame.width && frame.height ? boardLayout(board) : null;
    const opening = layout
      ? pagedSlotShape(boardItems(scene), pagesOn, layout, onBoard ?? frame.id, onPage)
      : null;
    const heldToSlot =
      opening &&
      (loose
        ? loose.holds(opening.shape.ratio)
        : !aspect || nearestCropAspect(opening.shape.ratio) === aspect)
        ? opening
        : null;
    const held = heldToSlot ? heldToSlot.shape.label : aspect;
    const framed = heldToSlot ? null : loose;

    const making = await makeCut({
      db,
      projectId,
      target: targeting,
      held,
      framed,
      tally: crops,
      via: "orchestrator",
      edit,
      cutRegion,
      ...(previewEdit && { previewEdit }),
      storeImage,
      file: filePicture,
      kickAnalyzer,
    });
    if (cutFailed(making)) return { result: { error: making.error } };
    const { row, filed, cut, ops } = making;

    const swapped = swapTarget
      ? await boardEditor.swapPictures({
          boardId: swapTarget.boardId,
          ...(onPage && { pageId: onPage.id }),
          swaps: [{ takeOff: swapTarget.takeOff ?? frame.id, putOn: row.id }],
        })
      : null;
    const swapFailed = swapped && typeof swapped.result.error === "string";

    const standing =
      !boardId && (await boards()).length
        ? boardsStandingOn(
            referenceUsageIndex(
              boardReferenceUsage(
                await db.moodboard.findMany({
                  where: { projectId },
                  orderBy: { updatedAt: "desc" },
                  select: { id: true, title: true, elements: true },
                }),
              ),
            ),
            { cut: nudge ? named.id : null, frame: frame.id },
          )
        : [];
    const alsoOnBoards = standingOnNote(standing);

    const onIt = swapTarget && !swapFailed ? `“${swapTarget.title}”` : null;
    return {
      result: {
        referenceId: row.id,
        cutOf: frame.id,
        ...(nudge && {
          nudgeOf: `${named.id} is untouched — this is that cut moved, filed as a second cut of ${frame.id}. Say it is an adjustment of their cut, and that the old one is still in the versions list to discard if they want it gone`,
        }),
        keeps: cut.editIntent,
        did: editSaid(ops),
        why: cut.editRationale,
        ...(cut.aspect && { aspect: cut.aspect }),
        ...(framed && {
          framedAs: `framed ${framed.wants} rather than held to an exact ratio — the cut came out ${cropOfferShape(cut, frame) ?? "a shape this frame's pixel size was never recorded to measure"}`,
        }),
        size: cropOfferCaption(cut, frame),
        status: onIt
          ? `cut and filed as a version of ${frame.id}, and put on ${onIt}${onPage ? ` on ${pageSaid(onPage)}` : ""} in place of ${swapTarget!.takeOff ?? "the frame"}. The frame itself is untouched and still in the project. Say the cut was made and the board changed, and offer discard_reference on ${row.id} if it is not the shot they meant`
          : `cut and filed as a version of ${frame.id} — a reference like any other now, and the analyzer will read it. The frame it came out of is untouched and still in the project. Say the cut was made rather than offered, and offer discard_reference on ${row.id} in the same breath if it is not the shot they meant`,
        ...(swapFailed && {
          notPutOnBoard: `the cut is filed, but it could not be put on “${swapTarget!.title}”: ${swapped!.result.error as string}`,
        }),
        ...(board &&
          !onBoard && {
            notOnThatBoard: onPage
              ? `${referenceId} is not on ${pageSaid(onPage)} of “${board.title}”, so the cut was filed and nothing on that board changed — the board may hold it a page away, so read the page with inspect_board before naming one again, or call design_page naming ${row.id} if the user wants it there`
              : `${referenceId} is not on “${board.title}”, so the cut was filed and nothing on that board changed — call design_page naming ${row.id} if the user wants it there`,
          }),
        ...(alsoOnBoards && { alsoOnBoards }),
        ...(heldToSlot && {
          heldToSlot: `held to ${cut.aspect}, the exact shape of the ${heldToSlot.slotId} slot on ${onPage ? `${pageSaid(onPage)} of ` : ""}“${swapTarget?.title}” rather than to ${aspect ?? loose?.wants ?? "the frame's own subject"} — so it fills that opening with no page showing`,
        }),
      },
      attachments: [
        attachmentOf(filed),
        ...(swapped && !swapFailed && swapped.shown ? [boardShown(swapped.shown)] : []),
      ],
    };
  }

  async function makePicture(args: Record<string, unknown>): Promise<ToolOutcome> {
    const drawing = await drawPicture({
      db,
      projectId,
      description: typeof args.description === "string" ? args.description.trim() : "",
      shapeSaid: typeof args.aspect === "string" ? args.aspect.trim() : "",
      via: "orchestrator",
      tally: pictures,
      takenTitles: async () => (await references()).all.map((reference) => reference.title),
      file: filePicture,
      generate,
      storeImage,
      kickAnalyzer,
      kickThumbnail,
    });
    if (drawnFailed(drawing)) return { result: { error: drawing.error } };
    const { row, picture, title, size, shape, offShape } = drawing;

    return {
      result: {
        imageId: row.id,
        title,
        ...(size ?? {}),
        ...(shape && { aspect: shape.label }),
        ...(offShape && {
          drawnAt: `${size!.width}×${size!.height}, which is not ${shape!.label} — the drawing model composes at its own canvas sizes. Crop it with edit_reference if the shape has to be exact`,
        }),
        status: !size
          ? "drawn and filed in this project, but its pixel size could not be read — it is a reference like any other and the analyzer will read it. Tell the user the picture was made rather than found"
          : "drawn and filed in this project — it is a reference like any other now, and the analyzer will read it like an upload. Tell the user the picture was made rather than found",
      },
      attachments: [attachmentOf(picture)],
    };
  }

  async function listBoards(): Promise<ToolOutcome> {
    const filed = await boards();
    if (!filed.length)
      return {
        result: {
          total: 0,
          boards: [],
          note: "this project has no boards — add_board is what makes the first one",
        },
      };

    return { result: { total: filed.length, boards: boardsList(filed.map(boardDigest)) } };
  }

  async function getBoardBrief(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    if (!boardId)
      return { result: { error: "name the board to look up, by an id from list_boards" } };

    const filed = await boards();
    const board = filed.find((row) => row.id === boardId);
    if (!board)
      return {
        result: {
          error: `no board called ${boardId} in this project`,
          boardsNote: `call list_boards for the ${filed.length} ${filed.length === 1 ? "board" : "boards"} this project actually holds, and take the id off that answer`,
        },
      };

    return { result: { board: boardLine(boardDigest(board)) } };
  }

  async function inspectBoard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: {
            id: true,
            title: true,
            widthPx: true,
            heightPx: true,
            elements: true,
            layout: true,
            layoutSlots: true,
          },
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    const elements = persistableElements(board.elements);
    const items = boardItems(elements, { shapes: true });

    const pages = pagesInReadingOrder(boardPages(elements));
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const page = asked ? pageById(pages, asked) : null;
    if (asked && !page) {
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

    const contents = page ? pageContents(elements, page) : wholeBoard(elements);
    const { background, lines, unnamedImages } = contents;

    const on = contents.pictures.map(({ referenceId: id, clipped }, index) => {
      const over = clipped ? { clipped: true } : {};
      const reference = byId.get(id);
      if (!reference) {
        return { position: index + 1, id, gone: true, ...over };
      }
      const digest = referenceDigest(reference);
      return {
        position: index + 1,
        id,
        title: digest.title,
        shape: digest.shape,
        ...(digest.croppedFrom && { croppedFrom: digest.croppedFrom }),
        ...(digest.keeps && { keeps: digest.keeps }),
        ...over,
      };
    });

    const arrangement = page ? pageBlocks(itemsOnPage(items, pages, page), page) : null;

    const thumbUrlOf = (id: string) => byId.get(id)?.thumbUrl;

    const layout = boardLayout(board);
    const loose = layout ? pagedLooseFits(items, page ? [page] : pages, layout) : [];

    const offPages = page ? [] : picturesOffPages(elements, pages);
    const clipped = on.some((picture) => "clipped" in picture);

    return {
      result: {
        boardId: board.id,
        title: board.title,
        ...(page
          ? {
              page: {
                pageId: page.id,
                name: page.name,
                position: pages.indexOf(page) + 1,
                of: pages.length,
                size: `${page.width}×${page.height}`,
                preset: page.preset,
              },
            }
          : {
              pageSize: `${board.widthPx}×${board.heightPx}`,
              ...(pages.length && {
                pages: pageDigests(elements),
                pagesNote:
                  "that board is laid out on those pages — read one of them by calling this again with its pageId to see what is on it, and name a page when you compose",
              }),
              ...(offPages.length && {
                picturesOnNoPage: offPages,
                picturesOnNoPageNote:
                  "those sit on the canvas beside the pages rather than on one of them, so they are on no page's picture and nothing composed will move them",
              }),
            }),
        ...(board.layout &&
          (!page || pageStandsAsComposed(items, pages, page, layout)) && { composedAs: board.layout }),
        pictures: on,
        ...(background && {
          background,
          backgroundNote:
            "that picture stands behind the whole page rather than being one of the photographs on it: it covers the page and everything else is drawn over it. Leave it out of the count, and to put a different one behind, call design_page naming the new picture and saying in the intention that it is the background",
        }),
        ...(arrangement?.blocks.length && {
          arrangement: arrangement.blocks,
          arrangementNote: ARRANGEMENT_NOTE,
          ...(arrangement.omitted && {
            arrangementOmitted: `${arrangement.omitted} more block${arrangement.omitted === 1 ? " is" : "s are"} on this page and are not described here`,
          }),
        }),
        ...(lines.length && { lines }),
        ...(unnamedImages && { imagesNotInThisProject: unnamedImages }),
        ...(clipped && {
          clippedNote:
            "a picture marked clipped runs over the page edge and is drawn cut off there — that is an overflow rather than a crop, so say it is hanging off the page rather than describing what is left of it",
        }),
        ...(loose.length && { looseInSlot: loose, looseInSlotNote: LOOSE_IN_SLOT_NOTE }),
        status: page
          ? `read only — nothing on the board changed. This is page “${page.name}” alone, so positions are reading order on that page and a picture on another page of this board is not in this list`
          : "read only — nothing on the board changed. Positions are reading order, so 'the third one' is position 3",
      },
      attachments: [boardShown({ board, elements, thumbUrlOf, pageId: page?.id })],
    };
  }

  async function addBoard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const said = typeof args.title === "string" ? args.title : "";
    const title = composedBoardTitle(said);

    const size = pagePresetSize(args.preset) ?? PAGE_PRESETS.LANDSCAPE_HD;

    const added = addPage({
      elements: [],
      defaultSize: size,
      sourcePageId: null,
      name: typeof args.pageName === "string" ? args.pageName : null,
    });

    const created = await db.moodboard.create({
      data: {
        projectId,
        title,
        widthPx: size.width,
        heightPx: size.height,
        ...sceneWrite(added.elements),
      },
      select: BOARD_ROW_SELECT,
    });
    fileBoard(created);

    const pages = pagesInReadingOrder(boardPages(added.elements));

    return {
      result: {
        boardId: created.id,
        title: created.title,
        page: pageSized(added.page, pages),
        status:
          "done as a write — no model call was made and nothing was decided. The board is filed and its first page is empty: call design_page with this boardId and pageId and the user's own words to put something on it, in this same turn",
      },
      attachments: [
        boardShown({ board: created, elements: added.elements, thumbUrlOf: () => undefined }),
      ],
    };
  }

  async function addBoardPage(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: {
            id: true,
            title: true,
            revision: true,
            elements: true,
            layout: true,
            layoutSlots: true,
            widthPx: true,
            heightPx: true,
          },
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(board.elements);
    const standing = pagesInReadingOrder(boardPages(elements));
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    if (asked && !pageById(standing, asked)) {
      return {
        result: {
          error: `no page called ${asked} on that board`,
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote:
                  "that board has no pages on it — call this again without a pageId and its first one is drawn around what it already holds",
              }),
        },
      };
    }

    const added = addPage({
      elements,
      defaultSize: { width: board.widthPx, height: board.heightPx },
      sourcePageId: asked || null,
      name: typeof args.name === "string" ? args.name : null,
    });

    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...sceneWrite(added.elements),
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was adding a page to it — the user has it open, so tell them and ask again",
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const pages = pagesInReadingOrder(boardPages(added.elements));

    return {
      result: {
        boardId: board.id,
        title: board.title,
        page: pageSized(added.page, pages),

        ...(added.adopted
          ? {
              drawnAround: added.adopted,
              drawnAroundNote:
                "the page was drawn around pictures the board already held, so they are on it now exactly where the user left them — nothing was moved, laid out or resized",
            }
          : {}),
        ...(added.sections
          ? {
              sectionsOnIt: added.sections,
              sectionsNote:
                "the user had drawn sections (plain frames) on this board and the page landed over them — their pictures read as on the page, since a page holds whatever sits inside it, but they still belong to their section and move with it. Say the page is drawn around their sections rather than that it took them over, and offer to work a section at a time only by asking them to make it a page on the canvas",
            }
          : {}),
        status: added.adopted
          ? `done as a scene edit — no model call was made. That board is now ${pages.length} page${pages.length === 1 ? "" : "s"}, and the pictures it held are on this one where they were`
          : `done as a scene edit — no model call was made. The page is empty and beside what the board already had, which is untouched: that board is now ${pages.length} page${pages.length === 1 ? "" : "s"}. Compose onto it by naming this pageId, or tell the user to drag pictures onto it`,
      },
      attachments: [
        boardShown({ board, elements: added.elements, thumbUrlOf: (id) => byId.get(id)?.thumbUrl }),
      ],
    };
  }

  async function copyBoard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const source = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: {
            id: true,
            title: true,
            widthPx: true,
            heightPx: true,
            layout: true,
            layoutSlots: true,
            elements: true,
            appState: true,
            revision: true,
            renderUri: true,
            renderRevision: true,
          },
        })
      : null;
    if (!source) return { result: { error: `no board called ${boardId} in this project` } };

    const elements = persistableElements(source.elements);

    const asked = typeof args.title === "string" ? normalizedBoardTitle(args.title) : null;
    const title = asked ?? duplicateBoardTitle(await boards(), source.title);

    const copy = await db.moodboard.create({
      data: {
        projectId,
        title,
        widthPx: source.widthPx,
        heightPx: source.heightPx,
        layout: source.layout,
        ...(source.layoutSlots !== null && {
          layoutSlots: source.layoutSlots as Prisma.InputJsonValue,
        }),
        ...sceneWrite(elements),
        appState: persistedAppState(source.appState) as Prisma.InputJsonValue,
      },
      select: BOARD_ROW_SELECT,
    });
    fileBoard(copy);

    if (boardRenderIsCurrent(source)) {
      try {
        const renderUri = await copyRender(source.id, copy.id);
        await db.moodboard.update({
          where: { id: copy.id },
          data: { renderUri, renderRevision: 0 },
        });
      } catch (cause) {
        console.error(`board ${copy.id} copied without its picture:`, cause);
      }
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const { pictures, lines } = boardContents(elements);

    return {
      result: {
        boardId: copy.id,
        title: copy.title,
        copyOf: source.id,
        pictures: pictures.length,
        ...(lines.length && { lines }),
        pageSize: `${source.widthPx}×${source.heightPx}`,
        ...boardPagesSaid(
          elements,
          "the copy holds those pages, page for page — pass one of them with this copy's boardId when you change it, because a page id only names a page on the board it is on and the board it was copied from carries the same ids",
        ),
        ...(source.layout && { composedAs: source.layout }),
        status:
          "done as a copy — this is a new board holding exactly what that one holds, and nothing on the board it was copied from changed. Make the change they asked for on this copy, by its id, and tell them the original is still there",
      },
      attachments: [
        boardShown({
          board: {
            ...copy,
            widthPx: source.widthPx,
            heightPx: source.heightPx,
            layout: source.layout,
            layoutSlots: source.layoutSlots,
          },
          elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        }),
      ],
    };
  }

  async function offerDiscard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: {
            id: true,
            title: true,
            widthPx: true,
            heightPx: true,
            elements: true,
            layout: true,
            layoutSlots: true,
          },
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const elements = persistableElements(board.elements);
    const { pictures, lines } = boardContents(elements);

    return {
      result: {
        boardId: board.id,
        title: board.title,
        pictures: pictures.length,
        ...(lines.length && { lines }),
        pageSize: `${board.widthPx}×${board.heightPx}`,
        ...boardPagesSaid(
          elements,
          "that board is those pages — the discard takes all of them, so name what they would be losing page by page rather than as one pile of photographs",
        ),
        ...(board.layout && { composedAs: board.layout }),
        status:
          "offered, not done — nothing has been deleted and that board is still in the project. The user has a Discard button beside your reply and it is theirs to press. Say what is on the board they would lose, that the photographs on it stay in the gallery, and that it cannot be undone; never say the board is gone, deleted or removed",
      },
      attachments: [
        boardShown({ board, elements, thumbUrlOf: (id) => byId.get(id)?.thumbUrl, discard: true }),
      ],
    };
  }

  async function offerReferenceDiscard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const referenceId = typeof args.referenceId === "string" ? args.referenceId.trim() : "";
    const { all } = await references();
    const named = all.find((reference) => reference.id === referenceId);
    if (!named) return { result: { error: `no reference called ${referenceId} in this project` } };

    const cuts = versionDescendants(
      all
        .filter((reference) => reference.source)
        .map((reference) => ({ id: reference.id, sourceReferenceId: reference.source!.id })),
      named.id,
    );
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    const standing = (await boards()).length
      ? removalUsage(
          referenceUsageIndex(
            boardReferenceUsage(
              await db.moodboard.findMany({
                where: { projectId },
                orderBy: { updatedAt: "desc" },
                select: { id: true, title: true, elements: true },
              }),
            ),
          ),
          named.id,
          cuts,
        )
      : { own: [] as UsingBoard[], viaVersions: [] as UsingBoard[] };

    const gapBoards = [...standing.own, ...standing.viaVersions];
    return {
      result: {
        referenceId: named.id,
        title: named.title,
        ...(named.source && {
          cutOf: `${named.source.id} — this is a cut, and the ${pictureNoun(named.origin)} it was cut from stays in the gallery`,
        }),
        ...(cuts.length && {
          cutsThatWouldGoWithIt: cuts.map((id) => ({
            id,
            title: byId.get(id)?.title ?? "",
          })),
        }),
        ...(standing.own.length && { onBoards: standing.own }),
        ...(standing.viaVersions.length && { boardsShowingItsCuts: standing.viaVersions }),
        ...(gapBoards.length && {
          gap: "removing it leaves a hole in those boards — an element with nothing behind it — so say so, and offer to put another picture in its place with design_page afterwards",
        }),
        ...(gapBoards.some((board) => board.pages) && {
          pages:
            "a board listed with pages is a spread and the pages named under it are the ones the picture is on — say which page the user would lose it from rather than naming the board alone, and pass that pageId to design_page",
        }),
        status:
          "offered, not done — nothing has been deleted and that picture is still in the project. The user has a Remove button beside your reply and it is theirs to press. Say what would go with it and that it cannot be undone; never say the picture is gone, deleted or removed",
      },
      attachments: [attachmentOf(named, { cuts: cuts.length, boards: gapBoards })],
    };
  }

  async function makeMoodboard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { all, frames } = await references();
    const intention = typeof args.intention === "string" ? args.intention : "";

    const askedLayoutImage =
      typeof args.layoutImageId === "string" ? args.layoutImageId.trim() : "";
    if (askedLayoutImage && typeof args.layout === "string" && args.layout.trim()) {
      return {
        result: {
          error: `pick one — layoutImageId reads the page off ${askedLayoutImage} and layout ${args.layout.trim()} names a template instead of it, so a call carrying both says nothing about which page they asked for. Drop whichever they did not mean and call again`,
        },
      };
    }
    const layoutImage = askedLayoutImage ? (frames.get(askedLayoutImage) ?? null) : null;
    if (askedLayoutImage && !layoutImage) {
      return {
        result: {
          error: `no picture called ${askedLayoutImage} in this project — layoutImageId is the reference id of a picture of the page itself, with placeholder boxes drawn on it`,
        },
      };
    }
    const requestedIds = asStringArray(args.referenceIds).filter((id) => id !== layoutImage?.id);
    const addedIds = asStringArray(args.addReferenceIds).filter((id) => id !== layoutImage?.id);

    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const existing = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: {
            id: true,
            title: true,
            revision: true,
            elements: true,
            layout: true,
            layoutSlots: true,
            widthPx: true,
            heightPx: true,
          },
        })
      : null;
    if (boardId && !existing) {
      return { result: { error: `no board called ${boardId} in this project` } };
    }

    const named = typeof args.title === "string" && args.title.trim() ? args.title : "";
    const pageNamed = typeof args.pageName === "string" ? args.pageName.trim() : "";

    const onBoard = existing ? persistableElements(existing.elements) : [];
    const items = boardItems(onBoard);

    const pages = pagesInReadingOrder(boardPages(onBoard));
    const askedPage = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const asNewPage = args.newPage === true;
    if ((askedPage || asNewPage) && !existing) {
      return {
        result: {
          error: askedPage
            ? "a page is part of a board — pass the boardId of the board that page is on"
            : "a new page is added to a board — pass the boardId of the board to add it to, or leave both out and the board filed opens as its own first page",
        },
      };
    }
    const target = asNewPage ? null : askedPage ? pageById(pages, askedPage) : (pages[0] ?? null);
    if (askedPage && !pageById(pages, askedPage)) {
      return {
        result: {
          error: `no page called ${askedPage} on that board`,
          ...(pages.length
            ? { pages: pageDigests(onBoard) }
            : {
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so compose it without a pageId",
              }),
        },
      };
    }

    if (
      existing &&
      renamesOnly({
        title: named,
        pageName: pageNamed,
        newPage: args.newPage,
        referenceIds: requestedIds,
        addReferenceIds: addedIds,
        removeReferenceIds: asStringArray(args.removeReferenceIds),
        captions: asStringArray(args.captions),
        addCaptions: asStringArray(args.addCaptions),
        removeCaptions: asStringArray(args.removeCaptions),
        layout: args.layout,
        layoutImageId: args.layoutImageId,
      })
    ) {
      if (pageNamed && !target) {
        return {
          result: {
            error:
              "that board has no pages on it, so there is nothing on it to name — call add_page to draw its first page around what it already holds, then name that",
          },
        };
      }

      const title = named ? composedBoardTitle(named) : existing.title;
      const titleChanged = title !== existing.title;
      const renamed = target && pageNamed ? renamePage(onBoard, target.id, pageNamed) : null;
      const pageChanged = !!renamed && target!.name !== pageNamed;

      if (pageChanged) {
        const written = await db.moodboard.updateMany({
          where: { id: existing.id, revision: existing.revision },
          data: {
            ...(titleChanged && { title }),
            ...sceneWrite(renamed),
            revision: { increment: 1 },
            renderRevision: null,
          },
        });
        if (written.count === 0) {
          return {
            result: {
              error:
                "that board was changed while I was renaming it — the user has it open, so tell them and ask again",
            },
          };
        }
      } else if (titleChanged) {
        await db.moodboard.update({ where: { id: existing.id }, data: { title } });
      }

      const byId = new Map(all.map((reference) => [reference.id, reference]));
      const after = pageChanged ? renamed! : onBoard;
      return {
        result: {
          boardId: existing.id,
          title,
          ...(pageChanged && { page: { pageId: target!.id, name: pageNamed } }),
          status:
            pageChanged || titleChanged
              ? `${renamedSaid({ title: titleChanged ? title : "", page: pageChanged ? pageNamed : "" })} — no model call was made, nothing on the board moved and it was not laid out again${pageChanged && pages.length > 1 ? ", and the board's other pages are untouched" : ""}. If they also asked for it rearranged, call design_page for that board`
              : pageNamed
                ? `${pageSaid(target!)} is already called that, so nothing changed`
                : "that board is already called that, so nothing changed",
        },
        attachments: [
          boardShown({
            board: { ...existing, title },
            elements: after,
            thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
            ...(pageChanged && { pageId: target!.id }),
          }),
        ],
      };
    }

    const onPage = asNewPage
      ? []
      : target
        ? pageLocalItems(itemsOnPage(items, pages, target), target)
        : items;

    const contentsOnly =
      !!existing &&
      !asNewPage &&
      changesContentsOnly({
        referenceIds: requestedIds,
        addReferenceIds: addedIds,
        removeReferenceIds: asStringArray(args.removeReferenceIds),
        captions: asStringArray(args.captions),
        addCaptions: asStringArray(args.addCaptions),
        removeCaptions: asStringArray(args.removeCaptions),
        layout: args.layout,
        layoutImageId: args.layoutImageId,
      });

    if (
      existing &&
      contentsOnly &&
      (!standsAsComposed(onPage, layoutForPage(boardLayout(existing), target)) ||
        (!asNewPage && pageCarriesShapes(onBoard, pages, target)))
    ) {
      return await editInPlace({
        board: existing,
        elements: onBoard,
        args,
        named,
        page: target,
        pages,
      });
    }

    const held = target ? pageContents(onBoard, target) : null;
    const startsEmpty = !existing || asNewPage;

    const edit = boardSelection({
      onBoard: startsEmpty
        ? []
        : (held?.pictures.map((picture) => picture.referenceId) ?? sceneReferenceIds(onBoard)),
      requested: requestedIds,
      add: addedIds,
      remove: asStringArray(args.removeReferenceIds),
    });
    const selection = edit.selection;
    if (!selection.length) {
      return {
        result: {
          error: edit.removed.length
            ? "that would take every picture off the board — say so rather than leaving them with an empty one"
            : asNewPage
              ? "a new page starts empty — name the references to put on it"
              : existing
                ? "that board has no pictures on it — name the references to put on it"
                : "name the references to put on the board",
        },
      };
    }

    const { found, missing } = pickReferences(all, selection, COMPOSE_BLOCK_LIMIT);
    if (found.length === 0) {
      return {
        result: {
          error: "none of those reference ids are in this project",
          ...(missing.length && { notFound: missing }),
        },
      };
    }

    const text = lineSelection({
      onBoard: startsEmpty ? [] : (held?.lines ?? boardContents(onBoard).lines),
      requested: asStringArray(args.captions),
      add: asStringArray(args.addCaptions),
      remove: asStringArray(args.removeCaptions),
    });

    const blocks = layoutBlocks(found, text.lines);

    let customLayout: MoodboardLayout | null = null;
    if (layoutImage) {
      const read = await db.agentRun.create({
        data: {
          projectId,
          agent: AgentKind.LAYOUT_READER,
          status: RunStatus.RUNNING,
          input: {
            referenceId: layoutImage.id,
            intention,
            ...(existing && { rebuilds: existing.id }),
            ...(target && { onPage: target.id }),
            ...(asNewPage && { onNewPage: true }),
          },
        },
        select: { id: true },
      });

      let page;
      try {
        page = await readPage({
          gcsUri: layoutImage.gcsUri,
          image: { width: layoutImage.width, height: layoutImage.height },
          ...(intention && { intention }),
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        await db.agentRun.update({
          where: { id: read.id },
          data: {
            status: RunStatus.FAILED,
            error: message,
            finishedAt: new Date(),
            ...spentThrown(cause),
          },
        });
        return { result: { error: message } };
      }

      await db.agentRun.update({
        where: { id: read.id },
        data: {
          status: RunStatus.SUCCEEDED,
          output: {
            model: page.model,
            attempts: page.attempts,
            slots: page.layout.slots.map((slot) => slot.id),
            composition: page.composition,
            page: page.layout.page,
          },
          finishedAt: new Date(),
          ...spentColumns(page.model, page.usage),
        },
      });
      customLayout = page.layout;
    }

    const { layout: composedAt, reason: layoutReason } = customLayout
      ? { layout: customLayout, reason: "requested" as const }
      : layoutForBoard({
          stored: boardLayout(existing),
          requested: args.layout,
          blocks,
        });
    const layout = layoutForPage(composedAt, asNewPage ? null : target);
    const storedNamed =
      existing?.layout === CUSTOM_LAYOUT ? "the page they handed in as an image" : existing?.layout;

    const offered = new Set(blocks.map((block) => block.id));
    const notOffered = [...new Set(selection)].filter(
      (id) => !offered.has(id) && !missing.includes(id),
    );
    const overflowLines = linesNotOffered(text.lines, blocks);
    const homelessLines = linesWithNoSlot(blocks, layout);
    const notReadYet = found
      .filter((reference) => reference.unread && offered.has(reference.id))
      .map((reference) => reference.id);

    const digests = new Map(found.map((reference) => [reference.id, referenceDigest(reference)]));
    const briefOf = (block: LayoutBlock) => {
      const digest = digests.get(block.id);
      return blockBrief({
        ...block,
        ...(digest && {
          shape: digest.shape,
          keeps: digest.keeps,
          tags: digest.tags,
          favorite: digest.favorite,
        }),
      });
    };

    const freshPageName = asNewPage ? pageNamed || nextPageName(pages) : null;
    const targetName = target ? pageNamed || target.name : "";
    const composingPage =
      freshPageName !== null
        ? pageBrief({
            name: freshPageName,
            ordinal: pages.length + 1,
            of: pages.length + 1,
            board: existing?.title,
            fresh: true,
          })
        : target && pages.length > 1
          ? pageBrief({
              name: targetName,
              ordinal: pages.findIndex((page) => page.id === target.id) + 1,
              of: pages.length,
              board: existing?.title,
            })
          : null;

    const seats =
      existing && contentsOnly && layoutReason === "kept" && standsAsComposed(onPage, layout)
        ? keptSeats({ items: onPage, layout, blocks })
        : null;

    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const thumbUrlOf = (id: string) => byId.get(id)?.thumbUrl;

    if (existing && seats && !seats.joining.length && !edit.removed.length && !text.removed.length) {
      return {
        result: {
          boardId: existing.id,
          title: existing.title,
          layout: layout.id,
          status: overflowLines.length
            ? "nothing changed — the board was not laid out again and no model call was made, and the lines below did not go on it"
            : "nothing changed — everything named was already on that board, so it was not laid out again and no model call was made",
          ...(overflowLines.length && {
            linesNotOffered: overflowLines,
            linesNotOfferedNote: LINES_NOT_OFFERED_NOTE,
          }),
          ...(edit.alreadyOn.length && { alreadyOnBoard: edit.alreadyOn }),
          ...(edit.notOnBoard.length && { notOnBoard: edit.notOnBoard }),
          ...(text.alreadyOn.length && { linesAlreadyOn: text.alreadyOn }),
          ...(text.notOnBoard.length && {
            linesNotOnBoard: text.notOnBoard,
            linesNotOnBoardNote: LINE_NOT_ON_BOARD_NOTE,
          }),
          ...(missing.length && { notFound: missing }),
        },
        attachments: [boardShown({ board: existing, elements: onBoard, thumbUrlOf })],
      };
    }

    const asking = seats ? seats.joining : blocks;
    const run = !seats || seats.joining.length
      ? await db.agentRun.create({
          data: {
            projectId,
            agent: AgentKind.COMPOSITOR,
            status: RunStatus.RUNNING,
            input: {
              layout: layout.id,
              intention,
              blocks: asking.map((block) => block.id),
              ...(existing && { rebuilds: existing.id }),
              ...(target && { onPage: target.id }),
              ...(asNewPage && { onNewPage: true }),
              ...(seats && { keptTheirSlots: seats.kept.length }),
            },
          },
          select: { id: true },
        })
      : null;

    let spent: ReturnType<typeof spentColumns> | null = null;
    let note = "";
    let plan: SeatedPlan;

    if (!run) {
      plan = {
        placed: seats?.kept ?? [],
        unknownBlocks: [],
        unknownSlots: [],
        unplaced: [],
        mismatched: [],
        seated: [],
      };
    } else {
      let answer;
      try {
        answer = await compose({
          layout: seats ? { ...layout, slots: seats.free } : layout,
          intention,
          blocks: asking.map(briefOf),
          ...(composingPage && { page: composingPage }),
          ...(seats && {
            inPlace: seats.kept.map(({ slot, block }) => ({ slotId: slot.id, ...briefOf(block) })),
          }),
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        await db.agentRun.update({
          where: { id: run.id },
          data: { status: RunStatus.FAILED, error: message, finishedAt: new Date() },
        });
        return { result: { error: message } };
      }

      spent = spentColumns(answer.model, answer.usage);
      note = answer.note;
      const answered = planAssignments(
        seats ? { ...layout, slots: seats.free } : layout,
        answer.assignments,
        asking,
      );
      const merged: AssignmentPlan = seats
        ? { ...answered, placed: [...seats.kept, ...answered.placed] }
        : answered;
      plan = seatUnplaced(layout, merged, blocks);
      if (plan.placed.length === 0) {
        const message = "the compositor placed nothing on the board";
        await db.agentRun.update({
          where: { id: run.id },
          data: { status: RunStatus.FAILED, error: message, finishedAt: new Date(), ...spent },
        });
        return { result: { error: message } };
      }
    }

    const placed = seats ? inSlotOrder(layout, plan.placed) : plan.placed;

    const fresh = freshPageName !== null
      ? {
          box: newPageBox({
            pages,
            sourcePageId: askedPage || null,
            size: layout.page,
            occupied: items,
          }),
          name: freshPageName,
        }
      : null;
    const setsBoardDefault = !asNewPage && (!pages.length || target?.id === pages[0]?.id);

    const at = fresh?.box ?? target;
    const drawn = composedScene(placed, {
      ...(at && { origin: { x: at.x, y: at.y } }),
      page: {
        ...layout.page,
        ...(target && { id: target.id, name: targetName }),
        ...(fresh && { name: fresh.name }),
      },
    });
    const behind = target ? pageBackgroundElement(onBoard, pages, target) : null;
    const pageDrawn = behind ? [{ ...behind, frameId: target!.id }, ...drawn] : drawn;
    const elements = fresh
      ? [...onBoard, ...drawn]
      : target
        ? [...sceneOffPage(onBoard, target, pages), ...pageDrawn]
        : drawn;
    const composedPage = boardPages(drawn)[0] ?? null;
    const title = named
      ? composedBoardTitle(named)
      : existing
        ? existing.title
        : composedBoardTitle(intention);

    let board: { id: string; title: string };
    if (existing) {
      const written = await db.moodboard.updateMany({
        where: { id: existing.id, revision: existing.revision },
        data: {
          title,
          ...(setsBoardDefault && {
            layout: layout.id,
            widthPx: layout.page.width,
            heightPx: layout.page.height,
            layoutSlots: layoutSlotsWritten(layout),
          }),
          ...sceneWrite(elements),
          revision: { increment: 1 },
          renderRevision: null,
        },
      });
      if (written.count === 0) {
        const message =
          "that board was changed while I was composing it — the user has it open, so tell them and ask again";
        if (run) {
          await db.agentRun.update({
            where: { id: run.id },
            data: { status: RunStatus.FAILED, error: message, finishedAt: new Date(), ...spent },
          });
        }
        return { result: { error: message } };
      }
      board = { id: existing.id, title };
    } else {
      const created = await db.moodboard.create({
        data: {
          projectId,
          title,
          layout: layout.id,
          widthPx: layout.page.width,
          heightPx: layout.page.height,
          ...(layout.id === CUSTOM_LAYOUT && { layoutSlots: layoutSlotsWritten(layout) }),
          ...sceneWrite(elements),
        },
        select: BOARD_ROW_SELECT,
      });
      fileBoard(created);
      board = created;
    }

    const opening = layout.slots
      .filter((slot) => slot.kind === "image")
      .map((slot) => placed.find((placement) => placement.slot.id === slot.id))
      .find(Boolean);
    const cover = found.find((reference) => reference.id === opening?.block.id);
    const images = placed.filter((placement) => placement.slot.kind === "image").length;

    const loose = looseFits(placed);

    if (run) {
      await db.agentRun.update({
        where: { id: run.id },
        data: {
          status: RunStatus.SUCCEEDED,
          output: {
            boardId: board.id,
            layout: layout.id,
            layoutFrom: layoutReason,
            placed: placed.length,
            unplaced: plan.unplaced,
            ...(plan.seated.length && { seated: plan.seated }),
            ...(existing && { rebuilt: true }),
            ...(seats && { keptTheirSlots: seats.kept.length }),
          },
          finishedAt: new Date(),
          ...spent,
        },
      });
    }

    return {
      result: {
        boardId: board.id,
        title: board.title,
        layout: layout.id,
        ...(customLayout && {
          layoutRead: `not a template — that page was read off ${layoutImage!.id}, the picture they handed in: ${customLayout.composition}`,
        }),
        ...(composedPage && {
          page: { pageId: composedPage.id, name: composedPage.name },
        }),
        ...(layoutReason === "outgrew" &&
          existing && {
            layoutChanged: fresh
              ? `that board's pages are ${storedNamed}, which could not hold ${blocks.length} blocks, so the new page is a ${layout.id} — tell the user it is a different shape from the rest`
              :
                target && layout !== composedAt
                ? `that board's pages are ${storedNamed}, which could not hold ${blocks.length} blocks, so “${target.name}” was laid out as a ${layout.id} — tell the user the arrangement changed, not the page: it is still ${target.width}×${target.height}, the size they made it`
                :
                target && pages.length > 1 && !setsBoardDefault
                ? `that board's pages are ${storedNamed}, which could not hold ${blocks.length} blocks, so “${target.name}” was laid out as a ${layout.id} — tell the user that page is now a different shape from the rest`
                : `that board was laid out as ${storedNamed} and could not hold ${blocks.length} blocks, so it was laid out as ${layout.id} — tell the user its shape changed`,
          }),
        status: !existing
          ? "filed as a new board"
          :
            fresh
            ? `added to that board as a new page, “${fresh.name}”, beside what was already on it — nothing already on the board moved and no picture came off it${pages.length ? `, so the board is ${pages.length + 1} pages now` : ""}`
            : seats
            ? `${seats.joining.length ? "placed what joined it" : "taken off in place"} — the other ${seats.kept.length} kept their slots and nothing else on that board moved${run ? "" : ", and no model call was made"}`
            :
              target && pages.length > 1
              ? `laid out again on “${target.name}” — that page now holds this arrangement instead of what was on it, and the board's other ${pages.length - 1} ${pages.length === 2 ? "page is" : "pages are"} untouched`
              : "rebuilt in place — that board now holds this arrangement instead of what was on it, so say so",
        ...(seats && { keptTheirSlots: seats.kept.length }),
        placed: placed.map(({ slot, block }) => ({ slotId: slot.id, blockId: block.id })),
        ...(plan.unplaced.length && { unplaced: plan.unplaced }),
        ...(plan.seated.length && { seatedWhereThereWasRoom: plan.seated }),
        ...(plan.unknownBlocks.length && { unknownBlocks: plan.unknownBlocks }),
        ...(plan.unknownSlots.length && { unknownSlots: plan.unknownSlots }),
        ...(plan.mismatched.length && { mismatched: plan.mismatched }),
        ...(notOffered.length && { notOffered }),
        ...(notReadYet.length && { notReadYet, notReadYetNote: NOT_READ_YET_NOTE }),
        ...(overflowLines.length && {
          linesNotOffered: overflowLines,
          linesNotOfferedNote: LINES_NOT_OFFERED_NOTE,
        }),
        ...(homelessLines.length && {
          linesWithNoRoom: homelessLines,
          linesWithNoRoomNote: linesWithNoSlotNote(layout),
        }),
        ...(missing.length && { notFound: missing }),
        ...(edit.added.length && { added: edit.added }),
        ...(edit.removed.length && { removed: edit.removed }),
        ...(edit.notOnBoard.length && { notOnBoard: edit.notOnBoard }),
        ...(edit.alreadyOn.length && { alreadyOnBoard: edit.alreadyOn }),
        ...(text.added.length && { linesAdded: text.added }),
        ...(text.removed.length && { linesRemoved: text.removed }),
        ...(text.notOnBoard.length && {
          linesNotOnBoard: text.notOnBoard,
          linesNotOnBoardNote: LINE_NOT_ON_BOARD_NOTE,
        }),
        ...(text.alreadyOn.length && { linesAlreadyOn: text.alreadyOn }),
        ...(loose.length && { looseInSlot: loose, looseInSlotNote: LOOSE_IN_SLOT_NOTE }),
        ...(note && { note }),
      },
      attachments: [
        boardAttachmentOf({
          id: board.id,
          title: board.title,
          layout: layout.id,
          ...(composedPage && { onPage: pageShown(elements, composedPage) }),
          images,
          lines: placed
            .filter((placement) => placement.slot.kind === "text")
            .map((placement) => placement.block.text ?? ""),
          thumbUrl: cover?.thumbUrl ?? null,
          preview: boardPreview(placed, layout.page, (id) =>
            found.find((reference) => reference.id === id)?.thumbUrl,
          ),
        }),
      ],
    };
  }

  async function editInPlace({
    board,
    elements,
    args,
    named,
    page = null,
    pages = [],
  }: {
    board: { id: string; title: string; revision: number; layout: string | null; widthPx: number; heightPx: number };
    elements: readonly SceneElement[];
    args: Record<string, unknown>;
    named: string;
    page?: BoardPage | null;
    pages?: readonly BoardPage[];
  }): Promise<ToolOutcome> {
    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    const asked = [
      ...new Set(asStringArray(args.addReferenceIds).map((id) => id.trim()).filter(Boolean)),
    ];
    const notFound = asked.filter((id) => !byId.has(id));

    const room = page ?? { x: 0, y: 0, width: board.widthPx, height: board.heightPx };
    const add = asked.filter((id) => byId.has(id));
    const remove = asStringArray(args.removeReferenceIds);
    const sizeOf = (id: string) => byId.get(id);
    const edit = page
      ? placeOnPage({ elements, pages, page, add, remove, sizeOf })
      : placeOnBoard({ elements, page: room, add, remove, sizeOf });

    const addCaptions = asStringArray(args.addCaptions);
    const removeCaptions = asStringArray(args.removeCaptions);
    const text = page
      ? placeLinesOnPage({
          elements: edit.elements,
          pages,
          page,
          add: addCaptions,
          remove: removeCaptions,
        })
      : placeLinesOnBoard({
          elements: edit.elements,
          page: room,
          add: addCaptions,
          remove: removeCaptions,
        });

    const renaming = typeof args.pageName === "string" ? args.pageName.trim() : "";
    const renamed =
      page && renaming && page.name !== renaming
        ? renamePage(text.elements, page.id, renaming)
        : null;
    const stands = renamed ?? text.elements;
    const pageAfter = renamed && page ? { ...page, name: renaming } : page;

    const changed =
      edit.added.length ||
      edit.removed.length ||
      text.added.length ||
      text.removed.length ||
      !!renamed;
    if (!changed) {
      return {
        result: {
          error: page ? `nothing on ${pageSaid(page)} changed` : "nothing on that board changed",
          ...(notFound.length && { notInThisProject: notFound }),
          ...(edit.notOnBoard.length && {
            notOnBoard: edit.notOnBoard,
            ...(page && { notOnBoardNote: NOT_ON_PAGE_NOTE }),
          }),
          ...(edit.alreadyOn.length && { alreadyOnBoard: edit.alreadyOn }),
          ...(text.notOnBoard.length && {
            linesNotOnBoard: text.notOnBoard,
            linesNotOnBoardNote: LINE_NOT_ON_BOARD_NOTE,
          }),
          ...(text.alreadyOn.length && { linesAlreadyOn: text.alreadyOn }),
        },
      };
    }

    const leftOn = page
      ? pageContents(stands, page).pictures.length
      : sceneReferenceIds(stands).length;
    if (!leftOn) {
      return {
        result: {
          error: page
            ? `that would take every picture off ${pageSaid(page)} — say so rather than leaving them with an empty page`
            : "that would take every picture off the board — say so rather than leaving them with an empty one",
        },
      };
    }

    const title = named ? composedBoardTitle(named) : board.title;
    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        ...(title !== board.title && { title }),
        ...sceneWrite(stands),
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

    return {
      result: {
        boardId: board.id,
        title,
        ...(pageAfter && { page: { pageId: pageAfter.id, name: pageAfter.name } }),
        ...(edit.added.length && { added: edit.added }),
        ...(edit.removed.length && { removed: edit.removed }),
        ...(text.added.length && { linesAdded: text.added }),
        ...(text.removed.length && { linesRemoved: text.removed }),
        status: pageAfter
          ? `done as a scene edit on ${pageSaid(pageAfter)} — that page is arranged by hand rather than by a template, so nothing already on it moved and it was not laid out again. A picture put on it went in under what was already there and a line went above it, both kept inside the page${pages.length > 1 ? `, and the board's other ${pages.length - 1} ${pages.length === 2 ? "page is" : "pages are"} untouched` : ""}. If they wanted that page arranged rather than added to, call design_page for it with that pageId`
          : "done as a scene edit — that board is arranged by hand rather than by a template, so nothing already on it moved and it was not laid out again. A picture put on it went in under what was already there and a line went above it. If they wanted the page arranged rather than added to, call design_page for it",
        ...(notFound.length && { notInThisProject: notFound }),
        ...(edit.notOnBoard.length && {
          notOnBoard: edit.notOnBoard,
          ...(page && { notOnBoardNote: NOT_ON_PAGE_NOTE }),
        }),
        ...(edit.alreadyOn.length && { alreadyOnBoard: edit.alreadyOn }),
        ...(text.notOnBoard.length && {
          linesNotOnBoard: text.notOnBoard,
          linesNotOnBoardNote: LINE_NOT_ON_BOARD_NOTE,
        }),
        ...(text.alreadyOn.length && { linesAlreadyOn: text.alreadyOn }),
      },
      attachments: [
        boardShown({
          board: { ...board, title },
          elements: stands,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
          pageId: page?.id,
        }),
      ],
    };
  }

  async function paintBoardCanvas(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: { id: true, title: true, revision: true, elements: true, appState: true },
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const edit = setCanvasBackground({ appState: board.appState, colour: args.colour });

    if (!edit) {
      return {
        result: {
          error: `${typeof args.colour === "string" && args.colour.trim() ? `“${args.colour.trim()}”` : "that"} is not a colour — give a hex like #0c111c, or "${CANVAS_BACKGROUND_DEFAULT}" to put the board back on the white it was made on`,
        },
      };
    }

    const elements = persistableElements(board.elements);
    const standing = pagesInReadingOrder(boardPages(elements));
    const grounded = standing.filter(
      (page) => pageBackgroundColour(elements, page) !== null,
    ).length;
    const pagesSaid =
      standing.length === 0
        ? ""
        : grounded === standing.length
          ? standing.length === 1
            ? ", and its one page stands on a colour of its own, so this shows around that page rather than on it"
            : `, and all ${standing.length} of its pages stand on colours of their own, so this shows around them rather than on them`
          : grounded > 0
            ? `, and ${grounded} of its ${standing.length} pages stand on a colour of their own, so this is what the other ${standing.length - grounded} are drawn on`
            : `, and this is what ${standing.length === 1 ? "its one page is" : `all ${standing.length} of its pages are`} drawn on, none of them having a colour of their own`;

    if (!edit.appState) {
      return {
        result: {
          boardId: board.id,
          title: board.title,
          background: edit.colour,
          status: edit.colour
            ? `nothing changed — that board is already drawn on ${edit.colour}${pagesSaid}. Tell the user it is the colour they asked for rather than that it was repainted`
            : `nothing changed — that board is already on the white it was made on${pagesSaid}`,
        },
      };
    }

    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        appState: edit.appState as Prisma.InputJsonValue,
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was painting it — the user has it open, so tell them and ask again",
        },
      };
    }

    return {
      result: {
        boardId: board.id,
        title: board.title,
        background: edit.colour,
        ...(edit.was && { was: edit.was }),
        status: edit.colour
          ? `done as a board edit — no model call was made. That board is drawn on ${edit.colour} now and nothing on it moved${pagesSaid}`
          : `done as a board edit — no model call was made. That board is back on the white it was made on and nothing on it moved${pagesSaid}`,
      },
    };
  }

  async function makeDesign(args: Record<string, unknown>): Promise<ToolOutcome> {
    const pageId = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const imageIds = asStringArray(args.imageIds);
    const outcome = await design({
      db,
      projectId,
      boardId: typeof args.boardId === "string" ? args.boardId.trim() : "",
      ...(pageId && { pageId }),
      intention: typeof args.intention === "string" ? args.intention : "",
      ...(imageIds.length && { imageIds }),
      ...(args.newPage === true && { newPage: true }),
      budget: { generations: pictures, crops },
    });

    if ("error" in outcome) return { result: { error: outcome.error } };

    const { board, elements } = outcome.scene;
    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    return {
      result: {
        boardId: outcome.boardId,
        boardTitle: outcome.boardTitle,
        ...(outcome.pageId && { pageId: outcome.pageId }),
        line: outcome.line,
        designed: outcome.calls,
        ...outcome.report,
        ...(outcome.report.notPlaced?.length && {
          notPlacedNote:
            "pictures you named that are not on the page — the designer chooses for itself and leaving one off is a decision rather than a failure, so say the page is without them rather than that they were lost",
        }),
        ...(outcome.report.looseOnBoard?.length && {
          looseOnBoardNote:
            "pictures on that board sitting on no page at all — read the board with inspect_board before you describe them, since they are not part of the page that was designed",
        }),
        ...(outcome.report.made && {
          madeNote:
            "pictures the design drew or cut for this page rather than finding them in the gallery — a drawn picture is the one thing in the gallery the user cannot tell by looking, so say it was made",
        }),
        ...(outcome.notFound?.length && {
          notFound: outcome.notFound,
          notFoundNote:
            "ids you named that this project has not got — the design went ahead with the rest of the gallery, so do not write about those pictures as though they are on the page",
        }),
        ...(outcome.stopped === "rounds" && {
          stopped: "rounds",
          stoppedNote:
            "the design ran out of rounds before it had finished — the page is written as far as it got, so the report above is what really landed rather than what was intended",
        }),
      },
      attachments: [
        boardShown({
          board,
          elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
          pageId: outcome.pageId ?? null,
        }),
      ],
    };
  }

  async function projectState(): Promise<ProjectState> {
    const [{ all, photos }, filed] = await Promise.all([references(), boards()]);
    return {
      photographs: photos.length,
      crops: all.length - photos.length,
      boards: filed.length,
      generated: all.filter((reference) => isGeneratedOrigin(reference.origin)).length,
    };
  }

  return {
    state: projectState,

    async declarations() {
      return orchestratorTools(await projectState());
    },

    async brief() {
      const [{ all, photos }, filed, named] = await Promise.all([
        references(),
        boards(),
        project(),
      ]);

      return [
        named ? projectBrief(named) : "",
        catalogBrief(photos, { crops: all.length - photos.length }),
        currentBoardBrief(
          filed.map(boardDigest).find((board) => board.id === currentBoardId) ?? null,
          filed.length,
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
    },

    async attachedPages(attached) {
      const asked = attached.slice(0, PAGES_PER_MESSAGE);
      if (!asked.length) return { parts: [], pages: [] };

      const [{ all }, filed] = await Promise.all([
        references(),
        db.moodboard.findMany({
          where: { id: { in: [...new Set(asked.map((page) => page.boardId))] }, projectId },
          select: {
            id: true,
            title: true,
            revision: true,
            layout: true,
            layoutSlots: true,
            elements: true,
          },
        }),
      ]);
      const byBoard = new Map(filed.map((board) => [board.id, board]));

      const parts: GeneratePart[] = [];
      const pages: AttachedPageParts["pages"] = [];
      for (const attachment of asked) {
        const board = byBoard.get(attachment.boardId);
        if (!board) continue;

        const elements = persistableElements(board.elements);
        const inOrder = pagesInReadingOrder(boardPages(elements));
        const page = pageById(inOrder, attachment.pageId);
        if (!page) continue;

        const render =
          attachment.renderUri &&
          board.revision === attachment.revision &&
          attachment.renderUri === pageRender(board.id, page.id, attachment.revision)
            ? attachment.renderUri
            : null;
        const rendered = render !== null;

        if (render) {
          parts.push({ fileData: { fileUri: render, mimeType: BOARD_RENDER_CONTENT_TYPE } });
        }

        const items = boardItems(elements, { shapes: true });
        const layout = boardLayout(board);

        parts.push({
          text: pageBriefText(
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
              rendered,
            },
            all,
          ),
        });
        pages.push({ boardId: board.id, pageId: page.id, name: page.name, rendered });
      }

      return { parts, pages };
    },

    async execute({ name, args }) {
      const { all, photos } = await references();

      switch (name) {
        case LIST_REFERENCES.name: {
          const catalog = referenceCatalog(args.includeCrops === false ? photos : all);
          const unread = catalog.references.some((digest) => digest.unread);
          return { result: { ...catalog, ...(unread && { unreadNote: UNREAD_CATALOG_NOTE }) } };
        }

        case SHOW_REFERENCES.name: {
          const { found, missing, overLimit } = pickReferences(
            all,
            asStringArray(args.referenceIds),
          );
          return {
            result: {
              shown: found.map((reference) => reference.id),
              ...(missing.length && { notFound: missing }),
              ...(overLimit.length && {
                notShown: overLimit,
                notShownNote: `only ${SHOWN_LIMIT} pictures go in one reply — these were not put in front of the user, so do not write about them as though they are there`,
              }),
            },
            attachments: found.map((reference) => attachmentOf(reference)),
          };
        }

        case READ_REFERENCES.name:
          return readPictures(args);

        case EDIT_REFERENCE.name:
          return boardEdits.run(boardKey(args), () => makeCrop(args));

        case GENERATE_IMAGE.name:
          return makePicture(args);

        case LIST_BOARDS.name:
          return listBoards();

        case GET_BOARD_BRIEF.name:
          return getBoardBrief(args);

        case INSPECT_BOARD.name:
          return inspectBoard(args);

        case DISCARD_BOARD.name:
          return offerDiscard(args);

        case DISCARD_PAGE.name:
          return asShown(await pages.offerBoardPageDiscard(args));

        case DISCARD_REFERENCE.name:
          return offerReferenceDiscard(args);

        case DUPLICATE_BOARD.name:
          return boardEdits.run(boardKey(args), () => copyBoard(args));

        case ADD_BOARD.name:
          return addBoard(args);

        case ADD_PAGE.name:
          return boardEdits.run(boardKey(args), () => addBoardPage(args));

        case DUPLICATE_PAGE.name:
          return asShown(
            await boardEdits.run(boardKey(args), () => pages.duplicateBoardPage(args)),
          );

        case RESIZE_PAGE.name:
          return asShown(await boardEdits.run(boardKey(args), () => pages.resizeBoardPage(args)));

        case SET_PAGE_BACKGROUND.name:
          return asShown(
            await boardEdits.run(boardKey(args), () => pages.setBoardPageBackground(args)),
          );

        case SET_CANVAS_BACKGROUND.name:
          return boardEdits.run(boardKey(args), () => paintBoardCanvas(args));

        case SWAP_ON_BOARD.name:
          return asShown(await boardEdits.run(boardKey(args), () => boardEditor.swapPictures(args)));

        case REWORD_ON_BOARD.name:
          return asShown(await boardEdits.run(boardKey(args), () => boardEditor.rewordLines(args)));

        case MOVE_TO_PAGE.name:
          return asShown(await boardEdits.run(boardKey(args), () => pages.moveToBoardPage(args)));

        case READ_CANVAS.name:
          return asShown(await canvas.readCanvas(args));

        case PUT_ON_CANVAS.name:
          return asShown(await boardEdits.run(boardKey(args), () => canvas.putOnCanvas(args)));

        case REMOVE_FROM_CANVAS.name:
          return asShown(await boardEdits.run(boardKey(args), () => canvas.removeFromCanvas(args)));

        case TRANSFORM_ON_CANVAS.name:
          return asShown(
            await boardEdits.run(boardKey(args), () => canvas.transformOnCanvas(args)),
          );

        case REORDER_ON_CANVAS.name:
          return asShown(await boardEdits.run(boardKey(args), () => canvas.reorderOnCanvas(args)));

        case RESTYLE_ON_CANVAS.name:
          return asShown(await boardEdits.run(boardKey(args), () => canvas.restyleOnCanvas(args)));

        case COMPOSE_MOODBOARD.name:
          return boardEdits.run(boardKey(args), () => makeMoodboard(args));

        case DESIGN_PAGE.name:
          return boardEdits.run(boardKey(args), () => makeDesign(args));

        default:
          return { result: { error: `no tool called ${name}` } };
      }
    },
  };
}

function wholeBoard(elements: readonly SceneElement[]) {
  const { pictures, lines, unnamedImages } = boardContents(elements);
  return {
    pictures: pictures.map((referenceId) => ({ referenceId, clipped: false })),
    background: null,
    lines,
    unnamedImages,
  };
}

function boardPagesSaid(elements: readonly SceneElement[], note: string) {
  const pages = pageDigests(elements);
  return pages.length > 1 ? { pages, pagesNote: note } : {};
}

function renamedSaid({ title, page }: { title: string; page: string }) {
  if (title && page) return `renamed — the board is now “${title}” and its page “${page}”`;
  return page ? `that page is now called “${page}”` : "renamed";
}

function asStringArray(value: unknown) {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function layoutSlotsWritten(layout: MoodboardLayout) {
  return layout.id === CUSTOM_LAYOUT
    ? (customLayoutColumns(layout) as Prisma.InputJsonValue)
    : Prisma.DbNull;
}

function inSlotOrder(layout: MoodboardLayout, placements: readonly Placement[]): Placement[] {
  const order = new Map(layout.slots.map((slot, index) => [slot.id, index]));
  return [...placements].sort(
    (a, b) => (order.get(a.slot.id) ?? 0) - (order.get(b.slot.id) ?? 0),
  );
}
