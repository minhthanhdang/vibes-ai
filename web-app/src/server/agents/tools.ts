import "server-only";
import {
  ADD_PAGE,
  CANVAS_PUT_LIMIT,
  CANVAS_REMOVE_LIMIT,
  CANVAS_REORDER_LIMIT,
  CANVAS_TRANSFORM_LIMIT,
  COMPOSE_MOODBOARD,
  CROP_CALL_LIMIT,
  CROP_REFERENCE,
  DISCARD_BOARD,
  DISCARD_PAGE,
  DISCARD_REFERENCE,
  DUPLICATE_BOARD,
  DUPLICATE_PAGE,
  GENERATE_CALL_LIMIT,
  GENERATE_IMAGE,
  INSPECT_BOARD,
  LIST_REFERENCES,
  MOVE_LIMIT,
  MOVE_TO_PAGE,
  PUT_ON_CANVAS,
  READ_CANVAS,
  READ_LIMIT,
  READ_REFERENCES,
  REMOVE_FROM_CANVAS,
  REORDER_ON_CANVAS,
  RESIZE_PAGE,
  REWORD_LIMIT,
  REWORD_ON_BOARD,
  SHOWN_LIMIT,
  SHOW_REFERENCES,
  SWAP_LIMIT,
  SWAP_ON_BOARD,
  TRANSFORM_ON_CANVAS,
  UNREAD_CATALOG_NOTE,
  UNREAD_MARK,
  attachmentOf,
  boardAttachmentOf,
  boardsBrief,
  catalogBrief,
  directorBrief,
  cropCeilingSaid,
  drawnFrom,
  generationCeilingSaid,
  orchestratorTools,
  pickReferences,
  referenceCatalog,
  referenceDigest,
  referenceProperties,
  unreadReason,
  type ProjectState,
  type ReferenceProperties,
  type ToolDeclaration,
  type ToolOutcome,
  type ToolReference,
} from "@/lib/agent/agent-tools";
import {
  boardsStandingOn,
  cropNudge,
  cropOffer,
  cropOfferCaption,
  cropOfferShape,
  standingOnNote,
  unfittableAspect,
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
  CROP_ASPECT_IDS,
  LOOSE_SHAPE_IDS,
  cropBoxOf,
  cropShapeOf,
  looseShapeOf,
  shapeAsked,
  versionDescendants,
} from "@/lib/references/reference-version";
import { generatedImageTitle, pngPixelSize } from "@/lib/references/generated-image";
import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import { hashBytes } from "@/lib/intake/content-hash";
import { fileVersion } from "@/server/references/file-version";
import type { Cut } from "@/server/references/cut";
import { isUploadContentType, type UploadContentType } from "@/lib/intake/image-types";
import { enqueueAnalysis } from "@/server/agents/analysis-enqueue";
import { storeProjectUpload } from "@/server/references/upload";
import { isObjectTooLarge } from "@/server/google/storage";
import { cropReference } from "@/server/agents/cropper";
import { generateImage } from "@/server/agents/image-generator";
import { readLayout } from "@/server/agents/layout-reader";
import { type GeneratePart } from "@/server/google/vertex";
import { spentColumns, spentThrown } from "@/lib/agent/model-cost";
import { AgentKind, ReferenceOrigin, RunStatus } from "@/generated/prisma/enums";
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
  PAGE_PRESET_IDS,
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
import { analyzerJob } from "@/lib/analysis/analyzer-queue";
import type { AnalysisRunStatus } from "@/lib/analysis/analysis-view";
import { keyedQueue } from "@/lib/util/keyed-queue";
import {
  LOOSE_IN_SLOT_NOTE,
  looseFits,
  nearestCropAspect,
  standsAsComposed,
} from "@/lib/layout/slot-fit";
import { boardContents, boardItems } from "@/lib/boards/board-contents";
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
import { addPage } from "@/lib/pages/page-add";
import { pageDuplication } from "@/lib/pages/page-duplicate";
import { pageRemoval } from "@/lib/pages/page-remove";
import { resizePage } from "@/lib/pages/page-resize";
import { moveToPage } from "@/lib/pages/page-move";
import { pageContents, pageDigests, picturesOffPages } from "@/lib/pages/page-contents";
import { pageBlocks } from "@/lib/pages/page-blocks";
import { PAGES_PER_MESSAGE, pageBriefText } from "@/lib/pages/page-brief";
import {
  layoutForPage,
  newPageBox,
  pageBackgroundElement,
  pageLocalItems,
  sceneOffPage,
} from "@/lib/pages/page-compose";
import { pagedLooseFits, pagedSlotShape, pageStandsAsComposed } from "@/lib/pages/page-fit";
import { placeLinesOnPage, placeOnPage } from "@/lib/pages/page-place";
import type { BoardPage } from "@/lib/pages/board-pages";
import { swapOnBoard, type SwapRequest } from "@/lib/boards/board-swap";
import { canvasObjects } from "@/lib/canvas-objects/object-read";
import { transformObjects, type TransformChange } from "@/lib/canvas-objects/object-transform";
import { reorderObjects, type ReorderMove } from "@/lib/canvas-objects/object-reorder";
import { putObjects, type PutRequest } from "@/lib/canvas-objects/object-put";
import { removeObjects } from "@/lib/canvas-objects/object-remove";
import { rewordOnBoard, type RewordRequest } from "@/lib/boards/board-text";
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
import { blockBrief, composeMoodboard, pageBrief } from "@/server/agents/compositor";
import { forDisplay } from "@/server/references/display";
/// A value import for the sake of `Prisma.DbNull`: a nullable Json column is
/// cleared with that sentinel and not with `null`, which Prisma reads as the Json
/// value `null` rather than as an empty column.
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

/// The seam agents 2-5 hang off: a toolset is a set of declarations to hand the
/// model and the one function that runs whatever it calls.
///
/// Assembled per request, closed over the project it is allowed to touch. That
/// is the whole access control story — a tool cannot be talked into reading
/// another user's project, because the id it reads is not an argument the
/// model can write.
export type Toolset = {
  /// The tools this project can use, not every tool that exists — and a function
  /// rather than an array because the answer changes inside a turn: the round
  /// that files the first board is the round after which a board can be read or
  /// swapped on. Off the same reads as `brief`, so asking costs nothing.
  declarations: () => Promise<ToolDeclaration[]>;
  /// The three counts both the declarations and the instruction are gated on.
  state: () => Promise<ProjectState>;
  execute: (call: { name: string; args: Record<string, unknown> }) => Promise<ToolOutcome>;
  /// What is in the project, as text to prime the turn with. Off the same read
  /// the tools use, so priming a turn and then calling a tool in it is still one
  /// question to the database — and the list the model was handed is the list
  /// its ids are resolved against.
  brief: () => Promise<string>;
  /// The pages the *user* attached to this message, as the parts they are
  /// read as (§V.4–5). Here rather than beside the turn because it is the same
  /// two questions the tools answer — which board is this project's, and what are
  /// its pictures — and asking them anywhere else would be a second reference
  /// read on a turn that already paid for one.
  attachedPages: (pages: readonly AttachedPage[]) => Promise<AttachedPageParts>;
};

/// A page the user picked in the chat, as the message carries it (§V.5).
/// Every field is client input and none of it is trusted: the board is re-read
/// against the project, the page against the board's own scene, and the uri
/// against the one this server would have signed for that upload.
export type AttachedPage = {
  boardId: string;
  pageId: string;
  /// What the board stood at when the picture was taken. A revision that has
  /// moved means the picture is of a page that no longer exists.
  revision: number;
  renderUri?: string | null;
};

export type AttachedPageParts = {
  /// Prepended to the user's own words, in the order they were picked: the
  /// picture of a page and then the page in words, per page.
  parts: GeneratePart[];
  /// What was actually attached, for the turn's row — a page whose board is not
  /// this project's, or whose id names no page on it, is not in here.
  pages: { boardId: string; pageId: string; name: string; rendered: boolean }[];
};

/// The columns a tool reads off a reference. Analysis rides along because the
/// tags are the vocabulary the pipeline talks in — without them the catalog is a
/// list of filenames and the model has nothing to reason with.
const TOOL_REFERENCE_SELECT = {
  id: true,
  title: true,
  width: true,
  height: true,
  editIntent: true,
  editAspect: true,
  /// Four integers, read only when the model asks for a *cut* to be changed:
  /// that ask is a nudge of this box rather than a crop of the cut, and the box
  /// is the one thing the nudge cannot be made without.
  cropBox: true,
  /// The star. One boolean, and it is the only column here the *user* wrote —
  /// everything else was read off the pixels or typed by the uploader. It also
  /// decides `GALLERY_ORDER`, so without it the model is handed a list whose
  /// ordering encodes a fact it cannot see.
  isFavorite: true,
  /// Which of these pictures the assistant drew itself, which is the one thing
  /// about a reference that is true of it before the analyzer has read it and
  /// that no tag will ever say.
  origin: true,
  /// What a drawn picture was asked for, in the words it was asked in. Read by
  /// `read_references` alone — it is a sentence rather than a mark, so it is
  /// worth its tokens on the one picture the user is asking about and not on
  /// every catalog line. It is also the only thing anywhere that says what a
  /// picture drawn a minute ago is *of*: the conversation the model is handed
  /// carries no tool calls, so its own description is gone by the next turn.
  generationPrompt: true,
  gcsUri: true,
  thumbGcsUri: true,
  source: { select: { id: true, title: true } },
  analysis: {
    select: {
      /// Agent 2's name for the picture, which `referenceDigest` prefers over
      /// the row's own title — that one is the uploaded filename.
      title: true,
      colorPalette: true,
      lighting: true,
      texture: true,
      composition: true,
      subject: true,
      contrastDepth: true,
      /// Read for `read_references` alone. No digest carries it — a paragraph per
      /// picture on twenty-four primed lines is the catalog several times over —
      /// and that tool is the one door in the layer that answers about a single
      /// picture, where the paragraph is the answer.
      rationale: true,
    },
  },
} as const;

/// The bucket paths are dropped here rather than at the edge. A model that has
/// been handed a `gs://` uri in JSON will put it in a sentence, and a sentence
/// with a bucket path in it is what the signed-URL indirection exists to
/// prevent. An agent that has to *look* at a picture gets the uri as a file
/// part, from code, never from the conversation.
function toolReferences(
  rows: readonly ReferenceRow[],
  unread: ReadonlyMap<string, ReturnType<typeof unreadReason>>,
): ToolReference[] {
  return rows.map(({ gcsUri, thumbGcsUri, isFavorite, ...reference }) => ({
    ...reference,
    /// Renamed at the edge, like the uri is stripped at it: the column is
    /// `isFavorite` and what the model reads is `starred`, and the one word it is
    /// carried under downstream is `favorite`.
    favorite: isFavorite,
    thumbUrl: forDisplay({ id: reference.id, gcsUri, thumbGcsUri }).thumbUrl,
    ...(unread.get(reference.id) && { unread: unread.get(reference.id) }),
  }));
}

/// What a board composed out of unread pictures is, said to the model rather
/// than left for it to infer from an absence. The board is real and worth
/// keeping — a picture with no tags still has a shape, and shape is most of a
/// layout — so this is a caveat on the reply, not a refusal.
const NOT_READ_YET_NOTE =
  "the property analyzer has not read these yet, so they were arranged on shape alone and not on their look — tell the user the board can be laid out again once the tags land, and do not describe what these pictures are of";

/// Why a picture the board plainly carries can still come back as one the edit
/// could not take off. A page-scoped edit reads a page and not the board (§V), so
/// the ambiguity is real and only the answer can resolve it — without this the
/// model reports a photograph as gone from the project rather than as sitting on
/// a page the call was not about.
const NOT_ON_PAGE_NOTE =
  "read against that page alone — a picture on another page of the board, or loose on its canvas beside the pages, is not on this one. Read the board with inspect_board to see which page holds it";

/// Why an id a canvas edit named can match nothing: the handles are element
/// ids from `read_canvas`, and the id the model reaches for instead is the
/// referenceId it knows the picture by — which names a photograph, not a place
/// on the board, and the same photo placed twice is two objects.
const NOT_A_HANDLE_NOTE =
  "no object with that id on this board — every handle comes from read_canvas, and a referenceId is not one: the same photo placed twice is two objects";

/// How to read a page's boxes. Without it the numbers are four integers per
/// picture and the model reads them as pixels, in x-first order, on a canvas of
/// unknown size — every one of which is wrong. The format is §V.4's own, which is
/// the format the crop rows are already stored in, so this sentence is a reminder
/// rather than a new dialect.
const ARRANGEMENT_NOTE =
  "where each block sits on the page: box is [ymin, xmin, ymax, xmax], y first, as thousandths of the page rather than pixels — so 0 is the top or left edge, 1000 the bottom or right, and a block from 0 to 500 across fills the left half. z is stacking order with 0 at the back, which is what says which of two overlapping pictures is on top. Read positions off these when the user says 'the one on the left', 'above it' or 'the big one'";

/// How many analyzer runs one read looks back over. A run per re-analysis
/// accumulates, and only the newest per reference is read; past this a picture
/// with no `Analysis` row reads as one nobody ever offered to agent 2, which is
/// the same wrong answer the blank line used to give and no worse.
const ANALYZER_RUN_LIMIT = 500;

/// Why each unread picture is unread, for the pictures that have no analysis.
///
/// A second query, and it is the only one in this file that a turn can be spared
/// entirely: a project agent 2 has finished with has nothing to explain, so the
/// read is gated on there being a blank line to explain in the first place. The
/// commonest turn — a user talking about pictures uploaded yesterday — pays
/// nothing for it.
async function unreadReasons(
  db: PrismaClient,
  projectId: string,
  rows: readonly ReferenceRow[],
) {
  const blank = rows.filter((row) => !row.analysis);
  const reasons = new Map<string, ReturnType<typeof unreadReason>>();
  if (!blank.length) return reasons;

  const runs = await db.agentRun.findMany({
    where: { projectId, agent: AgentKind.ANALYZER },
    orderBy: { startedAt: "desc" },
    take: ANALYZER_RUN_LIMIT,
    select: { input: true, status: true },
  });

  /// Newest first, so the first row naming a reference is that reference's
  /// latest run — `AgentRun` has no reference column and the id only comes out
  /// of the `input` Json the queue wrote.
  const latest = new Map<string, AnalysisRunStatus>();
  for (const { input, status } of runs) {
    const job = analyzerJob(input);
    if (!job || latest.has(job.referenceId)) continue;
    latest.set(job.referenceId, status);
  }

  for (const row of blank) {
    const status = latest.get(row.id);
    const reason = unreadReason(status ? { status } : null);
    if (reason) reasons.set(row.id, reason);
  }
  return reasons;
}

type BoardRow = {
  id: string;
  title: string;
  widthPx: number;
  heightPx: number;
  layout: string | null;
  /// Derived from the scene by every write to it (`sceneWrite`), so the priming
  /// can say a board is a spread without reading megabytes of elements to
  /// count its frames.
  pageCount: number;
  /// Those pages' names in reading order, derived by the same write — what the
  /// user calls a page is what they will ask for it by.
  pageNames: string[];
};

/// The columns `BoardRow` is made of, shared by the turn's read of the table and
/// by the writes that file a board into it: a board created with fewer columns
/// in hand cannot be folded into the read the turn was built on.
const BOARD_ROW_SELECT = {
  id: true,
  title: true,
  widthPx: true,
  heightPx: true,
  layout: true,
  pageCount: true,
  pageNames: true,
} as const;

type ReferenceRow = {
  id: string;
  title: string;
  width: number | null;
  height: number | null;
  editIntent: string;
  editAspect: string;
  isFavorite: boolean;
  /// Where the bytes came from, read because a cut inherits it: a piece of a
  /// picture the assistant drew was not shot by the user either.
  origin: ReferenceOrigin;
  gcsUri: string;
  thumbGcsUri: string | null;
  source: { id: string; title: string } | null;
  analysis: {
    title: string;
    colorPalette: string[];
    lighting: string[];
    texture: string[];
    composition: string[];
    subject: string[];
    contrastDepth: string[];
    rationale: string;
  } | null;
};

/// Gallery order, matching what the user is looking at while they talk: a
/// model answering "the second one" and a user counting tiles have to be
/// counting the same list.
const GALLERY_ORDER = [{ isFavorite: "desc" }, { createdAt: "desc" }] as const;

/// The pictures of one project, as the tools see them.
///
/// Read once per turn rather than per tool call: `list_references` and
/// `show_references` are two questions about the same set, and the second one
/// resolving ids against a list the first never saw is how a model ends up being
/// told a reference it was just given does not exist.
export function referenceToolset({
  db,
  projectId,
  /// Agent 4, injected. It is the one thing in this file that costs a model
  /// call, and the only reason a test of the tool layer would have to reach
  /// Vertex — so the seam is here rather than in the import.
  compose = composeMoodboard,
  /// Agent 3, injected for the same reason. It is the one tool here that reads a
  /// *photograph*, so it is also the one whose cost a test must never pay.
  crop = cropReference,
  /// The layout reader, injected on the same terms as the other two: it is a
  /// vision call over a whole page, so it is the most expensive thing a compose
  /// can pay for and the last one a test of this file should reach.
  readPage = readLayout,
  /// Agent 6, injected like the rest — and the only one of them whose answer is
  /// bytes rather than words, which is why the two things done with those bytes
  /// are injected beside it.
  generate = generateImage,
  /// Where a made picture's bytes go. Injected for `copyRender`'s reason: it is
  /// GCS, it reads the environment to name the object, and a test has neither.
  storeImage = (contentType: UploadContentType, bytes: Uint8Array) =>
    storeProjectUpload(projectId, contentType, bytes),
  /// The pixels, cut on the server. Injected on `kickAnalyzer`'s terms rather
  /// than `crop`'s: reaching it means loading `sharp`, and a test of this file
  /// exercises the filing path without ever wanting a codec in its module graph.
  /// The default therefore imports it only when a cut is actually made.
  cutRegion = async (gcsUri: string, region: CropRegion) => {
    const { cutFromOriginal } = await import("@/server/references/cut");
    return cutFromOriginal(gcsUri, region);
  },
  /// The analyzer's wake-up. Injected rather than imported because reaching it
  /// means reaching `analysis-queue`, which binds the real database and the real
  /// vision model at import time — a test of this file would open a connection
  /// pool to file a job it already has a client for. The job itself is filed
  /// through `enqueueAnalysis`, in the same transaction as the row.
  kickAnalyzer = () => {
    void import("@/server/agents/analysis-queue").then(({ kickAnalyzerWorker }) =>
      kickAnalyzerWorker(),
    );
  },
  /// The bucket copy a duplicated board's picture is inherited by, injected for
  /// the plainer reason that it is the other thing in this file that touches GCS
  /// — and it reads the environment to name the object, which a test has none of.
  /// Answers with the copy's `gs://` uri.
  copyRender = async (sourceBoardId: string, targetBoardId: string) => {
    await copyBoardRender(projectId, sourceBoardId, targetBoardId);
    return boardRenderGcsUri(projectId, targetBoardId);
  },
  /// Where the picture of an attached page would have been put, injected for the
  /// same reason: it names a bucket, and the uri the browser sends back is only
  /// believed when it matches the one this says.
  pageRender = (boardId: string, pageId: string, revision: number) =>
    pageRenderGcsUri(projectId, boardId, pageId, revision),
}: {
  db: PrismaClient;
  projectId: string;
  compose?: typeof composeMoodboard;
  crop?: typeof cropReference;
  readPage?: typeof readLayout;
  generate?: typeof generateImage;
  storeImage?: (contentType: UploadContentType, bytes: Uint8Array) => Promise<string>;
  cutRegion?: (gcsUri: string, region: CropRegion) => Promise<Cut>;
  kickAnalyzer?: () => void;
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
          /// The rows as they came out of the database, bucket paths and all.
          /// Kept beside the model's copy rather than in it: an agent that has to
          /// *look* at a picture is handed its uri as a file part, from code, and
          /// the only way to keep that true is for the uri never to be in the
          /// shape the model reads.
          frames: new Map(rows.map((row) => [row.id, row])),
        };
      });
    return loaded;
  }

  /// A picture filed this turn, folded into the read the turn was built on.
  ///
  /// The references are read once and memoized — that is what makes a turn one
  /// query — so a row filed halfway through it is invisible to every tool that
  /// runs after it. The id `generate_image` just answered with would come back
  /// "no reference called that" from `put_on_canvas` on the next round, which is
  /// the round the declaration promises it can be placed on. Appended rather
  /// than re-read for the reason the filed boards are counted rather than
  /// re-read: the row is already in hand, and a second query buys latency only.
  ///
  /// `crop_reference` is the second caller, and it files a *version* — so the
  /// fold splits the list rather than growing it in one direction: `photos` is
  /// recomputed off `source` so a cut is counted as a cut in the state the next
  /// round is primed with and stays out of the catalog a compose reads, and the
  /// row goes into `frames` as well, which is where a nudge of that cut reads the
  /// frame it was cut out of.
  ///
  /// Chained onto the promise rather than computed off its value, because two
  /// generations in one round run side by side — and the second one building its
  /// list from the list the first started with would drop the first. A round of
  /// two crops is what tells the two implementations apart; a turn that files
  /// them one after another reads the same either way.
  function filePicture(row: ReferenceRow): ToolReference {
    const [picture] = toolReferences(
      [row],
      new Map([[row.id, unreadReason({ status: RunStatus.QUEUED })]]),
    );
    const made = picture!;
    loaded = (loaded ?? references()).then(({ all, frames }) => {
      /// Where the gallery puts it: `GALLERY_ORDER` is the stars first and the
      /// newest of the rest under them, and this is the newest of the rest.
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

  /// The project's boards, in the few small columns a brief names them by —
  /// never `elements`, which is megabytes a turn that never mentions a board
  /// would pay for, and which is why the page count is a column of its own. Read lazily and once, like the references, because both the
  /// brief and the declarations ask the same question of it.
  let boardRows: Promise<BoardRow[]> | null = null;

  function boards() {
    boardRows ??= db.moodboard.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: BOARD_ROW_SELECT,
    });
    return boardRows;
  }

  /// A board filed this turn, folded into the read the turn was built on — the
  /// same fold `filePicture` does, and for the same reason twice over.
  ///
  /// The brief and the declarations ask this one read the same question, and the
  /// instruction is now resolved per round beside them: a board counted into the
  /// state but not into the list means the next round is told how to read and
  /// swap on a board the catalog it is handed has never heard of. It is also
  /// what names the second copy of a board made in one turn, which would
  /// otherwise be named against a list that has never heard of the first.
  ///
  /// Prepended, because the read is newest-first and this is the newest. Chained
  /// onto the promise rather than computed off its value, because two composes
  /// in one round run side by side.
  function fileBoard(row: BoardRow) {
    boardRows = boards().then((rows) => [row, ...rows]);
  }

  /// What the user called this project and what they wrote it was for. Two
  /// short columns off a primary key, read lazily and once — and asked for
  /// alongside the other two reads rather than after them, so priming a turn is
  /// still one round trip's worth of latency. Nothing but `brief()` wants it: no
  /// tool takes the project as an argument, because the project is the closure.
  let projectRow: Promise<{ title: string; brief: string } | null> | null = null;

  function project() {
    projectRow ??= db.project.findUnique({
      where: { id: projectId },
      select: { title: true, brief: true },
    });
    return projectRow;
  }

  /// Vision calls spent this turn. The counter is per toolset, and a toolset is
  /// per request, so this bounds one exchange rather than one round — a model
  /// given three rounds could otherwise ask for the same crop in each of them.
  let cropsAsked = 0;

  /// How many of those reached the catalog as a row. The ceiling is on the
  /// calls — a refused read costs the same photograph — but the sentence
  /// refusing the next one is about what the user can be asked to choose
  /// between, which is `picturesFiled`'s reason one tool over.
  let cropsFiled = 0;

  /// Pictures asked for this turn, counted on the same terms and for the same
  /// reason: a generation is the most expensive call in the product, and a user
  /// who asked for a backdrop is looking at one picture rather than at four
  /// tries. Counted before the call, so a model call that fails still spends its
  /// place — the second attempt at a description the image model refused is the
  /// same money as the first.
  let picturesAsked = 0;

  /// How many of those reached the catalog. The ceiling is on the calls, but the
  /// sentence refusing the next one is about the project, and the two numbers
  /// come apart on exactly the turn where the wording matters most.
  let picturesFiled = 0;

  /// One edit at a time per board, for the length of this turn.
  ///
  /// Every write below is a read, a decision and a revision-guarded write, and
  /// the orchestrator runs a round's tool calls with `Promise.all` — so "swap
  /// those two around and fix the typo in the headline" ran both edits against
  /// the same revision, landed one of them, and answered the other with "that
  /// board was changed while I was editing it — the user has it open". The
  /// user had done nothing; the turn had collided with itself, and the edit
  /// it lost was one they had asked for.
  ///
  /// Keyed by board rather than serialising the round, because the calls worth
  /// running side by side are the expensive ones: two crops are two vision calls
  /// with nothing between them. And the revision guard stays where it is — it is
  /// for the tab this cannot see, and it only says something true once the turn
  /// has stopped generating conflicts of its own.
  const boardEdits = keyedQueue();

  /// The board a call is about, as a queue key. Absent for a compose that files
  /// a new board, which contends with nothing.
  const boardKey = (args: Record<string, unknown>) =>
    typeof args.boardId === "string" ? args.boardId.trim() : "";

  /// The whole of what agent 2 wrote about a named picture, off the rows it
  /// already wrote. Not a call to agent 2: nothing here reads a photograph.
  ///
  /// It used to be the door to a *reading* — a job filed with the analyzer's
  /// queue and a worker woken — which made it the one tool that answered "I have
  /// asked" rather than the question it was called about. What it answers now is
  /// the question, and the reason it is worth a round beside `list_references` is
  /// the half of an analysis no digest carries: `digestTags` flattens the five
  /// dimensions into one list and drops the palette and the rationale outright
  /// (six hex codes on twenty-four primed lines is a quarter of the catalog spent
  /// on something a model cannot see). That argument holds for a list of every
  /// picture and not for the one picture the user is asking about, and this is
  /// the only door to those two fields anywhere in the layer.
  async function readPictures(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { all } = await references();
    const asked = asStringArray(args.referenceIds);
    if (!asked.length) {
      return { result: { error: "name the pictures whose properties you want, by their ids" } };
    }

    const { found, missing, overLimit } = pickReferences(all, asked, READ_LIMIT);

    const read: ReferenceProperties[] = [];
    /// Excluded from the answer rather than described in it: every field would
    /// come back empty, and an empty palette beside an empty rationale reads as a
    /// picture with no colour in it — the blank that the unread marks exist to
    /// stop being read as a fact. Named all the same, because an id the model
    /// asked about and got nothing back for is §I's silence.
    /// One exception to the blank, and it is the picture this door is least use
    /// on otherwise: a drawing filed this turn has no analysis for minutes, and
    /// the description it was made from is on its row the whole time. Saying it
    /// here is not describing a picture nobody has read — it is quoting the ask
    /// that produced it, which is the one thing about it that is certain.
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
        /// Said once for the answer rather than beside each line, and only where
        /// there is a drawn picture in it: what the field is, and the two things
        /// it is for — describing a picture the analyzer has not reached, and
        /// being the text a variant of it is asked from.
        ...(anyDrawn && {
          drawnFromNote:
            "a “drawn from” is the description this assistant drew that picture at — what was asked for rather than what a reader saw, so it is what to vary when the user wants another like it, and the only account of a drawing the analyzer has not reached yet.",
        }),
        ...(missing.length && { notFound: missing }),
        /// The ceiling is per call and a second call costs a query, so the note
        /// asks for one rather than letting the reply describe pictures it was
        /// never told about.
        ...(overLimit.length && {
          notLookedUp: overLimit,
          notLookedUpNote: `only ${READ_LIMIT} pictures' properties fit in one answer — ask for these in another call rather than describing them`,
        }),
      },
      /// Nothing is attached. This is a read for the model's own reasoning, and
      /// the tool that decides what the user sees in the chat is
      /// `show_references` — a lookup that put four tiles in front of them
      /// unasked is the same overreach as a reply naming a picture it never
      /// showed, taken from the other end.
    };
  }

  /// Agent 3 as an agent-tool, ending at a row.
  ///
  /// It ended at an *offer* for as long as nothing in this tree could decode an
  /// image: the pixels were cut in the browser, on bytes read back same-origin,
  /// so the only thing the tool could hand back was four numbers and the frame
  /// they were numbers of. A server-side codec retires that. The cut is made
  /// here, filed as a version of the frame, shown in the chat as an ordinary
  /// tile, and its id is one the next round of the same turn can place.
  ///
  /// The properties panel keeps its own flow — plan, then Keep / Discard /
  /// Adjust. A user framing a crop by hand is choosing a box and wants to see it
  /// before it becomes a row; a user who asked for one in words has already said
  /// what they want, and `discard_reference` is the way back.
  async function makeCrop(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { frames } = await references();
    const referenceId = typeof args.referenceId === "string" ? args.referenceId : "";
    const named = frames.get(referenceId);
    if (!named) return { result: { error: `no reference called ${referenceId} in this project` } };

    /// Named a cut rather than a photograph. That is not a crop of a crop: the
    /// box the user wants changed is already on the frame, so this is asked
    /// of the frame with that box attached — the panel's `adjust`, reached from
    /// the chat. See `cropNudge` for why the nested cut is the wrong answer.
    const nudge = named.source ? cropNudge(named) : null;
    const frame = named.source ? frames.get(named.source.id) : named;
    if (!frame) {
      return {
        result: { error: `${referenceId} is a cut of a picture this project no longer holds` },
      };
    }
    if (named.source && !nudge) {
      return {
        result: {
          error: `${referenceId} is a cut whose region was never recorded, so there is no box to move — crop ${frame.id}, the frame it came out of`,
        },
      };
    }

    const intention = typeof args.intention === "string" ? args.intention.trim() : "";
    if (!intention) return { result: { error: "say what to crop out of this reference" } };

    /// Any ratio the user said, not one of six names. A format the list does
    /// not name is a format all the same — 5:4 for a print, 2.35:1 for that
    /// scope — and the whole path below already carries a measured label, since
    /// a cut asked for a board is held to the slot's own shape.
    ///
    /// A shape that cannot be read is refused rather than dropped: the model
    /// passed it because the user asked for it, so cutting around the
    /// subject instead would be a cut of the wrong shape under a reply that says
    /// it is the right one. Refused here, before the row and before the
    /// photograph is read, so the correction costs a sentence.
    /// And the shapes with no number in them, which the spec asks for beside the
    /// ratios: a user who says "make it a rectangle" has named a shape and
    /// not a format, so answering with the nearest format is a substitution they
    /// did not ask for. Read first because the two vocabularies do not overlap —
    /// "square" is a word and "1:1" is a ratio — so one argument carries both.
    /// A nudge inherits the shape the row was cut at when the user names
    /// none, the same rule the panel's own adjustment follows: "a little wider"
    /// about a scope crop is about where the edges of scope sit, and answering it
    /// unconstrained gives back a cut that is no longer the shape everything else
    /// on the board was cut to. A shape they *did* name wins, since naming one is
    /// asking for a different cut.
    const said = typeof args.aspect === "string" ? args.aspect.trim() : "";
    const asked = said || (nudge?.asked ?? "");
    const loose = looseShapeOf(asked);
    const shape = loose ? null : cropShapeOf(asked);
    if (asked && !loose && !shape) {
      return {
        result: {
          error: `“${asked}” is not a shape a cut can be held to — say it as width:height (${CROP_ASPECT_IDS.join(", ")}, or any ratio the user named such as 5:4), or loosely as ${LOOSE_SHAPE_IDS.join("/")}, or leave it out to frame around the subject`,
        },
      };
    }
    const aspect = shape?.label ?? null;
    /// Read before the call rather than after it: a frame with no recorded size
    /// cannot be held to a format, and asking the model first would spend a
    /// vision call to arrive at the same sentence.
    const unfittable = unfittableAspect(frame, aspect);
    if (unfittable) return { result: { error: unfittable } };

    /// The board this cut is *for*, when the crop is being made to fill a slot.
    ///
    /// It is what closes the loop in the one call: the cut is held to that
    /// slot's own shape and then put in the frame's place there, so the board is
    /// changed by the time this answers. Scoped to the project, since the id is a
    /// model argument, and read before the vision call so an unknown board costs
    /// a sentence rather than a photograph.
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

    /// Which page of that board the cut is for (§V.3). A picture can stand on two
    /// pages of one spread, in two differently shaped slots — so both halves of
    /// this call are page-scoped facts: the shape the cut is held to is that
    /// slot's, and the copy the swap takes off is that page's. Without a page
    /// both are answered by whichever copy the scene array carries first, which
    /// is a picture the user may not have been talking about.
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

    /// A cut can only take the place of a picture that is on the board. Asked for
    /// a frame that is not, the crop is still worth making — the user asked
    /// for it — so the cut is filed without the swap rather than refused, and the
    /// answer says so instead of the swap silently never happening.
    ///
    /// Which picture it replaces is the cut when the board holds the cut, and the
    /// frame when it holds the frame — a nudge is asked of the frame either way,
    /// so the two are different ids the moment the board is standing on a cut.
    ///
    /// Read against the named page alone when there is one: a frame the *board*
    /// holds a page away is not in the slot this cut is being made for, and
    /// offering the swap anyway would take it off a page nobody mentioned.
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
            /// Only when it is not the frame the cut is drawn on: the swap
            /// below takes that frame off by default, so saying it again would be
            /// the same id twice on every ordinary crop.
            ...(onBoard !== frame.id && { takeOff: onBoard }),
          }
        : null;

    /// The opening the cut is being made to fill, when there is one — and the
    /// shape the cut is therefore held to.
    ///
    /// The six named shapes are the vocabulary the *model* has, and the widest of
    /// them (2.39:1) is narrower than the widest slot any template makes
    /// (HERO_LEFT's strips, 3.52:1) — so a cut held to the nearest name leaves a
    /// third of that opening showing and the loose-fit report could not honestly
    /// offer it at all. The slot's own ratio is a fact about the scene, not a
    /// judgement, so it is read here rather than asked for: the same division
    /// that has the model say which rectangle and the code say which pixels.
    ///
    /// Refined, not overridden. An aspect the model passed is only replaced when
    /// it is the nearest name to this slot — which is exactly what the loose-fit
    /// report told it to pass — so a user who asks for a square gets a square
    /// even on a scope-shaped opening. A ratio they named themselves is never one
    /// of the names, so naming a shape the list does not carry is also how they
    /// override the opening.
    ///
    /// A frame whose pixel size was never recorded is left alone: a ratio is a
    /// ratio of pixels, so refining such a frame would turn an ask that works
    /// into the refusal `unfittableAspect` makes above — and it would make it
    /// after the photograph had been read.
    const layout =
      swapTarget && board?.layout && frame.width && frame.height ? boardLayout(board) : null;
    const opening = layout
      ? pagedSlotShape(boardItems(scene), pagesOn, layout, onBoard ?? frame.id, onPage)
      : null;
    ///
    /// A loose ask refines on the same rule read the same way: the slot replaces
    /// it when the opening is *already* the shape they asked for, so "square for
    /// the board" on a square slot is cut to that slot exactly, and "square" on a
    /// scope strip stays square. The alternative — refining every loose ask —
    /// would answer a word the user chose with a ratio they never named.
    const heldToSlot =
      opening &&
      (loose
        ? loose.holds(opening.shape.ratio)
        : !aspect || nearestCropAspect(opening.shape.ratio) === aspect)
        ? opening
        : null;
    const held = heldToSlot ? heldToSlot.shape.label : aspect;
    /// An exact shape and a loose one are never both in play below: the slot's
    /// own ratio is exact, so a refined loose ask stops being loose.
    const framed = heldToSlot ? null : loose;

    if (cropsAsked >= CROP_CALL_LIMIT) {
      return { result: { error: cropCeilingSaid(cropsAsked, cropsFiled) } };
    }
    cropsAsked += 1;

    /// The same row the panel's ask writes, for the same reason: what the
    /// cropper could not answer is readable afterwards instead of being a
    /// sentence that scrolled out of a chat.
    const run = await db.agentRun.create({
      data: {
        projectId,
        agent: AgentKind.CROPPER,
        status: RunStatus.RUNNING,
        input: {
          /// The frame that is read, which is the frame the cut will be a version
          /// of — the same key the panel's own ask writes. The cut being moved is
          /// beside it rather than in its place, so a chain of nudges over one
          /// frame reads as a chain rather than as unrelated asks.
          referenceId: frame.id,
          prompt: intention,
          ...((held ?? framed?.id) && { aspect: held ?? framed?.id }),
          ...(nudge && { previous: nudge.previous, nudgeOf: named.id }),
          via: "orchestrator",
        },
      },
      select: { id: true },
    });

    const fail = async (message: string, spent?: ReturnType<typeof spentColumns>) => {
      await db.agentRun.update({
        where: { id: run.id },
        data: { status: RunStatus.FAILED, error: message, finishedAt: new Date(), ...spent },
      });
      return { result: { error: message } };
    };

    let answer;
    try {
      answer = await crop({
        gcsUri: frame.gcsUri,
        prompt: intention,
        title: frame.title,
        ...(held && { aspect: held }),
        ...(framed && { loose: framed, frame }),
        /// The box being moved. Without it the cropper reads the frame from
        /// nothing and answers with some other shot, which is the failure the
        /// panel's `previous` was added to prevent — and here it would arrive
        /// under a reply saying the user's cut had been adjusted.
        ...(nudge && { previous: nudge.previous }),
      });
    } catch (cause) {
      /// A refusal the cropper reached on its third read is the most expensive
      /// thing in this file, so the failed row carries the tokens too — a ledger
      /// that only counts the successes is a ledger that says a bad afternoon
      /// was cheap.
      return fail(
        cause instanceof Error ? cause.message : String(cause),
        spentThrown(cause) ?? undefined,
      );
    }

    const offered = cropOffer({
      reference: frame,
      box: answer.box,
      intent: answer.intent,
      rationale: answer.rationale,
      aspect: held,
      ...(framed && { loose: framed.id }),
    });
    const spent = spentColumns(answer.model, answer.usage);
    if ("refused" in offered) return fail(offered.refused, spent);

    /// What is left of the offer: the region to take out of the frame and the
    /// columns the row is filed under. `cropOffer` still decides whether there is
    /// a cut to make at all — "the whole frame is the shot" is refused above, and
    /// it is the cropper reading the photograph correctly rather than a failure —
    /// and what changed is only what happens after it says yes.
    const cut = offered.offer;
    /// The box back in the shape a row is filed from. The plan carries the
    /// columns because that is what the browser used to be sent, and they came
    /// out of a box that was valid a line ago.
    const cropBox = cropBoxOf(cut.cropBox)!;

    let pixels: Cut;
    try {
      pixels = await cutRegion(frame.gcsUri, cut.region);
    } catch (cause) {
      /// The read of the photograph is already paid for by this point, so the
      /// row carries it — and the sentence says the cut does not exist, because
      /// a model told only "something went wrong" describes one anyway.
      console.error("a cut could not be made:", cause);
      return fail(
        /// A photograph too large to read back is told apart from every other
        /// way the codec fails, because it is the only one that will be just as
        /// true on the second call: the other two crops the ceiling allows would
        /// be spent finding that out again.
        isObjectTooLarge(cause)
          ? `the box was found but ${frame.id} is too large a file to cut here, so nothing was filed — say the photograph is too big to crop rather than describing a cut, and do not ask for a cut of it again`
          : "the box was found but the picture could not be cut, so nothing was filed — say so rather than describing a cut",
        spent,
      );
    }

    let gcsUri;
    let thumbGcsUri: string | undefined;
    try {
      gcsUri = await storeImage(pixels.contentType, pixels.bytes);
      /// Made in the same pass as the cut, so a crop filed this way lands
      /// complete — unlike a drawn picture, which leaves its row owing a
      /// grid-sized copy to the workspace's sweep.
      if (pixels.thumbnail) {
        thumbGcsUri = await storeImage(pixels.thumbnail.contentType, pixels.thumbnail.bytes);
      }
    } catch (cause) {
      console.error("a cut could not be stored:", cause);
      return fail(
        "the cut was made but could not be stored, so it is not in the project — say so rather than describing it",
        spent,
      );
    }

    /// The same digest the panel's cut stores, off bytes that were never wrapped
    /// in a `File`. It is not what stops a duplicate: both hash lookups are
    /// asked of originals only, on purpose (`existingHashes`), so nothing reads
    /// a version's. What it buys is that a cut's row records no less about its
    /// bytes for having been filed by the assistant — the same reason the row
    /// itself goes through `fileVersion`.
    const contentHash = await hashBytes(pixels.bytes);

    /// The row and its analyzer job, through the same function the properties
    /// panel files a cut with: what a cut of a frame is called and where it
    /// counts as having come from follow from the frame, and two doors deriving
    /// them apart would fill the versions list with cuts that do not match.
    let row;
    try {
      row = await db.$transaction((tx) =>
        fileVersion(
          tx,
          {
            projectId,
            source: frame,
            gcsUri,
            thumbGcsUri,
            editIntent: cut.editIntent,
            editRationale: cut.editRationale,
            cropBox,
            editAspect: cut.aspect ?? cut.loose,
            width: pixels.width,
            height: pixels.height,
            contentHash,
          },
          TOOL_REFERENCE_SELECT,
        ),
      );
    } catch (cause) {
      /// The most expensive thing in this file to lose: the photograph is read
      /// and paid for, the bytes are in the bucket, and the row that would make
      /// them a reference is not there.
      console.error("a cut could not be filed:", cause);
      return fail(
        "the cut was made and stored but the row that makes it a reference could not be written, so there is nothing to show or place — say so rather than describing it",
        spent,
      );
    }

    kickAnalyzer();
    const filed = filePicture(row);
    cropsFiled += 1;

    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.SUCCEEDED,
        /// The filed row beside the box it was cut to, which is what the ledger
        /// could never say while this tool ended at an offer: a run whose cut
        /// nobody took and a run whose cut is on a board read identically.
        output: {
          ...cut,
          referenceId: row.id,
          cutOf: frame.id,
          ...(nudge && { nudgeOf: named.id }),
          model: answer.model,
          attempts: answer.attempts,
        },
        finishedAt: new Date(),
        ...spent,
      },
    });

    /// The swap, made here rather than described to a click. This tool used to
    /// hand the board back for the browser to change, only because it could not
    /// write a scene; the cut is a row now, so the last step of the crop→board
    /// loop is one call to the tool that already knows how to make it — revision
    /// guard, page scoping and loose-fit report included. This whole call is
    /// queued on `boardEdits` for that reason.
    const swapped = swapTarget
      ? await swapPictures({
          boardId: swapTarget.boardId,
          ...(onPage && { pageId: onPage.id }),
          /// The picture standing in that slot, which is the frame on an
          /// ordinary cut and the *cut* when this one is a nudge of one the
          /// board is already carrying.
          swaps: [{ takeOff: swapTarget.takeOff ?? frame.id, putOn: row.id }],
        })
      : null;
    /// A board that refused the edit — the user has it open and has saved since
    /// — is said rather than thrown: the cut is filed either way, and a reply
    /// that reports the board change it did not get is the worse of the two.
    const swapFailed = swapped && typeof swapped.result.error === "string";

    /// The boards this cut leaves standing on the old picture, when the model
    /// did not name one. With a board there is nothing to say — the swap above
    /// and `notOnThatBoard` answer both ways it can go — so this is the other
    /// branch: a picture the user has just asked to be different is still on
    /// their board under a reply that reads as though the board were sorted.
    ///
    /// Read here rather than with the brief, because this is the one column
    /// priming refuses: a board's `elements` are megabytes and every turn would
    /// pay for them. Here it is one query beside a vision call already spent,
    /// bounded by `CROP_CALL_LIMIT`, and asked only of a project that has a board
    /// and only once the cut is real.
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
        /// The cut, not the frame: this answer is about a row that did not exist
        /// when the call was made, and it is the id the next round places.
        referenceId: row.id,
        cutOf: frame.id,
        ...(nudge && {
          nudgeOf: `${named.id} is untouched — this is that cut moved, filed as a second cut of ${frame.id}. Say it is an adjustment of their cut, and that the old one is still in the versions list to discard if they want it gone`,
        }),
        keeps: cut.editIntent,
        why: cut.editRationale,
        ...(cut.aspect && { aspect: cut.aspect }),
        /// Said rather than left to `aspect`, because a loose cut is not held to
        /// a ratio and a reply naming one would be naming a promise nobody made.
        /// The measured shape rides with it so the model can answer "roughly
        /// square, 1.09:1" instead of repeating the word back.
        ...(framed && {
          framedAs: `framed ${framed.wants} rather than held to an exact ratio — the cut came out ${cropOfferShape(cut, frame) ?? "a shape this frame's pixel size was never recorded to measure"}`,
        }),
        size: cropOfferCaption(cut, frame),
        /// Said in the answer and not only in the description: the model is about
        /// to write a sentence about what it just did, and a cut it does not know
        /// is filed is a cut it will offer to file again. The way out is in the
        /// same sentence because a cut nobody wanted now costs a row rather than
        /// nothing.
        status: onIt
          ? `cut and filed as a version of ${frame.id}, and put on ${onIt}${onPage ? ` on ${pageSaid(onPage)}` : ""} in place of ${swapTarget!.takeOff ?? "the frame"}. The frame itself is untouched and still in the project. Say the cut was made and the board changed, and offer discard_reference on ${row.id} if it is not the shot they meant`
          : `cut and filed as a version of ${frame.id} — a reference like any other now, and the analyzer will read it. The frame it came out of is untouched and still in the project. Say the cut was made rather than offered, and offer discard_reference on ${row.id} in the same breath if it is not the shot they meant`,
        /// The board refused the write. Named as its own key rather than folded
        /// into the status, because it is the one part of this answer that is
        /// about work the user asked for and did not get.
        ...(swapFailed && {
          notPutOnBoard: `the cut is filed, but it could not be put on “${swapTarget!.title}”: ${swapped!.result.error as string}`,
        }),
        /// Asked for a board the frame is not on. The cut still stands; what
        /// cannot happen is the swap, and a model told nothing would report a
        /// board change that never came.
        ...(board &&
          !onBoard && {
            notOnThatBoard: onPage
              ? `${referenceId} is not on ${pageSaid(onPage)} of “${board.title}”, so the cut was filed and nothing on that board changed — the board may hold it a page away, so read the page with inspect_board before naming one again, or call swap_on_board with ${row.id} if the user wants it there`
              : `${referenceId} is not on “${board.title}”, so the cut was filed and nothing on that board changed — call swap_on_board with ${row.id} if the user wants it there`,
          }),
        /// No board was named and the picture this cut replaces is on one. Named
        /// with the call that closes it, which is now `swap_on_board` on the cut
        /// itself: the row exists, so the swap the model used to be steered away
        /// from is the right one.
        ...(alsoOnBoards && { alsoOnBoards }),
        /// Said because it is not the shape that was asked for. The model passed
        /// the nearest name it has and the cut was made to the opening itself, so
        /// a reply quoting the argument back would name a shape the cut is not.
        ...(heldToSlot && {
          heldToSlot: `held to ${cut.aspect}, the exact shape of the ${heldToSlot.slotId} slot on ${onPage ? `${pageSaid(onPage)} of ` : ""}“${swapTarget?.title}” rather than to ${aspect ?? loose?.wants ?? "the frame's own subject"} — so it fills that opening with no page showing`,
        }),
      },
      /// The cut itself, as an ordinary reference tile: there are real bytes now,
      /// so the blow-up of the frame's thumbnail that stood in for them has
      /// nothing left to be honest about. The board rides behind it when one was
      /// changed, so the reply is written beside both things that happened.
      attachments: [
        attachmentOf(filed),
        ...(swapped && !swapFailed ? (swapped.attachments ?? []) : []),
      ],
    };
  }

  /// Agent 6 as an agent-tool, and the only door in this file that makes a
  /// picture rather than reading, cutting or arranging one.
  ///
  /// It ends where `importFromUrl` ends — bytes in the bucket, a row in the
  /// catalog, a job on the analyzer's queue — because a picture the model drew
  /// is an ordinary reference in every respect but the column saying where it
  /// came from. Nothing is offered and nothing is queued behind a board: it
  /// writes no scene, and the tools that place it run on the round after this.
  async function makePicture(args: Record<string, unknown>): Promise<ToolOutcome> {
    const description = typeof args.description === "string" ? args.description.trim() : "";
    if (!description) return { result: { error: "say what the picture should show" } };

    /// `crop_reference`'s dialect, read here rather than in the generator for the
    /// reason the crop reads it here: a shape that cannot be read is refused with
    /// a sentence before anything is spent, and drawing the picture at some other
    /// shape instead would be a background of the wrong shape under a reply
    /// saying it is the right one.
    const said = typeof args.aspect === "string" ? args.aspect.trim() : "";
    const shape = said ? shapeAsked(said) : null;
    if (said && !shape) {
      return {
        result: {
          error: `“${said}” is not a shape a picture can be drawn at — say it as width:height (${CROP_ASPECT_IDS.join(", ")}, or any ratio the user named such as 5:4), or loosely as ${LOOSE_SHAPE_IDS.join("/")}, or leave it out and the drawing model picks one`,
        },
      };
    }

    if (picturesAsked >= GENERATE_CALL_LIMIT) {
      return { result: { error: generationCeilingSaid(picturesAsked, picturesFiled) } };
    }
    picturesAsked += 1;

    /// The same row every other model call writes, and written before the call:
    /// what the image model would not draw is readable in the panel afterwards
    /// instead of being a sentence that scrolled out of a chat.
    const run = await db.agentRun.create({
      data: {
        projectId,
        agent: AgentKind.IMAGE_GENERATOR,
        status: RunStatus.RUNNING,
        input: {
          prompt: description,
          ...(shape && { aspect: shape.label }),
          via: "orchestrator",
        },
      },
      select: { id: true },
    });

    /// `recorded` is what the row keeps when the sentence handed back is one the
    /// generator wrote rather than the model's own words: the sentence is a
    /// constant of the code and the underlying `vertex 429: {…}` is the only
    /// part of the failure that is not recoverable from reading it.
    const fail = async (
      message: string,
      spent?: ReturnType<typeof spentColumns>,
      recorded?: string,
    ) => {
      await db.agentRun.update({
        where: { id: run.id },
        data: {
          status: RunStatus.FAILED,
          error: recorded ?? message,
          finishedAt: new Date(),
          ...spent,
        },
      });
      return { result: { error: message } };
    };

    let drawn;
    try {
      drawn = await generate({ description, shape });
    } catch (cause) {
      /// A refusal is charged for the tokens it took to reach — the image model
      /// bills the thinking it did before deciding not to draw — so the failed
      /// row carries them, exactly as a refused crop does. Either way the
      /// message is a sentence: the generator writes one when the call never
      /// landed, so a throttled burst reaches the model as words rather than as
      /// the HTML page Vertex answers a busy image model with.
      /// Read off the thrown value the way its tokens are, and for the same
      /// reason: the generator sets it, nothing else does, and a class is a
      /// module identity where a field is a fact.
      const detail = (cause as { detail?: unknown } | null | undefined)?.detail;
      return fail(
        cause instanceof Error ? cause.message : String(cause),
        spentThrown(cause) ?? undefined,
        typeof detail === "string" ? detail : undefined,
      );
    }

    const spent = spentColumns(drawn.model, drawn.usage);
    /// PNG is what this model answers with (infra.md §X) and what the bucket is
    /// told; anything else it ever answers with is stored as what it says it is,
    /// since the object's name is the only record of its type.
    const contentType = isUploadContentType(drawn.mimeType) ? drawn.mimeType : "image/png";

    let gcsUri;
    try {
      gcsUri = await storeImage(contentType, drawn.bytes);
    } catch (cause) {
      console.error("a generated picture could not be stored:", cause);
      return fail(
        "the picture was drawn but could not be stored, so it is not in the project — say so rather than describing it",
        spent,
      );
    }

    /// Read off the file's own header rather than from an image library or a
    /// canvas the server does not have. A reference with no size is a reference
    /// no layout can place, and this is twenty-four bytes.
    const size = pngPixelSize(drawn.bytes);
    /// Named against what the project already calls its pictures, and read as
    /// late as it can be — the turn's own list, so a picture drawn earlier in
    /// this turn is one of the names this one is kept clear of.
    const title = generatedImageTitle(
      description,
      (await references()).all.map((reference) => reference.title),
    );

    /// The row and its analyzer job land together, exactly as in `add` and in
    /// `importFromUrl`: a reference with no job is one the panel offers to
    /// analyze by hand, which is not what a picture filed by a tool should be.
    let row;
    try {
      row = await db.$transaction(async (tx) => {
        const created = await tx.reference.create({
          data: {
            projectId,
            gcsUri,
            title,
            origin: ReferenceOrigin.GENERATED,
            /// What it was drawn from, kept because it is the only record of
            /// what this picture *is* until the analyzer reads it — and the only
            /// way a user looking at the tile a week later can see it was
            /// written rather than shot.
            generationPrompt: description,
            ...(size && { width: size.width, height: size.height }),
          },
          select: TOOL_REFERENCE_SELECT,
        });
        await enqueueAnalysis(tx, { projectId, referenceId: created.id });
        return created;
      });
    } catch (cause) {
      /// The one path left that could reach the model as a raw exception, and
      /// the most expensive one to lose: the picture is drawn and paid for, the
      /// bytes are in the bucket, and the row that would make them a reference
      /// is not there. Answered as a sentence like every other refusal, so the
      /// run row carries what it cost instead of standing at RUNNING forever.
      console.error("a generated picture could not be filed:", cause);
      return fail(
        "the picture was drawn but could not be filed in the project, so there is nothing to place or show — say so rather than describing it",
        spent,
      );
    }

    kickAnalyzer();
    const picture = filePicture(row);
    picturesFiled += 1;

    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.SUCCEEDED,
        output: {
          referenceId: row.id,
          title,
          ...(size && size),
          model: drawn.model,
          attempts: drawn.attempts,
        },
        finishedAt: new Date(),
        ...spent,
      },
    });

    /// An exact ratio the API has no canvas for was asked for in the prompt, and
    /// a prompt is a request rather than a setting — so what came back is
    /// measured and said when it is not what was asked for. Without this the
    /// model reports the shape it asked for as the shape it got, and the
    /// background is stretched onto the page by whoever places it.
    const drawnRatio = size ? size.width / size.height : null;
    const offShape =
      shape?.shape && drawnRatio && Math.abs(Math.log(drawnRatio / shape.shape.ratio)) > 0.02;

    return {
      result: {
        imageId: row.id,
        title,
        ...(size ?? {}),
        ...(shape && { aspect: shape.label }),
        ...(offShape && {
          drawnAt: `${size!.width}×${size!.height}, which is not ${shape!.label} — the drawing model composes at its own canvas sizes. Crop it with crop_reference if the shape has to be exact`,
        }),
        /// Said in the answer and not only in the description, because the model
        /// is about to write a sentence about what it just did — and a picture
        /// it does not know is filed is a picture it will offer to file again.
        status: !size
          ? "drawn and filed in this project, but its pixel size could not be read — it is a reference like any other and the analyzer will read it. Tell the user the picture was made rather than found"
          : "drawn and filed in this project — it is a reference like any other now, and the analyzer will read it like an upload. Tell the user the picture was made rather than found",
      },
      /// The tile the user sees, so the reply is written beside the picture it
      /// is about rather than about an id.
      attachments: [attachmentOf(picture)],
    };
  }

  /// What a board holds, read back off its own scene — the whole of it, or one
  /// page of it.
  ///
  /// The one tool here that is a pure read of something the model has already
  /// been told exists. It is here because the alternative was worse than a
  /// missing feature: the boards are primed by id, title and page size, so a
  /// model asked "what is on my board?" could only answer it by calling
  /// `compose_moodboard` — paying a vision-free but real model call *and*
  /// rewriting the arrangement — to find out. A read that costs one query is the
  /// thing that makes that never the right call.
  ///
  /// The pages (§V) are the second answer this door gives, and they are why it
  /// takes a `pageId`. A board is no longer one flat canvas: listing every
  /// picture on a board of four pages says nothing about which of them sit
  /// together, and it is the arrangement the user is talking about when they
  /// say "the second page". So an unscoped read lists the pages with their names,
  /// sizes and counts — cheap, and what a page id is chosen from — and a scoped
  /// one reads that page alone. A board holding no page frame reads exactly as it
  /// did before pages existed, which is what every board made until now is.
  async function inspectBoard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project for the same reason the rebuild's read is: the id
    /// is a model argument, so it is checked rather than trusted.
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
    const items = boardItems(elements);

    /// Read on every call rather than only on a scoped one: the list is what a
    /// `pageId` is chosen from, and a model that has to call the tool twice to
    /// learn a board has pages would read the first answer as a board with none.
    const pages = pagesInReadingOrder(boardPages(elements));
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const page = asked ? pageById(pages, asked) : null;
    if (asked && !page) {
      return {
        result: {
          error: `no page called ${asked} on that board`,
          /// The ids that would have worked, in the same answer that refused —
          /// a page id the model guessed at is one round wasted, and two if the
          /// refusal makes it guess again.
          ...(pages.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so read it without a pageId",
              }),
        },
      };
    }

    /// One shape either way, so everything below is written once: a board with no
    /// page has nothing that can be clipped by one.
    const contents = page ? pageContents(elements, page) : wholeBoard(elements);
    const { background, lines, unnamedImages } = contents;

    /// The tags are left off on purpose: the photographs of the project are
    /// already primed into the instruction with theirs, so repeating them here
    /// is the same paragraph bought twice. What a board adds is *which* of them
    /// and in what order.
    const on = contents.pictures.map(({ referenceId: id, clipped }, index) => {
      /// Only ever true on a scoped read, and the one fact a page adds to a
      /// picture: excalidraw draws a child cut off at its frame's border, so a
      /// picture over the edge is an overflow rather than a crop.
      const over = clipped ? { clipped: true } : {};
      const reference = byId.get(id);
      if (!reference) {
        /// On the board and no longer in the gallery — deleted out from under
        /// it. Said rather than skipped, because the position it occupies is
        /// what the user is counting when they say "the third one".
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

    /// Where things sit, for a read scoped to one page (§V.4). Only there,
    /// because a box is a share of a page rect and an unscoped read has no rect
    /// to take a share of — a board is an unbounded canvas, and the pages listed
    /// on that answer are what the model scopes to in order to ask this.
    ///
    /// This is the arrangement itself rather than another list of ids: the
    /// pictures above say which references are on the page and in what order, and
    /// nothing in them says the headline runs across the top or that the wide one
    /// takes the left half. "Put the stairwell beside it" is unanswerable without
    /// it, and the alternative the model reaches for is a rebuild.
    const arrangement = page ? pageBlocks(itemsOnPage(items, pages, page), page) : null;

    const thumbUrlOf = (id: string) => byId.get(id)?.thumbUrl;

    /// The same gap `compose_moodboard` reports, for a board nobody just
    /// composed. Reachable now only because the template the board was composed
    /// at is stored on the row: the slot rectangles are constants, and a picture
    /// still sitting where that template put it can be measured against its slot
    /// off the scene alone. Without this the only way to ask "does this board
    /// fit" was to rebuild it — a compositor call that rewrites the arrangement
    /// in order to answer a question about it.
    const layout = boardLayout(board);
    /// Measured page by page, each in its own coordinates: the slot rectangles
    /// are cut against the origin, so a picture on any page but the first is only
    /// recognisable as seated once the page's corner is (0,0). A scoped read
    /// measures the one page it is describing; an unscoped read measures every
    /// page of the board and says which page each gap is on.
    const loose = layout ? pagedLooseFits(items, page ? [page] : pages, layout) : [];

    /// Pictures on no page of a board that has pages — dropped beside it, or left
    /// behind when a page was dragged off them. Said on the unscoped read only,
    /// where it is the difference between the pages listed and the board.
    const offPages = page ? [] : picturesOffPages(elements, pages);
    const clipped = on.some((picture) => "clipped" in picture);

    return {
      result: {
        boardId: board.id,
        title: board.title,
        ...(page
          ? {
              /// The page as it stands, not as it was made: the size is the
              /// rectangle and the preset is derived from it, so a page the
              /// user resized reads as what it now is.
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
              /// What the board's *next* page is drawn at, and what the whole
              /// board is on a board holding no page frame at all.
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
        /// The template it was last composed at, not a claim about where things
        /// are now — the user may have dragged half of it since, and the
        /// positions below are read off the scene rather than off this.
        ///
        /// A read scoped to a page says it only while *that page* is still
        /// standing in it. The row carries one template id and it describes the
        /// board's first page (§V.1), so on a spread it is the wrong word for a
        /// page `add_page` drew or a page composed at something else — and the
        /// tile beside this answer is already named by that narrower question,
        /// so a page read that kept the board's word for it would say one thing
        /// in the JSON and another in the picture.
        ...(board.layout &&
          (!page || pageStandsAsComposed(items, pages, page, layout)) && { composedAs: board.layout }),
        pictures: on,
        /// Beside the pictures rather than among them. It is on the page and the
        /// model has to know it is there — otherwise the answer to "what is on
        /// this page" leaves out the thing the page is standing on, and the next
        /// call puts a second backdrop behind the first — but it is not one of
        /// the photographs the user is counting.
        ...(background && {
          background,
          backgroundNote:
            "that picture stands behind the whole page rather than being one of the photographs on it: it covers the page and everything else is drawn over it. Leave it out of the count, and to put a different one behind, put the new picture on at a box covering the page and send it to the back with reorder_on_canvas",
        }),
        ...(arrangement?.blocks.length && {
          arrangement: arrangement.blocks,
          arrangementNote: ARRANGEMENT_NOTE,
          /// Said, never silent: a capped list read as the whole page is a model
          /// telling the user there is room where there is a photograph.
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
        /// Silent when there is nothing to say, and silent for a board that has
        /// been rearranged by hand: a picture the user moved off its slot is
        /// not measured against it (see `scenePlacements`).
        ...(loose.length && { looseInSlot: loose, looseInSlotNote: LOOSE_IN_SLOT_NOTE }),
        status: page
          ? `read only — nothing on the board changed. This is page “${page.name}” alone, so positions are reading order on that page and a picture on another page of this board is not in this list`
          : "read only — nothing on the board changed. Positions are reading order, so 'the third one' is position 3",
      },
      /// Named by the template while the board is still standing in it, so a
      /// board fetched by a read and the same board fetched by the compose that
      /// made it arrive in the chat under one name — the rule is `boardShown`'s
      /// because three doors now draw this tile.
      ///
      /// A read of one page shows that page: the answer above is about it alone,
      /// and the user reading a reply about page 2 beside a miniature of the
      /// whole spread is being shown the pages it says nothing about.
      attachments: [boardShown({ board, elements, thumbUrlOf, pageId: page?.id })],
    };
  }

  /// Another page on a board, and nothing else (§V.2).
  ///
  /// The other two doors that make a page both make it under an arrangement: a
  /// compose draws one below the slots it filled, and `newPage` draws a second
  /// one with pictures already on it. Neither answers "give me a page" — and
  /// neither reaches the board the user dragged together by hand, which has
  /// no page at all and which they do not want composed. That board is drawn a
  /// page *around* what is already on it, so the pictures they placed become the
  /// page's without moving, and the board can be read, scoped and attached a page
  /// at a time from then on.
  ///
  /// No model call and no `AgentRun` row: where a page goes was never a
  /// judgement, and this one puts nothing on it.
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
    /// Refused with the ids that would have worked, as the read's is: a page id
    /// the model guessed at costs one round, and two if the refusal sends it
    /// guessing again.
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

    /// Guarded on the revision that was read, as every server-side write to a
    /// board's scene is. The stored render is disowned: the board has a rectangle
    /// on it that the picture in the tab row does not show.
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

        /// The count is the whole of what a first page on a hand-made board did,
        /// and the model has to say it: those pictures did not move, and telling
        /// the user a page was made *with* them on it is truer than either
        /// "an empty page" or "the board was laid out".
        ...(added.adopted
          ? {
              drawnAround: added.adopted,
              drawnAroundNote:
                "the page was drawn around pictures the board already held, so they are on it now exactly where the user left them — nothing was moved, laid out or resized",
            }
          : {}),
        /// Only on a board the user sectioned themselves — every board this
        /// assistant composes has pages and no sections. Said because the page
        /// reads that follow will describe those pictures as being on this page,
        /// which is true and is not the whole truth: they are a section's, and a
        /// board is meant to use one or the other.
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

  /// One page of a board, copied onto a page of its own beside it (§V).
  ///
  /// `copyBoard` below is written for one sentence — "keep that one and try it
  /// with the tall shot" — because every other board tool changes the board the
  /// user is looking at. A board is pages now, and the same sentence is said
  /// about a page at least as often: "try that page with the tall shot" is a
  /// variation of one page of a spread, and both calls a model can reach for get
  /// it wrong. A board copy carries the pages they were *not* talking about into a
  /// second tab, so the next edit has to say which of the two copies of those it
  /// is about; a `newPage` compose asks agent 4 to decide the arrangement again,
  /// so what comes back is not a copy of anything.
  ///
  /// No model call and no `AgentRun` row: copying is not a judgement.
  async function copyPage(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project like every other board read here: the id is a model
    /// argument, so it is checked rather than trusted.
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
    const asked = typeof args.pageId === "string" ? args.pageId.trim() : "";
    const copy = asked
      ? pageDuplication({
          elements,
          pageId: asked,
          name: typeof args.name === "string" ? args.name : null,
        })
      : null;

    /// Refused with the ids that would have worked, as every page refusal in this
    /// file is: a page id the model guessed at costs one round, and two if the
    /// refusal sends it guessing again.
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
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so there is no page to copy. Call add_page to draw its first page around what it already holds, or duplicate_board to copy the whole of it",
              }),
        },
      };
    }

    /// Guarded on the revision that was read, as every server-side write to a
    /// board's scene is. The stored render is disowned: the board has a page on it
    /// that the picture in the tab row does not show.
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
        /// Only on a board the user sectioned themselves — every board this
        /// assistant composes has pages and no sections. Said because those
        /// photographs read as being on the page that was copied and are not on
        /// the copy: they are a section's, and taking the user's own grouping
        /// apart is not what "copy that page" asks for.
        ...(copy.sections
          ? {
              notCopied: copy.keptInSections,
              notCopiedNote:
                "the page was drawn over sections (plain frames) the user made, and what a section holds is the section's rather than the page's — so those pictures read as on the page that was copied and are not on the copy. Say so rather than letting them find it",
            }
          : {}),
        status: `done as a scene edit — no model call was made. This is a new page holding exactly what ${pageSaid(copy.source)} holds, in the same places, and nothing on the board changed: that board is now ${pages.length} page${pages.length === 1 ? "" : "s"}. Make the change they asked for on this page, by this pageId, and tell them ${pageSaid(copy.source)} is still there as it was`,
      },
      /// The page that was made, not a miniature of the whole spread: the answer
      /// is about the copy, and it is the copy they are about to work on.
      attachments: [
        boardShown({
          board,
          elements: copy.elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
          pageId: copy.page.id,
        }),
      ],
    };
  }

  /// One page of a board given another shape, with nothing laid out again (§V.1).
  ///
  /// "Resizing a page is allowed and changes nothing else" is the entity's own
  /// sentence and the user has always had it — they drag a frame handle. The
  /// model's nearest call was `compose_moodboard` naming a template of another
  /// shape, which does resize the page and lays it out again on the way past: so
  /// "make that page portrait" came back as a page agent 4 had rearranged, and the
  /// arrangement the user was happy with was the price of the shape.
  ///
  /// The rectangle is the whole of the write. What it costs is a page's membership
  /// changing under it — smaller leaves pictures beside the page, larger takes in
  /// what it covers — so both are counted by the same code that makes the change
  /// and both are said in the answer.
  ///
  /// No model call and no `AgentRun` row: a shape the user named is not a
  /// judgement.
  async function resizeBoardPage(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project like every other board read here: the id is a model
    /// argument, so it is checked rather than trusted.
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
    const page = asked ? pageById(standing, asked) : null;

    /// Refused with the ids that would have worked, as every page refusal in this
    /// file is: a page id the model guessed at costs one round, and two if the
    /// refusal sends it guessing again.
    if (!page) {
      return {
        result: {
          error: asked
            ? `no page called ${asked} on that board`
            : "say which page to reshape, by pageId — there is no default page",
          ...(standing.length
            ? { pages: pageDigests(elements) }
            : {
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so there is no page to reshape. Call add_page to draw its first page around what it already holds",
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
          presetsNote:
            "any other rectangle is the user's own to drag on the canvas: these are the shapes the layout templates are cut for",
        },
      };
    }

    /// Answered without a write, because there is nothing to write: the page is
    /// already that shape, and a revision spent on it would disown the board's
    /// render and put a scene the user has open one version behind for nothing.
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

    /// The board row's `widthPx`/`heightPx` are its *default* page size (§V.1) and
    /// they describe its first page — the same rule a compose writes them by, and
    /// the reason a compose about page 2 leaves them alone. So a first page given
    /// another shape takes the row with it, and any other page does not.
    const setsBoardDefault = standing[0]?.id === page.id;

    /// Guarded on the revision that was read, as every server-side write to a
    /// board's scene is. The stored render is disowned: the board has a page on it
    /// that is not the shape the picture in the tab row shows.
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

    /// Said only for a page that *was* standing exactly as its template composed
    /// it: the slots were cut against the old rectangle, so the arrangement is now
    /// a shape's worth off the page it is on and laying it out again is an offer.
    /// A page the user had already pulled apart has nothing to be offered back.
    const layout = boardLayout(board);
    const wasComposed = pageStandsAsComposed(boardItems(elements), standing, page, layout);

    return {
      result: {
        boardId: board.id,
        title: board.title,
        page: pageSized(resized.page, pagesInReadingOrder(boardPages(resized.elements))),
        was: `${resized.was.width}×${resized.was.height}`,
        /// Nothing was moved, deleted or laid out: what changed is which page
        /// describes what. The model has to say that rather than "I moved them",
        /// which is the sentence the counts alone read as.
        ...(resized.fellOff.pictures.length || resized.fellOff.lines.length
          ? {
              fellOffPage: resized.fellOff.pictures,
              ...(resized.fellOff.lines.length && { linesOffPage: resized.fellOff.lines }),
              fellOffPageNote: `the page is smaller than it was and those were outside it, so they are on no page now — still on the board exactly where they were, and no longer part of ${pageSaid(resized.page)}. Say that rather than that they were moved or removed, and offer to lay the page out again to bring them back onto it`,
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
          layoutNote: `${pageSaid(resized.page)} was standing exactly as ${layout?.id ?? "its template"} composed it, and the slots were cut for the old rectangle — so the arrangement is the old shape's on the new page. Say so; do not compose it again, which is an arrangement they did not ask for`,
        }),
        status: `done as a scene edit — no model call was made. ${pageSaid(resized.page)} is ${size.width}×${size.height} now and nothing on it moved${standing.length > 1 ? ", with the board's other pages untouched" : ""}`,
      },
      /// The page that changed shape, not a miniature of the whole spread: the
      /// answer is about that page, and its new shape is the thing to look at.
      attachments: [
        boardShown({
          board,
          elements: resized.elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
          pageId: resized.page.id,
        }),
      ],
    };
  }

  /// A second board holding this one's scene — the copy the user has had a
  /// button for since long before the assistant did.
  ///
  /// Every other board tool in this file changes the board the user is
  /// looking at. That is right for a swap, a reword and a rebuild, and it leaves
  /// one shape of ask with no honest answer: "keep this one and try it with the
  /// tall shot". The two calls a model could reach for are both wrong in a way
  /// nothing downstream can detect — `compose_moodboard` with a boardId replaces
  /// the arrangement that works, and `compose_moodboard` without one asks the
  /// compositor to re-decide every slot from a set the model had to read off the
  /// board and restate, so the "copy" comes back arranged differently and short of
  /// whatever it forgot. Copying is not a judgement, so nothing is asked: the
  /// scene is written across by value and the variation is made *on the copy*
  /// with the free scene edits that already exist.
  ///
  /// No model call and no `AgentRun` row: like `inspect_board`, this is a query
  /// and a write.
  async function copyBoard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project like every other read here: the id is a model
    /// argument, so it is checked rather than trusted.
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

    /// Filtered on the way out of the source row exactly as the scene query does:
    /// a row written by an older build — or by a compose — is input too.
    const elements = persistableElements(source.elements);

    /// Named against the boards the project has *and* the ones this turn has
    /// already filed. A title the user asked for wins; an empty one is not a
    /// name, so it falls back rather than filing a board called "".
    const asked = typeof args.title === "string" ? normalizedBoardTitle(args.title) : null;
    const title = asked ?? duplicateBoardTitle(await boards(), source.title);

    const copy = await db.moodboard.create({
      data: {
        projectId,
        title,
        widthPx: source.widthPx,
        heightPx: source.heightPx,
        /// Copied, where the user's own duplicate used to drop it: without the
        /// template the copy is a board nobody composed, so `inspect_board` cannot
        /// say what sits loosely on it and a rebuild of it picks a new shape by
        /// block count — a variation of a board that no longer looks like it.
        /// The geometry travels with it, because a `CUSTOM` id names no template
        /// to look up: dropped, the copy would say it was composed at a layout
        /// nobody can resolve.
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

    /// The copy is at revision 0 holding exactly the scene the source's picture
    /// was taken of, so that picture is a true picture of it — and copying the
    /// object is the only way it can have one, since a board is drawn by the tab
    /// showing it and the copy is not open yet. Best effort: a board with no
    /// preview is what every new board is anyway, and it is not worth failing a
    /// copy that landed.
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

  /// The board the user wants gone — put in front of them with a Discard
  /// button on it, and not deleted.
  ///
  /// This is the offer in the layer that is a choice rather than a mechanism.
  /// Agent 3 used to stand beside it and does not any more: it offered a cut only
  /// because nothing in this tree could decode an image, and now it files one.
  /// Nothing stops the server deleting this row either. What stops it is that a
  /// discard is the only act in the project that nothing can undo — a rebuild
  /// replaces an arrangement the compositor can be asked for again, a swap is a
  /// swap back, and a deleted scene is gone — so the last hand on it is the
  /// user's.
  ///
  /// It exists because `duplicate_board` gave the assistant a way to *multiply*
  /// boards and none to clear one up: "keep that one and try it with the tall
  /// shot" is answered by a copy, and the next sentence is reliably "bin the
  /// first one". Without this the model's nearest reachable call is a rebuild of
  /// the board they wanted gone.
  ///
  /// No model call, no `AgentRun` row and no write: one query, exactly like
  /// `inspect_board`.
  async function offerDiscard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project like every other board read here: the id is a model
    /// argument, so it is checked rather than trusted.
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
        /// What the discard would cost, so the reply names the loss rather than
        /// the id. The model cannot see what is on a board (§IV), and "shall I
        /// delete board X" with nothing after it is a question the user
        /// cannot answer without going and looking.
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

  /// One page the user wants off a board — put in front of them with a
  /// Discard button on it, and not taken.
  ///
  /// The same offer `discard_board` makes, on the same argument: the arrangement
  /// on a page is the thing being lost, no call in the pipeline puts one back,
  /// and the last hand on an irreversible act is the user's. What it exists
  /// for is the half of that argument the board tool could not serve — a page is
  /// the unit the user organizes by now, and "lose the second page" was
  /// answerable only by offering them the whole board, which takes the pages they
  /// asked to keep.
  ///
  /// It reports the loss out of `pageRemoval` rather than out of a read beside
  /// it: the same function makes the change when the button is pressed, so the
  /// count in "you would lose six photographs" is produced by the code that then
  /// loses them, and a section the page was drawn over is left out of both.
  ///
  /// No model call, no `AgentRun` row and no write: one query, exactly like
  /// `inspect_board`.
  async function offerPageDiscard(args: Record<string, unknown>): Promise<ToolOutcome> {
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
                pagesNote:
                  "that board has no pages on it at all — there is nothing to take off it, and discard_board is the call if they want the board gone",
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
        /// What the discard would cost, page-deep: the model cannot see a board
        /// (§IV), and "shall I drop page 2" with nothing after it is a question
        /// the user answers by going and looking at the page themselves.
        pictures: pictures.map(({ referenceId }) => referenceId),
        ...(pictures.some((picture) => picture.clipped) && {
          clipped: pictures.filter((picture) => picture.clipped).map((p) => p.referenceId),
          clippedNote:
            "those run over the page's edge, so the tile draws them cut off — they are on this page and go with it",
        }),
        ...(lines.length && { lines }),
        pageSize: `${page.width}×${page.height}`,
        /// §V.1's peer entity, and the one part of the page that does not go with
        /// it. Said only where there is one, and said because the user hears
        /// "the page goes" as everything inside the rectangle going.
        ...(sections && {
          sectionsOnIt: sections,
          keptInSections,
          sectionsNote:
            "a frame the user drew is inside that page and is not the page's (§V.1) — it stays on the board with its own pictures, so say the page goes and their frame does not",
        }),
        ...(emptiesBoard && {
          emptiesBoard: true,
          emptiesBoardNote:
            "that is the board's only page — taking it leaves the board standing with nothing on it rather than deleting it, so say so, and offer discard_board instead if the board is what they meant to lose",
        }),
        status:
          "offered, not done — nothing has been taken and that page is still on the board. The user has a Discard button beside your reply and it is theirs to press. Say which page it is, what is on it that they would lose, that the photographs stay in the gallery and that the board's other pages are untouched; never say the page is gone, removed or deleted",
      },
      attachments: [
        boardShown({
          board,
          elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
          pageId: page.id,
          discard: true,
          discardsPage: true,
        }),
      ],
    };
  }

  /// The picture the user wants out of the project — put in front of them
  /// with a Remove button on it, and not deleted.
  ///
  /// The same offer `discard_board` makes and the same reason for it: nothing
  /// stops the server deleting the row, and what stops it is that this is an act
  /// nothing can walk back. A board can be composed again out of pictures that
  /// still exist; a photograph is the bytes, and the delete takes them out of the
  /// bucket.
  ///
  /// What it has that the board's does not is a *reach* the model cannot see.
  /// Deleting a frame deletes every cut made of it — the schema cascades — and
  /// every board element naming the frame or any of those cuts becomes one of
  /// excalidraw's placeholder boxes. Both are in the answer, because "shall I
  /// delete this?" with neither of them said is a question the user answers
  /// without being told what it costs.
  ///
  /// No model call, no `AgentRun` row and no write. The picture comes off the
  /// shared read; the boards are one query, asked only of a project that has one.
  async function offerReferenceDiscard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const referenceId = typeof args.referenceId === "string" ? args.referenceId.trim() : "";
    const { all } = await references();
    const named = all.find((reference) => reference.id === referenceId);
    if (!named) return { result: { error: `no reference called ${referenceId} in this project` } };

    /// Every cut under it, not just its own children: a cut of a cut is a row
    /// too, and the cascade reaches all of them.
    const cuts = versionDescendants(
      all
        .filter((reference) => reference.source)
        .map((reference) => ({ id: reference.id, sourceReferenceId: reference.source!.id })),
      named.id,
    );
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    /// The one column priming refuses — a board's `elements` are megabytes — so
    /// it is read here, once, and only when the project has a board to read. A
    /// project with none pays nothing, which is the common case for the turn
    /// where a user is clearing out the pictures they just uploaded.
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
        /// A cut and a photograph are different news, and the model has to say
        /// which: removing a cut leaves the frame it came out of standing, and a
        /// user told "the photograph would go" about a crop is being asked
        /// the wrong question. The frame is named by the noun the cut's own
        /// inherited origin gives it, so a crop of a drawn backdrop does not
        /// report a photograph standing behind it.
        ...(named.source && {
          cutOf: `${named.source.id} — this is a cut, and the ${pictureNoun(named.origin)} it was cut from stays in the gallery`,
        }),
        /// The cascade, said as the pictures it is rather than as a number: the
        /// user may have taken one of these cuts an hour ago and will not
        /// connect it to the frame they are removing.
        ...(cuts.length && {
          cutsThatWouldGoWithIt: cuts.map((id) => ({
            id,
            title: byId.get(id)?.title ?? "",
          })),
        }),
        ...(standing.own.length && { onBoards: standing.own }),
        /// Split from the boards showing the picture itself, because it is the
        /// half the user cannot check by looking: a frame kept off every
        /// board while a crop of it holds up two reads as "on no board".
        ...(standing.viaVersions.length && { boardsShowingItsCuts: standing.viaVersions }),
        ...(gapBoards.length && {
          gap: "removing it leaves a hole in those boards — an element with nothing behind it — so say so, and offer to put another picture in its place with swap_on_board afterwards",
        }),
        /// Only when a board of more than one page is named: on a spread the
        /// pages under a board are where the copies actually are, and both halves
        /// of the answer need them — the user hears which page they would be
        /// losing it from, and the swap that fills the hole is given the pageId
        /// rather than editing whichever copy the scene array carries first.
        ...(gapBoards.some((board) => board.pages) && {
          pages:
            "a board listed with pages is a spread and the pages named under it are the ones the picture is on — say which page the user would lose it from rather than naming the board alone, and pass that pageId to swap_on_board",
        }),
        status:
          "offered, not done — nothing has been deleted and that picture is still in the project. The user has a Remove button beside your reply and it is theirs to press. Say what would go with it and that it cannot be undone; never say the picture is gone, deleted or removed",
      },
      attachments: [attachmentOf(named, { cuts: cuts.length, boards: gapBoards })],
    };
  }

  /// Agent 4 end to end: the references the orchestrator named become blocks, a
  /// template is settled before the call, the compositor says which block goes
  /// where, and deterministic code turns that into a board row.
  ///
  /// The board is filed rather than offered for approval. A moodboard is an
  /// excalidraw scene the user then rearranges — the composed one is a first
  /// draft that exists to be pushed around, and a draft they have to accept
  /// before they can see it is a draft they judge from a description.
  async function makeMoodboard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { all, frames } = await references();
    const intention = typeof args.intention === "string" ? args.intention : "";

    /// The picture of the page itself, when one was handed in: the layout reader
    /// reads its placeholder boxes and the board is laid out on those instead of
    /// on a template (§III.4).
    const askedLayoutImage =
      typeof args.layoutImageId === "string" ? args.layoutImageId.trim() : "";
    /// Both roads to a page at once. Refused rather than resolved by precedence:
    /// the two answers are different boards, so whichever one won would be a
    /// guess at which half of the call was the ask — and a guess paid for with a
    /// vision read. Nothing is called.
    if (askedLayoutImage && typeof args.layout === "string" && args.layout.trim()) {
      return {
        result: {
          error: `pick one — layoutImageId reads the page off ${askedLayoutImage} and layout ${args.layout.trim()} names a template instead of it, so a call carrying both says nothing about which page they asked for. Drop whichever they did not mean and call again`,
        },
      };
    }
    /// Checked against this project's own pictures, like every other id a model
    /// hands in. A layout image with no `gcsUri` is not a thing that can be read,
    /// and there is no such row — the column is not nullable — so being in the map
    /// is the whole of the check.
    const layoutImage = askedLayoutImage ? (frames.get(askedLayoutImage) ?? null) : null;
    if (askedLayoutImage && !layoutImage) {
      return {
        result: {
          error: `no picture called ${askedLayoutImage} in this project — layoutImageId is the reference id of a picture of the page itself, with placeholder boxes drawn on it`,
        },
      };
    }
    /// The layout image is the *ask*, not a block on the board: it is a picture of
    /// a page rather than a photograph to put on one, so a model that named it in
    /// both places is not asking for it to be composed beside the pictures it
    /// holds. Dropped here, once, so every reading below — the rename gate, the
    /// contents gate and the selection — sees the same set.
    const requestedIds = asStringArray(args.referenceIds).filter((id) => id !== layoutImage?.id);
    const addedIds = asStringArray(args.addReferenceIds).filter((id) => id !== layoutImage?.id);

    /// The board being rebuilt, read scoped to this project — the id arrives in
    /// a model argument, so it is checked against the project the toolset is
    /// closed over rather than trusted.
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
            /// Read for the tile a rename answers with, which is drawn off the
            /// scene as it stands rather than off a plan nobody made.
            widthPx: true,
            heightPx: true,
          },
        })
      : null;
    if (boardId && !existing) {
      return { result: { error: `no board called ${boardId} in this project` } };
    }

    const named = typeof args.title === "string" && args.title.trim() ? args.title : "";
    /// What to call a page. A board's name is a column and a page's is a string
    /// on a frame in the scene, so the two renames are written differently — but
    /// they are the same ask, and a call carrying only one of them is a rename
    /// either way.
    const pageNamed = typeof args.pageName === "string" ? args.pageName.trim() : "";

    /// tech-spec §III.4 gives agent 4 "all current blocks" as its input, and a
    /// rebuild is where that reading bites: asked to lay their board out again,
    /// the user means the pictures already on it. Read off the scene rather
    /// than guessed at by the model, so "make that a 3×3" costs no round of
    /// naming ids back.
    const onBoard = existing ? persistableElements(existing.elements) : [];
    const items = boardItems(onBoard);

    /// Which page of the board this compose is about (§V). The arrangement a
    /// compose decides is one page's rather than the whole board's: page 3 keeps
    /// its pictures while page 2 is laid out again, and a picture the user
    /// dragged off beside a page is not the page's to delete.
    ///
    /// Left out, it is the board's first page — which is every board this app
    /// holds, since a board composed since pages existed carries exactly one and
    /// one composed before them carries none and is written whole as it always
    /// was.
    const pages = pagesInReadingOrder(boardPages(onBoard));
    const askedPage = typeof args.pageId === "string" ? args.pageId.trim() : "";
    /// Onto a page of its own rather than over one the board has. A board grows a
    /// page this way and no other: the alternative reading — no `pageId` means a
    /// new page — would turn "lay that board out again" into a second copy of it
    /// beside the first, so which of the two a compose is has to be said.
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
    /// Named, the page is what the compose is about; named with `newPage`, it is
    /// only what the new one is put beside — "another page like that one" — and
    /// nothing on it is read or written.
    const target = asNewPage ? null : askedPage ? pageById(pages, askedPage) : (pages[0] ?? null);
    if (askedPage && !pageById(pages, askedPage)) {
      return {
        result: {
          error: `no page called ${askedPage} on that board`,
          /// The ids that would have worked, in the answer that refused — the same
          /// bargain `inspect_board` makes, and it matters more here: a guessed
          /// page id on this tool is a round of the compositor away from writing
          /// over the wrong arrangement.
          ...(pages.length
            ? { pages: pageDigests(onBoard) }
            : {
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so compose it without a pageId",
              }),
        },
      };
    }

    /// A rename is not a compose, and until now it was one: "call that board Act
    /// two" reached the compositor, paid for it, and wrote back an arrangement it
    /// had just re-decided — so the user's board changed shape as the price of
    /// changing its name. Nothing here is open to judgement, so nothing is asked.
    ///
    /// A *page* being called something is the same ask one level in (§V.1: the
    /// name is "the user's to edit"), and it is the name both of them use for
    /// it afterwards — "put the stairwell on Act two" is addressed to this string.
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
      /// A page to rename and no page to rename it: the board is a canvas the
      /// user arranged, so there is no rectangle carrying a name. Refused
      /// rather than answered with the board renamed instead, which is a different
      /// thing done quietly.
      if (pageNamed && !target) {
        return {
          result: {
            error:
              "that board has no pages on it, so there is nothing on it to name — call add_page to draw its first page around what it already holds, then name that",
          },
        };
      }

      /// The board keeps the name it has when the call was only about a page:
      /// "call the second page Act two" is not a board rename, and the title read
      /// back has to be the one the tab row is showing.
      const title = named ? composedBoardTitle(named) : existing.title;
      const titleChanged = title !== existing.title;
      const renamed = target && pageNamed ? renamePage(onBoard, target.id, pageNamed) : null;
      const pageChanged = !!renamed && target!.name !== pageNamed;

      if (pageChanged) {
        /// A page's name is in the document, so this is a scene write and takes
        /// the same guard every other one does — the tab that loses gets a
        /// conflict rather than the arrangement it is holding overwritten by a
        /// call about a string. `renderRevision` goes with it because excalidraw
        /// draws a frame's name above its rectangle: the stored picture is of a
        /// board whose page is called something else.
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
        /// The title column alone, unguarded and with no revision bump — the same
        /// write the user's own rename makes. The scene is untouched, so the
        /// revision an open tab is autosaving against still holds, and the stored
        /// render is still a picture of this board rather than of one that no
        /// longer exists.
        await db.moodboard.update({ where: { id: existing.id }, data: { title } });
      }

      const byId = new Map(all.map((reference) => [reference.id, reference]));
      const after = pageChanged ? renamed! : onBoard;
      return {
        result: {
          boardId: existing.id,
          title,
          ...(pageChanged && { page: { pageId: target!.id, name: pageNamed } }),
          /// The one ambiguity this path can be wrong about, answered in the
          /// answer rather than guarded against in the call: "rearrange it and
          /// call it X" with no template named arrives here looking exactly like
          /// a rename. Saying what was and was not done lets the model make the
          /// other call in the same turn instead of reporting a reflow that never
          /// happened.
          status:
            pageChanged || titleChanged
              ? `${renamedSaid({ title: titleChanged ? title : "", page: pageChanged ? pageNamed : "" })} — no model call was made, nothing on the board moved and it was not laid out again${pageChanged && pages.length > 1 ? ", and the board's other pages are untouched" : ""}. If they also asked for it rearranged, call compose_moodboard for that board with a layout`
              : pageNamed
                ? `${pageSaid(target!)} is already called that, so nothing changed`
                : "that board is already called that, so nothing changed",
        },
        attachments: [
          boardShown({
            board: { ...existing, title },
            elements: after,
            thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
            /// The page that was renamed is what the tile shows, so the caption
            /// under the reply carries the name the user just gave it.
            ...(pageChanged && { pageId: target!.id }),
          }),
        ],
      };
    }

    /// The board read as the page the compose is about: what is on it, in the
    /// page's own coordinates. A template's slots are cut against the origin, so
    /// a page sitting anywhere else has to be read from its own corner before a
    /// picture can be recognised as still seated in a slot — read in board
    /// coordinates, nothing on page 2 ever stands as its template composed it and
    /// a call naming one photograph reshuffles the page.
    /// A page of its own starts empty, so there is nothing on it standing in a
    /// slot and nothing to keep in one — the same footing a new board is composed
    /// on, on a board that already exists.
    const onPage = asNewPage
      ? []
      : target
        ? pageLocalItems(itemsOnPage(items, pages, target), target)
        : items;

    /// Whether this call names a *change* to what the board holds rather than
    /// restating the whole of it. It decides two different things below, and both
    /// of them are "do not lay this board out again": on a board the user
    /// arranged themselves there is no template to reflow into, and on one still
    /// standing in its template the pictures already on it keep their slots.
    ///
    /// Never on a page of its own: there is no arrangement there to add a picture
    /// to, so "put the doorway on a new page" is the whole of what goes on it
    /// rather than a change to something standing.
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

    /// A picture or a line put on or taken off a board the user arranged
    /// themselves.
    ///
    /// On a board standing in its template a rebuild is what this should be — the
    /// blocks move up into a template that holds the new count, which is the
    /// arrangement the compositor is for. On a board they dragged together there
    /// is no template to reflow into, so the rebuild picks one from the block
    /// count and writes it over the arrangement: adding a photograph, or a
    /// headline, deletes the board. Nothing about where either goes on such a
    /// board is open to judgement — a picture goes where there is room and a line
    /// goes above what is there — so nothing is asked.
    /// The board's template as the page being read draws it: a page the user
    /// sized themselves carries the arrangement fitted to their rectangle, so held
    /// against the template's own page size it stands in nothing and every edit to
    /// a resized page would be sent down the hand-arranged branch below.
    if (
      existing &&
      contentsOnly &&
      !standsAsComposed(onPage, layoutForPage(boardLayout(existing), target))
    ) {
      /// Scoped to the same page the rebuild would have been scoped to (§V): the
      /// picture goes on that page rather than under the widest thing on the
      /// board, and the board's other pages are no more this call's to change
      /// here than they are on the compositor's side of the branch.
      return await editInPlace({
        board: existing,
        elements: onBoard,
        args,
        named,
        page: target,
        pages,
      });
    }

    /// What the compose is *about*, which on a board with a page is that page's
    /// rather than the board's. A picture on page 3, or one sitting loose on the
    /// canvas beside the pages, is not part of the set page 2 is laid out from —
    /// offered as one it would be drawn a second time on the page being composed
    /// while the copy the user put there stayed where it was.
    ///
    /// Null on a page of its own: nothing is on it to be laid out again, and
    /// reading the board's set instead would draw the whole board a second time
    /// beside itself.
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

    /// The lines the board already carries are its own. A rebuild used to take
    /// its text from the call alone, so "add the sunset to that board" — a call
    /// with no captions in it — wrote the board back without its headline.
    const text = lineSelection({
      onBoard: startsEmpty ? [] : (held?.lines ?? boardContents(onBoard).lines),
      requested: asStringArray(args.captions),
      add: asStringArray(args.addCaptions),
      remove: asStringArray(args.removeCaptions),
    });

    const blocks = layoutBlocks(found, text.lines);

    /// The page read off the picture of it, when one was handed in — paid for
    /// here, after every refusal above, because it is a vision read and a
    /// compose that was going to be turned away for naming no pictures should not
    /// have cost one.
    ///
    /// A run row of its own, on the compositor's terms and for its reasons: what
    /// the reader could not read is readable afterwards rather than being a
    /// sentence that scrolled out of a chat, and the tokens are on the ledger
    /// whichever way the read went.
    let customLayout: MoodboardLayout | null = null;
    if (layoutImage) {
      const read = await db.agentRun.create({
        data: {
          projectId,
          agent: AgentKind.LAYOUT_READER,
          status: RunStatus.RUNNING,
          input: {
            /// The picture that was read, which is the one thing about this call
            /// that is not the compose beside it — a page handed in twice reads as
            /// two reads of the same picture rather than as two boards.
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
          /// The pixels the boxes are thousandths of. Without them the reader
          /// cannot tell a portrait page from a landscape one, so the shape the
          /// user drew would be settled by a default.
          image: { width: layoutImage.width, height: layoutImage.height },
          ...(intention && { intention }),
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        /// A refusal reached on the third read is the most expensive thing a
        /// compose can do, so the failed row carries its tokens — see the
        /// cropper's own branch above.
        await db.agentRun.update({
          where: { id: read.id },
          data: {
            status: RunStatus.FAILED,
            error: message,
            finishedAt: new Date(),
            ...spentThrown(cause),
          },
        });
        /// Handed back as the reader wrote it. It says what was wrong with the
        /// picture — no boxes on it, boxes too thin to hold a photograph — which
        /// is something the user can act on, and nothing was written.
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

    /// A rebuild keeps the board's own template while it has room for the
    /// pictures. Re-picking from the block count is right for a new board and
    /// wrong for one the user has been looking at — see `layoutForBoard`.
    ///
    /// A page handed in as an image skips the question: it *is* the answer, asked
    /// for as plainly as a template named by id, so it comes back under the same
    /// reason. Nothing checks whether it holds the blocks — the slots it has are
    /// the ones the user drew, and a compositor given fewer than it was offered
    /// reports what it could not place, which is the truth about a page they drew
    /// too small.
    const { layout: composedAt, reason: layoutReason } = customLayout
      ? { layout: customLayout, reason: "requested" as const }
      : layoutForBoard({
          /// Resolved rather than passed as the id: `CUSTOM` names no template
          /// this file can look up, so a board laid out from a layout image would
          /// otherwise be read as a board with no template at all and re-picked
          /// from the block count on every rebuild.
          stored: boardLayout(existing),
          requested: args.layout,
          blocks,
        });
    /// The template as *this page* draws it (§V.1). A page still at one of the
    /// presets takes the template's page size, exactly as a board always has — a
    /// masonry is a tall page and the answer says the page changed shape. A page
    /// the user sized themselves keeps its rectangle and the arrangement is
    /// fitted into it: their number is not a compose's to overwrite, and it is the
    /// only reading under which resizing a page changes nothing else.
    ///
    /// Never for a page of its own, which is being drawn rather than filled: it is
    /// made at the template's size, and there is no rectangle of the user's to
    /// keep.
    const layout = layoutForPage(composedAt, asNewPage ? null : target);
    /// What the board was laid out as before this call, for the one answer that
    /// has to say so — the sentence about a board that outgrew its page. A board
    /// composed from a layout image carries `CUSTOM` on its row, which is the id
    /// of no template anyone asked for, so "that board's pages are CUSTOM" would
    /// hand the model a column name to read out.
    const storedNamed =
      existing?.layout === CUSTOM_LAYOUT ? "the page they handed in as an image" : existing?.layout;

    /// References the compositor was never even offered: the block cap bites
    /// before the call, and captions are kept ahead of photographs when it does.
    /// `unplaced` cannot say this — it only knows the blocks that were sent — so
    /// without it a user who named fourteen references is told about the
    /// three the compositor left off and nothing about the two that never
    /// reached it.
    const offered = new Set(blocks.map((block) => block.id));
    const notOffered = [...new Set(selection)].filter(
      (id) => !offered.has(id) && !missing.includes(id),
    );
    /// The same admission about the lines, and it is the commoner one: no
    /// template on the list carries a third line, so a user captioning each
    /// photograph has most of what they typed left over.
    const overflowLines = linesNotOffered(text.lines, blocks);
    /// And the admission the budget cannot make: a template the model *named*
    /// that has no text block at all. Seven of the ten have none, so a headline
    /// composed at one of those is a block the compositor is asked to place and
    /// cannot — reported back as `unplaced`, which reads as its judgement rather
    /// than as the template having nowhere to put it.
    const homelessLines = linesWithNoSlot(blocks, layout);
    /// Pictures the compositor was given with nothing to reason about. Agent 4's
    /// whole judgement is tag adjacency — "two references sharing a palette read
    /// as one idea when they touch" — so a board composed the minute after an
    /// upload is composed on shape alone, and a reply that does not say so is
    /// claiming a reading of pictures nobody has read.
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

    /// The name the new page will carry, settled before the compositor is called
    /// rather than at the draw below, because the model is told the name the
    /// user is about to see. The user's own word for it when they gave
    /// one — "a page for the exteriors" is a name, not a description — else
    /// `nextPageName`, which is deterministic over the pages the board already
    /// has, so the two cannot disagree.
    const freshPageName = asNewPage ? pageNamed || nextPageName(pages) : null;
    /// What the page being composed is called once this call is done with it: the
    /// name they just gave it rather than the one it is carrying, since the line
    /// agent 4 speaks and the frame the code draws are both about the page as it
    /// will stand.
    const targetName = target ? pageNamed || target.name : "";
    /// The page this compose is about, as agent 4 reads it (§V). Sent only when
    /// it says something the layout does not: on a board holding one page the
    /// page *is* the board, so an ordinary compose and an ordinary rebuild ask
    /// exactly what they always asked. On a spread it is what keeps the model's
    /// closing line honest — "I put the rooftop across the top" is a sentence
    /// about a board the user has four pages of — and it is the only way the
    /// model is told the other pages exist and are not its to fill.
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

    /// What is staying exactly where it is.
    ///
    /// A rebuild asks for an assignment of every block to every slot, and on a
    /// board the user is looking at that re-decides eight placements to answer
    /// a call about one. Worse than untidy: a cut is held to the exact shape of the
    /// opening it was made for (§V), so a reflow that moves it into another slot
    /// throws away the photograph read that made it fit.
    ///
    /// Only when the call names a *change* — "lay it out again" is a rebuild and
    /// this is not consulted for it — only while the template is the one the board
    /// already has, and only while every picture is still sitting in it. Anything
    /// else and the arrangement being kept is not the one on the screen.
    const seats =
      existing && contentsOnly && layoutReason === "kept" && standsAsComposed(onPage, layout)
        ? keptSeats({ items: onPage, layout, blocks })
        : null;

    const byId = new Map(all.map((reference) => [reference.id, reference]));
    const thumbUrlOf = (id: string) => byId.get(id)?.thumbUrl;

    /// Nothing joining and nothing leaving: every picture named on was already on
    /// the board. The scene it would be rewritten to is the scene it has, so the
    /// write is skipped rather than made — a revision bump here would hand an open
    /// tab a conflict, and a dropped `renderRevision` would blank a preview that is
    /// still a true picture of this board.
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

    /// The compositor gets a run row of its own, on the same terms as the
    /// cropper's. It is the cheapest model call in the pipeline and that is
    /// exactly why it needs one: "cheapest" is a claim about a bill, and the
    /// only way a block cap gets raised on evidence rather than on a feeling is
    /// if what a board actually cost is on a row somewhere.
    ///
    /// Null when there is no call to make: a picture taken off a board that keeps
    /// its arrangement leaves nothing for the compositor to decide, and a run row
    /// for a call nobody made would put a zero-token compose on the ledger.
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
              /// Which page of it the call was about — a run row saying only
              /// which board was rebuilt describes a spread's every compose the
              /// same way.
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
      /// Nothing to ask — `run` is null only on the seated path, where every block
      /// is already sitting somewhere. What survives is what was seated, minus
      /// whatever the user took off, which is the whole of the change named.
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
          /// Only the free slots, when the board is keeping its arrangement: a
          /// slot that is taken is not open to assignment, and offering it would
          /// be inviting the model to move a picture nobody asked it to move.
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
      /// The model's reading of the set, then the rule it does not get a say in:
      /// a picture the user named does not fall off a board that has a slot
      /// free for it. Seen live — asked to add a second photograph to a two-slot
      /// board, the compositor placed one and dropped the other, which on a
      /// rebuild is a deletion rather than a selection.
      const answered = planAssignments(
        seats ? { ...layout, slots: seats.free } : layout,
        answer.assignments,
        asking,
      );
      /// Held against the free slots and merged back into the whole board, so the
      /// seating rule below sees the arrangement as it will stand rather than only
      /// the half that was open.
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

    /// Slot order rather than answer order: what was kept and what has just been
    /// placed are two lists, and the board reads in one.
    const placed = seats ? inSlotOrder(layout, plan.placed) : plan.placed;

    /// The page the board is composed on (§V.1). A compose about a page it
    /// already has keeps that page — its id, the name the user may have
    /// edited and the corner it sits at — because the arrangement is what a
    /// compose replaces, not the page it is drawn on. Its *size* still comes from
    /// the template: a page rebuilt at a 1080×1920 masonry is a tall page
    /// whatever it was before.
    ///
    /// A compose onto a page of its own draws a page the board did not have
    /// (§V.2): to the right of everything already on it, top-aligned with the page
    /// it was told to put it beside, named one past the highest the board carries.
    /// Deterministic — where a page goes was never the compositor's to decide, only
    /// what goes on it.
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
    /// Whether this compose is the one the board's row describes (§V.1).
    /// `Moodboard.layout`/`widthPx`/`heightPx` are the board's *default* page —
    /// what agent 4 draws a first page at and what §V.2 falls back to on a board
    /// holding none — so only a compose about the board's first page, or about a
    /// board with no page at all, sets them. Written from every compose, a
    /// spread's default would follow whichever page happened to be laid out last,
    /// and the row's one template id would name a template only that page was
    /// drawn in while `pagedStandsAsComposed` read every other page against it.
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
    /// The picture standing behind the page, carried through the rebuild.
    /// `sceneOffPage` keeps everything *not* on the target page, so without this
    /// a rebuild deletes the background rather than laying the page out on it —
    /// and the way back is not that filter, which would put it before the page
    /// frame in the array, where a frame's children have to be. Spliced in front
    /// of what the compositor drew instead, so it lands at the back of the page's
    /// own stack: where it was, and where the rule that recognises one looks.
    ///
    /// The frame is adopted explicitly because `composedScene` marks its own
    /// elements and this one is not its. On a rebuild the frame it is joining is
    /// the page's own — `composedScene` is handed `target.id` — so this is the
    /// same page it was already a child of.
    const behind = target ? pageBackgroundElement(onBoard, pages, target) : null;
    const pageDrawn = behind ? [{ ...behind, frameId: target!.id }, ...drawn] : drawn;
    /// The rest of the board goes back untouched, in the order it was in. Only
    /// the page being composed is written over: the board's other pages keep
    /// their pictures, and one the user dragged onto the canvas beside them
    /// stays where they put it rather than being deleted by a call about a page.
    /// A page of its own writes over nothing at all — the board it joins is
    /// returned whole and the page arrives after it.
    const elements = fresh
      ? [...onBoard, ...drawn]
      : target
        ? [...sceneOffPage(onBoard, target, pages), ...pageDrawn]
        : drawn;
    /// Read back off the page that was just drawn rather than assembled beside
    /// it, so the id reported is the id the board carries. It is what the next
    /// call needs: a compose that filed a page without naming it leaves
    /// `inspect_board`'s `pageId` reachable only by reading the board again.
    const composedPage = boardPages(drawn)[0] ?? null;
    /// A rebuild keeps the name the user gave the board. Renaming "Act two
    /// exteriors" to whatever they said while asking for a 3×3 is a second,
    /// unasked-for change to a thing they already own.
    const title = named
      ? composedBoardTitle(named)
      : existing
        ? existing.title
        : composedBoardTitle(intention);

    let board: { id: string; title: string };
    if (existing) {
      /// Guarded on the revision that was read, exactly as the autosave is: a
      /// rebuild is a write to a document a tab may have open, and the tab that
      /// loses gets its own conflict — a reload — rather than its arrangement
      /// silently overwritten.
      ///
      /// `renderRevision` is dropped because the stored picture is now of a board
      /// that no longer exists. Left standing, the tab row would show the old
      /// arrangement as the preview of the new one until somebody opened it.
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
          /// Recorded so the *next* rebuild has something to keep. A board with
          /// no template on it is one the user dragged together, and that is
          /// exactly the board a rebuild has to choose a template for.
          layout: layout.id,
          widthPx: layout.page.width,
          heightPx: layout.page.height,
          /// And for a page read off an image, the geometry beside the id: there
          /// is no constants file to look `CUSTOM` up in, so a row carrying the id
          /// alone is a board whose next rebuild has nothing to keep.
          ...(layout.id === CUSTOM_LAYOUT && { layoutSlots: layoutSlotsWritten(layout) }),
          ...sceneWrite(elements),
        },
        select: BOARD_ROW_SELECT,
      });
      /// The project now has a board it did not have when the turn started, so
      /// the next round is handed the tools that read and edit one — and the
      /// catalog those tools are read beside lists it.
      fileBoard(created);
      board = created;
    }

    /// The cover is whatever landed in the first slot the layout reads — the
    /// hero in every template that has one. A board has no picture of its own
    /// until a tab has drawn it, and this is the one that is true before then.
    const opening = layout.slots
      .filter((slot) => slot.kind === "image")
      .map((slot) => placed.find((placement) => placement.slot.id === slot.id))
      .find(Boolean);
    const cover = found.find((reference) => reference.id === opening?.block.id);
    const images = placed.filter((placement) => placement.slot.kind === "image").length;

    /// Where agent 4 hands over to agent 3. A picture is contained in its slot,
    /// never stretched to it, so a portrait in a wide frame is on the board with
    /// page showing either side — and the only thing that closes that gap is a
    /// cut. The board is written either way; this is the sentence that lets the
    /// orchestrator make the crop instead of the user noticing the gap.
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
        /// What `CUSTOM` is, said rather than left as an id. It is the one value
        /// this field can carry that names no template on the list, so a model
        /// reading it alone would report the board as having been laid out in a
        /// template called Custom — when what happened is that the page they
        /// handed in was read and used.
        ...(customLayout && {
          layoutRead: `not a template — that page was read off ${layoutImage!.id}, the picture they handed in: ${customLayout.composition}`,
        }),
        /// The page it stands on, so the arrangement can be read back page by
        /// page without a second call to find out what the page is called. A
        /// rebuild reports the page it kept, which is the same id the board had
        /// before the call.
        ...(composedPage && {
          page: { pageId: composedPage.id, name: composedPage.name },
        }),
        /// Only when the board changed shape. A rebuild that keeps the template
        /// needs no sentence about it; one that could not is a second change the
        /// user did not ask for, and the arrangement they were looking at is
        /// gone either way.
        ...(layoutReason === "outgrew" &&
          existing && {
            /// A page added is not the board changing shape. Its template is the
            /// board's unless the pictures named do not fit one, and when they do
            /// not the page beside the others is a different shape — which the
            /// user is told about as the new page rather than as their board.
            layoutChanged: fresh
              ? `that board's pages are ${storedNamed}, which could not hold ${blocks.length} blocks, so the new page is a ${layout.id} — tell the user it is a different shape from the rest`
              : /// A page the user sized themselves did not change shape at
                /// all — it kept their rectangle and the new template was fitted
                /// into it — so the sentence about it is about the arrangement
                /// rather than about the page.
                target && layout !== composedAt
                ? `that board's pages are ${storedNamed}, which could not hold ${blocks.length} blocks, so “${target.name}” was laid out as a ${layout.id} — tell the user the arrangement changed, not the page: it is still ${target.width}×${target.height}, the size they made it`
                : /// One page of a spread outgrowing its template is that page
                /// changing shape, not the board: the pages that did not change
                /// are still the shape the user left them, and the board's
                /// own default (§V.1) is not written by a compose about page 2.
                target && pages.length > 1 && !setsBoardDefault
                ? `that board's pages are ${storedNamed}, which could not hold ${blocks.length} blocks, so “${target.name}” was laid out as a ${layout.id} — tell the user that page is now a different shape from the rest`
                : `that board was laid out as ${storedNamed} and could not hold ${blocks.length} blocks, so it was laid out as ${layout.id} — tell the user its shape changed`,
          }),
        /// Which of the two things happened, said in the answer rather than left
        /// to the model's memory of what it asked for: "I made you a board" about
        /// a board the user already had is the one sentence a rebuild can
        /// get wrong, and the tab count is what gives it away.
        /// A pinned edit is a third thing and has to say so: the user asked
        /// for one picture and the answer is about one picture, so a reply reading
        /// "I laid your board out again" would describe a change that did not
        /// happen to eight photographs that did not move.
        status: !existing
          ? "filed as a new board"
          : /// A page added is not a board rebuilt: nothing the user was
            /// looking at moved, so the sentence to say is that their board has
            /// another page on it now and where it is.
            fresh
            ? `added to that board as a new page, “${fresh.name}”, beside what was already on it — nothing already on the board moved and no picture came off it${pages.length ? `, so the board is ${pages.length + 1} pages now` : ""}`
            : seats
            ? `${seats.joining.length ? "placed what joined it" : "taken off in place"} — the other ${seats.kept.length} kept their slots and nothing else on that board moved${run ? "" : ", and no model call was made"}`
            : /// On a board of several pages a rebuild is a rebuild of *one* of
              /// them, and a reply saying the board now holds this arrangement
              /// would describe the loss of pages that did not change.
              target && pages.length > 1
              ? `laid out again on “${target.name}” — that page now holds this arrangement instead of what was on it, and the board's other ${pages.length - 1} ${pages.length === 2 ? "page is" : "pages are"} untouched`
              : "rebuilt in place — that board now holds this arrangement instead of what was on it, so say so",
        ...(seats && { keptTheirSlots: seats.kept.length }),
        placed: placed.map(({ slot, block }) => ({ slotId: slot.id, blockId: block.id })),
        /// Everything the answer did not amount to, said rather than swallowed:
        /// a board with a hole in it is still a board, and the user is owed
        /// the sentence that admits it.
        ...(plan.unplaced.length && { unplaced: plan.unplaced }),
        /// Placed by the room that was left rather than by the compositor's
        /// reading. Said because it is the one part of the arrangement nobody
        /// composed: these sit where they fitted, so "I put it in beside the
        /// other one" is the honest sentence about them.
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
        /// What the edit came to, since the model named a change and not a set:
        /// a picture it asked to remove that was never on the board means it
        /// meant a different one, and only the user can say which.
        ...(edit.added.length && { added: edit.added }),
        ...(edit.removed.length && { removed: edit.removed }),
        ...(edit.notOnBoard.length && { notOnBoard: edit.notOnBoard }),
        ...(edit.alreadyOn.length && { alreadyOnBoard: edit.alreadyOn }),
        /// The same four things about the lines. Kept apart from the pictures'
        /// report because a line quoted back that the board never carried is a
        /// different mistake from a picture id that is not on it, and the reply
        /// has to name the words rather than an id.
        ...(text.added.length && { linesAdded: text.added }),
        ...(text.removed.length && { linesRemoved: text.removed }),
        ...(text.notOnBoard.length && {
          linesNotOnBoard: text.notOnBoard,
          linesNotOnBoardNote: LINE_NOT_ON_BOARD_NOTE,
        }),
        ...(text.alreadyOn.length && { linesAlreadyOn: text.alreadyOn }),
        /// Only when there is one, so a board that fits costs nothing to say so.
        ...(loose.length && { looseInSlot: loose, looseInSlotNote: LOOSE_IN_SLOT_NOTE }),
        ...(note && { note }),
      },
      attachments: [
        boardAttachmentOf({
          id: board.id,
          title: board.title,
          layout: layout.id,
          /// The miniature is already this page alone — it is drawn from the
          /// placements, which are cut against the page the compositor filled —
          /// so on a spread the caption is what says which page that is. Read off
          /// the scene as written rather than off the plan, so the numbering is
          /// the board's own reading order and a page added is counted.
          ...(composedPage && { onPage: pageShown(elements, composedPage) }),
          images,
          /// Off the blocks that were seated rather than off the call's
          /// `captions`: a line the block budget left off is not on the board,
          /// and a rebuild's lines come from the board itself.
          lines: placed
            .filter((placement) => placement.slot.kind === "text")
            .map((placement) => placement.block.text ?? ""),
          thumbUrl: cover?.thumbUrl ?? null,
          /// Off `found` rather than the blocks, because a block carries the
          /// pixel size and the id and never the picture — the thumbnail is a
          /// signed URL the tool layer holds and the model never sees.
          preview: boardPreview(placed, layout.page, (id) =>
            found.find((reference) => reference.id === id)?.thumbUrl,
          ),
        }),
      ],
    };
  }

  /// The in-place half of `makeMoodboard`: pictures and lines joining and leaving
  /// a board the user arranged by hand, with no compositor call and nothing
  /// that was already on the board moved.
  ///
  /// It is a branch of the compose rather than a tool of its own on purpose. The
  /// model has no way to know which boards are hand-arranged — the boards brief
  /// names the template a board was *composed* at, and reading the scene of every
  /// board to prime a turn is the query iteration 12 refused — so a second
  /// declaration would be one the model could not route to. The routing is a fact
  /// about the stored scene, so it is decided here where the scene is.
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
    /// The page the edit is about, or null on a board carrying none — which is a
    /// board the user drew on a flat canvas, and is edited as one.
    page?: BoardPage | null;
    pages?: readonly BoardPage[];
  }): Promise<ToolOutcome> {
    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    const asked = [
      ...new Set(asStringArray(args.addReferenceIds).map((id) => id.trim()).filter(Boolean)),
    ];
    const notFound = asked.filter((id) => !byId.has(id));

    /// The rectangle the edit is measured against: the page it is about, or the
    /// board's default page size at the origin for a board with no page on it —
    /// which is what `Moodboard.widthPx`/`heightPx` mean now (§V.1).
    const room = page ?? { x: 0, y: 0, width: board.widthPx, height: board.heightPx };
    const add = asked.filter((id) => byId.has(id));
    const remove = asStringArray(args.removeReferenceIds);
    const sizeOf = (id: string) => byId.get(id);
    const edit = page
      ? placeOnPage({ elements, pages, page, add, remove, sizeOf })
      : placeOnBoard({ elements, page: room, add, remove, sizeOf });

    /// The lines, against the scene the pictures left behind — so a line added in
    /// the same call as a photograph is set above the board as it now stands
    /// rather than above the board as it was.
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

    /// A page named in the same call that puts something on it. The name is a
    /// string on the frame and the pictures are elements beside it, so both ride
    /// the one write — dropped here, this branch would answer "done" to a call
    /// whose rename never happened, which is the one thing an answer must not do.
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

    /// The same refusal the rebuild makes, and it is worth making twice: a board
    /// with nothing on it is not a board, and there is no undo on this side of
    /// the wire for the user to reach for. Scoped to the page when the edit
    /// was, for the same reason the rebuild's is — the pictures on the board's
    /// other pages are not what this call would have emptied.
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
    /// Guarded on the revision that was read, as every server-side write to a
    /// board is. `renderRevision` goes because the stored picture is of a board
    /// with a different set of photographs on it; `layout` and the page size stay,
    /// because putting a picture on a board is not a reshape of it.
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
        /// The page it landed on, in the answer, on the same terms the compose
        /// reports its own: this is the id `inspect_board` reads that page by,
        /// and on a spread it is the only thing that says *where* on the board a
        /// picture went.
        ...(pageAfter && { page: { pageId: pageAfter.id, name: pageAfter.name } }),
        ...(edit.added.length && { added: edit.added }),
        ...(edit.removed.length && { removed: edit.removed }),
        ...(text.added.length && { linesAdded: text.added }),
        ...(text.removed.length && { linesRemoved: text.removed }),
        /// Said in the answer because the model could not have known it before
        /// the call: it asked for a rebuild's argument and got a scene edit, and
        /// the one thing it must not report is that the board was laid out again.
        status: pageAfter
          ? `done as a scene edit on ${pageSaid(pageAfter)} — that page is arranged by hand rather than by a template, so nothing already on it moved and it was not laid out again. A picture put on it went in under what was already there and a line went above it, both kept inside the page${pages.length > 1 ? `, and the board's other ${pages.length - 1} ${pages.length === 2 ? "page is" : "pages are"} untouched` : ""}. If they wanted that page laid out again, call compose_moodboard for it with a layout and that pageId`
          : "done as a scene edit — that board is arranged by hand rather than by a template, so nothing already on it moved and it was not laid out again. A picture put on it went in under what was already there and a line went above it. If they wanted the whole board laid out again, call compose_moodboard for it with a layout",
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

  /// The last step of the crop→board loop, and the one that had been going
  /// through a rebuild.
  ///
  /// `LOOSE_IN_SLOT_NOTE` sends the orchestrator to a crop and then back to the
  /// board with the cut, and until now "back to the board" meant
  /// `compose_moodboard` with add/remove — which pays the compositor to reassign
  /// every slot and hands back an arrangement nobody asked for. A replacement has
  /// no assignment left to decide: the cut goes where the frame was. So this is a
  /// scene edit, with no model call, no run row and nothing on the board moved
  /// except the box that had to.
  ///
  /// The same is true of two pictures already on the board changing places: the
  /// user has named both ends of the move, so a rebuild would be buying an
  /// assignment they just made themselves.
  async function swapPictures(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project: the id is a model argument, so it is checked
    /// rather than trusted, exactly as the rebuild's read is.
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

    /// The ceiling is a legibility one, so it truncates rather than refusing —
    /// but what it cut off is named. A call asking for six exchanges used to make
    /// four and answer with a list of four under a status reading "done", so two
    /// cuts the user had taken never reached the board and the reply said they
    /// had. A bound nobody is told about is indistinguishable from work that was
    /// never asked for.
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

    /// Scoped to one page when the call names one (§V). A reference can be on two
    /// pages of a spread, so "take the stairwell off" without a page is answered
    /// by whichever copy the array carries first — a picture on a page the
    /// user was not talking about.
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

    /// A picture the *page* has not got, when the call named one: said as that
    /// rather than as "not on the board", because the board may well hold it a
    /// page away and the next call is then a pageId rather than another id.
    const missing = swap.notOnBoard.length && {
      notOnBoard: swap.notOnBoard,
      ...(onPage && {
        notOnBoardNote: `the read was against ${pageSaid(onPage)} alone — those pictures are not on it, though the board may hold them on another of its pages, so read the page with inspect_board before naming one again`,
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

    /// Guarded on the revision that was read, as every server-side write to a
    /// board is: the user may have the tab open, and the tab that loses gets
    /// its own reload rather than its work silently overwritten. The stored
    /// render is disowned because it is a picture of the board as it was.
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
    /// Whether the exchange actually closed the gap, measured the same way the
    /// compose and the read measure it — page by page, so a swap on page 2 is
    /// answered rather than silently reported as nothing left loose. A cut taken
    /// at the shape the note asked for drops off this list, which is how the loop
    /// is seen to have ended.
    const paged = layout ? pagedLooseFits(items, boardPages(swap.elements), layout) : [];
    /// Scoped to the page the exchange was, the way the read scopes it: gaps on
    /// the board's other pages are not what this call is about, and naming them
    /// hands the user a list of work they did not ask for.
    /// Only a board of more than one page tags its fits with the page they are
    /// on, so on a one-page board every fit is already the named page's.
    const loose =
      onPage && standing.length > 1 ? paged.filter((fit) => fit.pageId === onPage.id) : paged;

    return {
      result: {
        boardId: board.id,
        title: board.title,
        ...(onPage && { page: { pageId: onPage.id, name: onPage.name } }),
        ...(swap.swapped.length && { swapped: swap.swapped }),
        /// Reported apart from `swapped` because it is a different sentence to
        /// the user: nothing joined the board and nothing left it, two
        /// pictures they were already looking at are in each other's places.
        ...(swap.traded.length && { tradedPlaces: swap.traded }),
        status: onPage
          ? `done as a scene edit on ${pageSaid(onPage)} — every other picture on that page is exactly where it was and nothing was laid out again${standing.length > 1 ? `, and the board's other ${standing.length === 2 ? "page is" : "pages are"} untouched` : ", so say the board is otherwise untouched"}`
          : "done as a scene edit — every other picture on that board is exactly where it was and nothing was laid out again, so say that the board is otherwise untouched",
        ...(notFound.length && { notInThisProject: notFound }),
        ...missing,
        ...(swap.alreadyOnBoard.length && { alreadyOnBoard: swap.alreadyOnBoard }),
        ...dropped,
        ...(loose.length && { looseInSlot: loose, looseInSlotNote: LOOSE_IN_SLOT_NOTE }),
      },
      /// The same rule the read door uses, and now the same function: a swap that
      /// refit the cut to its slot leaves the board standing as its template, so
      /// it keeps the name it had; a swap onto a picture the user had moved
      /// does not.
      attachments: [
        boardShown({
          board,
          elements: swap.elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
          pageId: onPage?.id,
        }),
      ],
    };
  }

  /// The text half of the same argument `swapPictures` makes about pictures.
  ///
  /// Rewriting a line used to go through `compose_moodboard`'s
  /// addCaptions/removeCaptions, which is a rebuild — the compositor reassigns
  /// every block, so fixing a typo came back with the photographs in different
  /// slots. On a board with no template of its own that is not even a reshuffle:
  /// the rebuild picks a template by block count and writes it over an
  /// arrangement the user made by hand. Nothing about the wording of a line
  /// is open to judgement, so nothing is asked.
  async function rewordLines(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project: the id is a model argument, so it is checked
    /// rather than trusted, exactly as the swap's read is.
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

    /// Truncated and said, on the same argument the swap makes. Here the silence
    /// is if anything worse: the words the board carries are what the user
    /// reads, so a rewording that was dropped is a typo they were told was fixed
    /// and will find themselves.
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
        unreadableNote:
          "rewordings that named only one end of the pair, so nothing was written — each one needs the line as the board carries it now and what it should say instead, and a line is taken off with compose_moodboard's removeCaptions rather than with a blank",
      }),
    };

    if (!asked.length) {
      return {
        result: {
          error:
            "say which line on the board to rewrite and what it should say instead — to take a line off, use compose_moodboard's removeCaptions",
          ...dropped,
        },
      };
    }

    const elements = persistableElements(board.elements);

    /// Scoped to one page when the call names one (§V), on the same argument the
    /// swap is: the pages of a spread carry the same words as often as not — a
    /// heading per page in the same template slot — and a flat match rewrites
    /// whichever the array carries first.
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
        ? `that wording is not on ${pageSaid(onPage)} — the board may say it on another of its pages, so read the page with inspect_board and quote the line as that page carries it, or leave the pageId out to reword wherever it is`
        : "that wording is not on the board — read it with inspect_board and quote the line as the board carries it",
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

    /// Guarded on the revision that was read, as every server-side write to a
    /// board's scene is. The stored render is disowned because it is a picture of
    /// the board with the old words on it — the one difference from a rename,
    /// which touches the title column and leaves the document alone.
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
      /// The same tile the read and the swap draw, by the same rule: a reword
      /// moves no picture, so a board standing in its template still is.
      attachments: [
        boardShown({
          board,
          elements: edit.elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
          pageId: onPage?.id,
        }),
      ],
    };
  }

  /// A picture carried from one page of a board to another (§V).
  ///
  /// The third of the free scene edits, and the one the page entity made
  /// necessary: `swapPictures` puts a picture in the *place of* another and
  /// `placeOnPage` puts one on a page it is not on, and neither of them answers
  /// "put the stairwell on the second page instead" — a swap scoped to the
  /// target page leaves the copy on the source page standing, so the board comes
  /// back holding the photograph twice while the answer reports one exchange.
  /// A rebuild of both pages is the only other route and it reassigns every slot
  /// on both in order to move one picture.
  ///
  /// No model call and no `AgentRun` row: which page a picture goes on is the
  /// user's decision, not a judgement to buy, and where it lands on that page
  /// is the same rule a joining picture already follows.
  async function movePictures(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project like every other read here: the id is a model
    /// argument, so it is checked rather than trusted.
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

    const askedFrom = typeof args.fromPageId === "string" ? args.fromPageId.trim() : "";
    const askedTo = typeof args.toPageId === "string" ? args.toPageId.trim() : "";
    const from = askedFrom ? pageById(standing, askedFrom) : null;
    const to = askedTo ? pageById(standing, askedTo) : null;

    /// Both ends refused in one answer with the ids that would have worked, as
    /// every page refusal in this file is: a page id the model guessed at costs
    /// one round, and two if the refusal sends it guessing again.
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
                pagesNote:
                  "that board has no pages on it — it is a canvas the user arranged, so there is nowhere to move a picture to. Call add_page to draw its first page around what it already holds",
              }),
        },
      };
    }

    if (from.id === to.id) {
      return {
        result: {
          error: `${pageSaid(from)} is both ends of that move — name the page they are to go on as toPageId, or add_page first if it does not exist yet`,
          pages: pageDigests(elements),
        },
      };
    }

    /// Truncated and said, on the swap's own argument: a bound nobody is told
    /// about is indistinguishable from work that was never asked for, and here
    /// what is dropped is a photograph the user was told had moved.
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

    /// A picture the *source page* has not got: said as that rather than as "not
    /// on the board", because the board may well hold it a page away and the next
    /// call is then a different fromPageId rather than another reference id.
    const missing = move.notOnFrom.length && {
      notOnThatPage: move.notOnFrom,
      notOnThatPageNote: `the read was against ${pageSaid(from)} alone — those pictures are not on it, though the board may hold them on another of its pages, so read the board with inspect_board before naming a page again`,
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

    /// Guarded on the revision that was read, as every server-side write to a
    /// board is. The stored render is disowned: it is a picture of two pages that
    /// no longer hold what it shows.
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

    /// The page a picture joined is no longer the arrangement its template
    /// composed — the newcomer is below the slots, not in one. Said only when the
    /// page *was* standing, since that is the only case where laying it out again
    /// is an offer rather than a second rearrangement of a board the user
    /// made by hand.
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
        /// Named and on the source page and already on the target: it came off
        /// the one and was not drawn twice on the other, which is a different
        /// sentence to the user from "it moved".
        ...(move.alreadyThere.length && {
          alreadyThere: move.alreadyThere,
          alreadyThereNote: `${pageSaid(to)} already carried ${move.alreadyThere.join(", ")}, so ${move.alreadyThere.length === 1 ? "that copy" : "those copies"} came off ${pageSaid(from)} and nothing was drawn twice`,
        }),
        ...(wasComposed && {
          layoutNote: `${pageSaid(to)} was standing exactly as ${layout?.id ?? "its template"} composed it and now carries a picture below the slots — offer to lay that page out again with compose_moodboard, and do not do it without asking`,
        }),
        ...(dropped || {}),
      },
      /// The page the pictures landed on: that is what changed shape, and a
      /// user reading "it is on act two now" beside a miniature of the whole
      /// spread is being shown the page the sentence is not about.
      attachments: [
        boardShown({
          board,
          elements: move.elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
          pageId: to.id,
        }),
      ],
    };
  }

  /// The read every canvas tool starts with, scoped to the project like every
  /// other board read here: the id is a model argument, so it is checked
  /// rather than trusted.
  async function canvasBoard(args: Record<string, unknown>) {
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
    return { boardId, board };
  }

  /// The geometric read of a board (§XI): every object with the handle the four
  /// canvas edits take. `inspect_board` answers what a board holds; this
  /// answers where each thing is and by what id — so it is the read those
  /// edits' declarations send the model to first.
  async function readCanvas(args: Record<string, unknown>): Promise<ToolOutcome> {
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
    };
  }

  /// Objects put where the user said (§XI): a named thing at a named place is a
  /// scene edit, not a rebuild — `compose_moodboard` is for arranging a set.
  async function putOnCanvas(args: Record<string, unknown>): Promise<ToolOutcome> {
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
      attachments: [
        boardShown({
          board,
          elements: edit.elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        }),
      ],
    };
  }

  /// Objects taken off a board with everything else left standing (§XI). The
  /// removal drops elements from the array — the existing convention — and
  /// nothing leaves the project.
  async function removeFromCanvas(args: Record<string, unknown>): Promise<ToolOutcome> {
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
      attachments: [
        boardShown({
          board,
          elements: edit.elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        }),
      ],
    };
  }

  /// Moves, rotations and resizes as pure geometry (§XI): the rules — page
  /// rotation refused, rigid groups, locked refused, aspect kept — live in the
  /// pure module; this is the plumbing around it.
  async function transformOnCanvas(args: Record<string, unknown>): Promise<ToolOutcome> {
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
      attachments: [
        boardShown({
          board,
          elements: edit.elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        }),
      ],
    };
  }

  /// Stacking changed and nothing moved (§XI). The declaration flattens the
  /// module's union destination into three sibling fields, so this is where
  /// `{ to?, above?, below? }` becomes front/back/{above}/{below} — and a move
  /// naming none or two of them is answered, never guessed at.
  async function reorderOnCanvas(args: Record<string, unknown>): Promise<ToolOutcome> {
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
      attachments: [
        boardShown({
          board,
          elements: edit.elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
          pageId: onPage?.id,
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
      /// Counted off the same read the other three are, over the cuts as well as
      /// the photographs: a project whose every picture this assistant drew is
      /// one where "prefer what they have" is advice about nothing.
      generated: all.filter((reference) => isGeneratedOrigin(reference.origin)).length,
    };
  }

  return {
    state: projectState,

    async declarations() {
      return orchestratorTools(await projectState());
    },

    async brief() {
      /// Three reads rather than one, because they answer different questions
      /// and only one of them is asked on every turn's tool calls. Asked
      /// together: they do not depend on each other, so the turn waits for the
      /// slowest rather than for the sum.
      const [{ all, photos }, filed, named] = await Promise.all([
        references(),
        boards(),
        project(),
      ]);

      return [
        /// First. The catalog is a list of what the user has; this is what
        /// they have it *for*, and every line under it is read against it.
        named ? directorBrief(named) : "",
        catalogBrief(photos, { crops: all.length - photos.length }),
        boardsBrief(
          filed.map(({ id, title, widthPx, heightPx, layout, pageCount, pageNames }) => ({
            id,
            title,
            width: widthPx,
            height: heightPx,
            layout,
            pages: pageCount,
            pageNames,
          })),
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
    },

    /// The pages the user picked, as the model reads them (§V.4–5).
    ///
    /// The client is authoritative for the *picture* — only a canvas can draw one
    /// — and for nothing else. Everything said about the page is built here, from
    /// the stored scene and this project's own rows, so what the model was shown
    /// is a function of what the server holds and can be replayed from the row.
    ///
    /// A page it cannot stand behind is dropped rather than described: a board
    /// belonging to another project is not found by the read below, and an id
    /// naming no page on the board it does name has no rectangle to take a share
    /// of. Silently, because this is the user's own selection box rather than
    /// a model argument — there is no one in the loop to tell.
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

        /// The picture rides only when it is of the board as it now stands *and*
        /// when it is the object this server would have signed for. A stale
        /// picture is worse than no picture, and a uri the browser chose is a
        /// file part pointing wherever it liked.
        /// The uri this server would have signed is derived only when there is
        /// one to hold against it: a page that went up without a picture is the
        /// ordinary case on a board being edited, and it should not go asking
        /// where the picture of it would have been.
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

        const items = boardItems(elements);
        /// §V.4's `layout?` is "the template, if composed" — a claim about the
        /// page in front of the model, not about the row. The board carries one
        /// template id describing its first page, so on a spread it is as often
        /// as not the wrong word for the page attached: a page `add_page` drew,
        /// a page composed at another template, or one the user has pulled
        /// apart since. Asked of the page, it is dropped in all three, and the
        /// model reads an arrangement out of the boxes below rather than out of
        /// a template name that does not describe them.
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
          /// Crops are in unless they are asked out: the tool is the door to
          /// every picture, and a cut left out of an answer that says it lists
          /// the project reads as a cut that does not exist.
          const catalog = referenceCatalog(args.includeCrops === false ? photos : all);
          /// A cut filed a moment ago is as unread as a photograph uploaded a
          /// moment ago, and this is the only door that lists cuts — so the mark
          /// the brief carries needs its sentence here too, and only when
          /// something in this answer is marked.
          const unread = catalog.references.some((digest) => digest.unread);
          return { result: { ...catalog, ...(unread && { unreadNote: UNREAD_CATALOG_NOTE }) } };
        }

        /// Resolved against every reference, crops included: a cut the model was
        /// given by an earlier call is a picture the user may well want to
        /// look at, whether or not this turn asked for crops in the catalog.
        case SHOW_REFERENCES.name: {
          const { found, missing, overLimit } = pickReferences(
            all,
            asStringArray(args.referenceIds),
          );
          return {
            result: {
              shown: found.map((reference) => reference.id),
              /// Named separately from `shown` so the model can say so. A silent
              /// difference between what it asked for and what appeared is a
              /// reply that describes pictures the user cannot see.
              ...(missing.length && { notFound: missing }),
              /// The other half of that difference, and the one the model cannot
              /// work out for itself: these ids are real, they are simply past
              /// what one reply may carry.
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

        /// Queued with the board writes, because it is one now: a crop for a
        /// board cuts *and* swaps in the one call, and two unqueued edits of one
        /// board in a round collide the way `boardEdits` describes. A crop that
        /// names no board takes the empty key and runs straight away, so two
        /// vision calls still go side by side.
        case CROP_REFERENCE.name:
          return boardEdits.run(boardKey(args), () => makeCrop(args));

        /// Not queued on `boardEdits`: it writes no scene, and a picture being
        /// drawn while a board is being rearranged is two things happening at
        /// once on purpose — the round after this one is where they meet.
        case GENERATE_IMAGE.name:
          return makePicture(args);

        case INSPECT_BOARD.name:
          return inspectBoard(args);

        /// Unqueued with the other read: it writes nothing, and the tile it
        /// draws is a question rather than a report — a discard the user has
        /// not taken yet is not made wrong by a swap landing behind it.
        case DISCARD_BOARD.name:
          return offerDiscard(args);

        /// Unqueued for the same reason, and it is not a board edit at all — the
        /// row it is about is a picture, and the boards it reads it only reads to
        /// say what the removal would cost them.
        /// Unqueued for the same reason a board's discard is: it writes
        /// nothing, and a page the user has not thrown away yet is not made
        /// wrong by a swap landing on another page behind it.
        case DISCARD_PAGE.name:
          return offerPageDiscard(args);

        case DISCARD_REFERENCE.name:
          return offerReferenceDiscard(args);

        /// The four doors that write to a board, each queued behind whatever
        /// else this turn is already doing to the same one. `inspect_board` is
        /// deliberately not queued: it changes nothing, and making a read wait on
        /// a compositor call would be a turn that answers slower for no gain.
        ///
        /// A copy writes to a board nobody else can be holding — but it *reads*
        /// the one it is copying, and "fix the typo and then give me a version
        /// with the tall shot" is one round. Queued on the source, so the copy is
        /// of the board as the turn leaves it rather than as it found it.
        case DUPLICATE_BOARD.name:
          return boardEdits.run(boardKey(args), () => copyBoard(args));

        /// Queued with the other writes to the board it names: it is a page
        /// arriving on the same scene a compose in the same turn is rewriting,
        /// and where it goes is read off the pages that scene holds.
        case ADD_PAGE.name:
          return boardEdits.run(boardKey(args), () => addBoardPage(args));

        /// Queued on the board it copies *within*: unlike a board's copy, which
        /// writes to a row nobody else can be holding, this one writes back to the
        /// same scene it read — so a swap landing between the read and the write
        /// would be a copy of a page as the turn found it rather than as it leaves
        /// it, and the revision guard would throw the copy away.
        case DUPLICATE_PAGE.name:
          return boardEdits.run(boardKey(args), () => copyPage(args));

        /// Queued with the other writes to the board it names: the rectangle it
        /// rewrites is on the same scene a compose or a swap in the same turn is
        /// rewriting, and which pictures the resize takes in or leaves beside the
        /// page is read off that scene as the turn leaves it.
        case RESIZE_PAGE.name:
          return boardEdits.run(boardKey(args), () => resizeBoardPage(args));

        case SWAP_ON_BOARD.name:
          return boardEdits.run(boardKey(args), () => swapPictures(args));

        case REWORD_ON_BOARD.name:
          return boardEdits.run(boardKey(args), () => rewordLines(args));

        /// Queued with the other writes to the board it names: it rewrites the
        /// same scene a compose or a swap in the same turn is rewriting, and both
        /// pages it reads are read off that scene.
        case MOVE_TO_PAGE.name:
          return boardEdits.run(boardKey(args), () => movePictures(args));

        /// Deliberately unqueued, like `inspect_board`: it writes nothing, and
        /// a read that waits on a compose answers slower for no gain.
        case READ_CANVAS.name:
          return readCanvas(args);

        /// The four canvas edits rewrite the same scene every other board
        /// write does, so each queues behind whatever this turn is already
        /// doing to the board it names.
        case PUT_ON_CANVAS.name:
          return boardEdits.run(boardKey(args), () => putOnCanvas(args));

        case REMOVE_FROM_CANVAS.name:
          return boardEdits.run(boardKey(args), () => removeFromCanvas(args));

        case TRANSFORM_ON_CANVAS.name:
          return boardEdits.run(boardKey(args), () => transformOnCanvas(args));

        case REORDER_ON_CANVAS.name:
          return boardEdits.run(boardKey(args), () => reorderOnCanvas(args));

        case COMPOSE_MOODBOARD.name:
          return boardEdits.run(boardKey(args), () => makeMoodboard(args));

        default:
          return { result: { error: `no tool called ${name}` } };
      }
    },
  };
}

/// A whole board's contents in the shape a page's come back in, so the report
/// that describes either is written once. Nothing on a board can be clipped —
/// only a page has an edge to be cut off at.
function wholeBoard(elements: readonly SceneElement[]) {
  const { pictures, lines, unnamedImages } = boardContents(elements);
  return {
    pictures: pictures.map((referenceId) => ({ referenceId, clipped: false })),
    /// A board with no page has no page to stand behind: a background is a
    /// picture covering a rectangle, and this branch is the one with no
    /// rectangle in it.
    background: null,
    lines,
    unnamedImages,
  };
}

/// The pages of a board named in an answer that is about the whole of it — the
/// copy made of it, the discard offered on it.
///
/// Both of those are board-shaped acts in a product that is pages now, and both
/// were answering as though a board were one: "1 photograph · 1920×1080" for a
/// three-page spread names neither what the copy can be worked on a page at a
/// time by, nor what the discard would actually cost. Free to say — the elements
/// are already read and `pageDigests` is the same list `inspect_board` gives.
///
/// Said only on a board of more than one page, the rule the derived page reports
/// already follow: on a board of one, the page *is* the board, and its digest
/// repeats the pictures, the lines and the size that are already in the answer.
function boardPagesSaid(elements: readonly SceneElement[], note: string) {
  const pages = pageDigests(elements);
  return pages.length > 1 ? { pages, pagesNote: note } : {};
}

/// A page as the answers that make or change one report it: which page of how
/// many, and the rectangle it now stands at with the label that rectangle earns.
/// The position is read off the pages *in reading order*, so a page is numbered
/// the way the user counts it rather than by where its frame sits in the array.
function pageSized(page: BoardPage, inReadingOrder: readonly BoardPage[]) {
  return {
    pageId: page.id,
    name: page.name,
    position: inReadingOrder.findIndex((other) => other.id === page.id) + 1,
    of: inReadingOrder.length,
    size: `${page.width}×${page.height}`,
    preset: page.preset,
  };
}

/// A page as it is named in a sentence to the model. Quoted when it has a name,
/// because the user's own word for a page is what they will hear it called
/// back — and a page frame carries no name at all until one is set on it.
function pageSaid(page: BoardPage) {
  return page.name ? `“${page.name}”` : "that page";
}

/// What a rename changed, said as the two things it can be. Both at once is one
/// call the user made — "call it Act two and the page Exteriors" — and a
/// status naming only one of them reads as the other having been refused.
function renamedSaid({ title, page }: { title: string; page: string }) {
  if (title && page) return `renamed — the board is now “${title}” and its page “${page}”`;
  return page ? `that page is now called “${page}”` : "renamed";
}

/// The same page as the *tile* names it: where it falls in the board's reading
/// order, which is how the user counts pages. Off the scene rather than off
/// the plan the compose made, so a page that was just added is counted like the
/// ones that were already there.
function pageShown(elements: readonly SceneElement[], page: BoardPage) {
  const standing = pagesInReadingOrder(boardPages(elements));
  return {
    name: page.name,
    position: standing.findIndex((other) => other.id === page.id) + 1,
    of: standing.length,
  };
}

/// Arguments arrive as whatever the model emitted. A list of ids that came back
/// as a bare string, or with a number in it, is a malformed call rather than a
/// crash — the model is told what it found and gets to try again.
function asStringArray(value: unknown) {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/// What a compose writes to `Moodboard.layoutSlots`: the geometry when the page
/// was read off a layout image, and an empty column when it was one of the
/// templates.
///
/// Cleared rather than left standing, because the column is the whole of what
/// `CUSTOM` means — a board put back on a template while the geometry it was
/// drawn from stayed on the row is a page nobody is looking at, waiting for a
/// later reader that resolves the slots before the id.
function layoutSlotsWritten(layout: MoodboardLayout) {
  return layout.id === CUSTOM_LAYOUT
    ? (customLayoutColumns(layout) as Prisma.InputJsonValue)
    : Prisma.DbNull;
}

/// Placements in the order the board reads, which is the order the template
/// lists its slots in. A pinned edit builds the arrangement out of two lists —
/// what stayed and what was just placed — and only the template knows how they
/// interleave.
function inSlotOrder(layout: MoodboardLayout, placements: readonly Placement[]): Placement[] {
  const order = new Map(layout.slots.map((slot, index) => [slot.id, index]));
  return [...placements].sort(
    (a, b) => (order.get(a.slot.id) ?? 0) - (order.get(b.slot.id) ?? 0),
  );
}

/// A swap is the one argument in this file that is a *pair*, and the pairing is
/// why it is an object rather than two arrays: two lists the model has to keep
/// aligned is the mistake `layoutBlocks` already had to name caption ids around,
/// and a misaligned pair here would put the wrong cut in the wrong place silently.
/// Half a pair is dropped rather than guessed at — and counted, because a pair
/// dropped without a word is an exchange the user asked for, did not get, and
/// was told was done.
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

/// A rewording is a pair for the same reason a swap is: two parallel arrays of
/// wordings would misalign into a line that reads as correct whichever way it was
/// meant, and here the mistake is written onto the board in words the user
/// then has to spot.
///
/// A blank `to` is dropped rather than treated as a deletion — taking a line off
/// a board reflows the rest of it, which is `compose_moodboard`'s job and not a
/// scene edit's. Counted for the same reason a half swap is: the only thing worse
/// than not rewriting a line is not rewriting it and saying nothing.
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
