import "server-only";
import {
  COMPOSE_MOODBOARD,
  CROP_CALL_LIMIT,
  CROP_REFERENCE,
  DISCARD_BOARD,
  DISCARD_REFERENCE,
  DUPLICATE_BOARD,
  INSPECT_BOARD,
  LIST_REFERENCES,
  READ_LIMIT,
  READ_REFERENCES,
  REWORD_LIMIT,
  REWORD_ON_BOARD,
  SHOWN_LIMIT,
  SHOW_REFERENCES,
  SWAP_LIMIT,
  SWAP_ON_BOARD,
  UNREAD_CATALOG_NOTE,
  attachmentOf,
  boardAttachmentOf,
  boardsBrief,
  catalogBrief,
  directorBrief,
  cropAttachmentOf,
  orchestratorTools,
  pickReferences,
  referenceCatalog,
  referenceDigest,
  unreadReason,
  type ProjectState,
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
import {
  boardReferenceUsage,
  referenceUsageIndex,
  removalUsage,
  type UsingBoard,
} from "@/lib/references/reference-usage";
import {
  CROP_ASPECT_IDS,
  LOOSE_SHAPE_IDS,
  cropShapeOf,
  looseShapeOf,
  versionDescendants,
} from "@/lib/references/reference-version";
import { cropReference } from "@/server/agents/cropper";
import { MODELS } from "@/server/google/vertex";
import { spentColumns, usageThrown } from "@/lib/agent/model-cost";
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
import {
  layoutById,
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
  scenePlacements,
  slotShapeFor,
  standsAsComposed,
} from "@/lib/layout/slot-fit";
import { boardContents, boardItems } from "@/lib/boards/board-contents";
import { boardPages, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { swapOnBoard, type SwapRequest } from "@/lib/boards/board-swap";
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
import { boardRenderIsCurrent } from "@/lib/scene/moodboard-render";
import { boardRenderGcsUri, copyBoardRender } from "@/server/moodboards/render";
import { blockBrief, composeMoodboard } from "@/server/agents/compositor";
import { forDisplay } from "@/server/references/display";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/// The seam agents 2-5 hang off: a toolset is a set of declarations to hand the
/// model and the one function that runs whatever it calls.
///
/// Assembled per request, closed over the project it is allowed to touch. That
/// is the whole access control story — a tool cannot be talked into reading
/// another director's project, because the id it reads is not an argument the
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
  /// The star. One boolean, and it is the only column here the *director* wrote —
  /// everything else was read off the pixels or typed by the uploader. It also
  /// decides `GALLERY_ORDER`, so without it the model is handed a list whose
  /// ordering encodes a fact it cannot see.
  isFavorite: true,
  gcsUri: true,
  thumbGcsUri: true,
  source: { select: { id: true, title: true } },
  analysis: {
    select: {
      colorPalette: true,
      lighting: true,
      texture: true,
      composition: true,
      subject: true,
      contrastDepth: true,
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
  "the property analyzer has not read these yet, so they were arranged on shape alone and not on their look — tell the director the board can be laid out again once the tags land, and do not describe what these pictures are of";

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
/// commonest turn — a director talking about pictures uploaded yesterday — pays
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
};

type ReferenceRow = {
  id: string;
  title: string;
  width: number | null;
  height: number | null;
  editIntent: string;
  editAspect: string;
  isFavorite: boolean;
  gcsUri: string;
  thumbGcsUri: string | null;
  source: { id: string; title: string } | null;
  analysis: {
    colorPalette: string[];
    lighting: string[];
    texture: string[];
    composition: string[];
    subject: string[];
    contrastDepth: string[];
  } | null;
};

/// Filing a job for agent 2 and waking a worker for it — the two things
/// `read_references` does, as one seam a test can hold.
export type AnalyzerQueue = {
  enqueue: (job: { projectId: string; referenceId: string }) => Promise<unknown>;
  /// Answers whether a worker was woken. The jobs are already filed by the time
  /// this is called, so "could not wake one" is a different sentence from "could
  /// not file one" — and only the first is a reason to promise the director
  /// tags in a moment.
  kick: () => Promise<boolean>;
};

function analyzerQueue(db: PrismaClient): AnalyzerQueue {
  return {
    async enqueue(job) {
      const { enqueueAnalysis } = await import("@/server/agents/analysis-queue");
      return enqueueAnalysis(db, job);
    },
    /// Awaited by the caller rather than left floating: `kickAnalyzerWorker`
    /// registers work with `after()`, which has to be reached from inside the
    /// request — and awaiting the import is what keeps it there.
    async kick() {
      const { kickAnalyzerWorker } = await import("@/server/agents/analysis-queue");
      return kickAnalyzerWorker();
    },
  };
}

/// Gallery order, matching what the director is looking at while they talk: a
/// model answering "the second one" and a director counting tiles have to be
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
  /// Agent 2's queue, injected — and loaded on use rather than imported, because
  /// `analysis-queue` reaches for the real database and for `after()` at module
  /// load, and this file is exercised against a fake one.
  queue = analyzerQueue(db),
  /// The bucket copy a duplicated board's picture is inherited by, injected for
  /// the plainer reason that it is the one thing in this file that touches GCS —
  /// and it reads the environment to name the object, which a test has none of.
  /// Answers with the copy's `gs://` uri.
  copyRender = async (sourceBoardId: string, targetBoardId: string) => {
    await copyBoardRender(projectId, sourceBoardId, targetBoardId);
    return boardRenderGcsUri(projectId, targetBoardId);
  },
}: {
  db: PrismaClient;
  projectId: string;
  compose?: typeof composeMoodboard;
  crop?: typeof cropReference;
  queue?: AnalyzerQueue;
  copyRender?: (sourceBoardId: string, targetBoardId: string) => Promise<string>;
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

  /// The project's boards, in the four small columns a brief names them by —
  /// never `elements`, which is megabytes a turn that never mentions a board
  /// would pay for. Read lazily and once, like the references, because both the
  /// brief and the declarations ask the same question of it.
  let boardRows: Promise<BoardRow[]> | null = null;

  function boards() {
    boardRows ??= db.moodboard.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, widthPx: true, heightPx: true, layout: true },
    });
    return boardRows;
  }

  /// What the director called this project and what they wrote it was for. Two
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

  /// Boards filed by `compose_moodboard` or `duplicate_board` during this turn.
  /// The declarations are resolved per round, and the round after the first board
  /// is filed is the one on which it can be read or swapped on — counting it here
  /// is what makes that true without re-reading the table.
  let boardsFiled = 0;

  /// What those boards were called. The boards read is taken once per turn, so a
  /// second copy made in the same turn would otherwise be named against a list
  /// that has never heard of the first — two tabs called "Act two (copy)".
  const titlesFiled: { title: string }[] = [];

  /// Vision calls spent this turn. The counter is per toolset, and a toolset is
  /// per request, so this bounds one exchange rather than one round — a model
  /// given three rounds could otherwise ask for the same crop in each of them.
  let cropsAsked = 0;

  /// Pictures handed to agent 2 this turn. A set rather than a count, because it
  /// does two jobs: it is the ceiling `READ_LIMIT` bounds, and it is what stops a
  /// model naming one picture in two rounds from buying two readings of it — the
  /// shared reference read is taken once per turn, so the marks it carries do not
  /// learn about a job this turn filed.
  const readAsked = new Set<string>();

  /// One edit at a time per board, for the length of this turn.
  ///
  /// Every write below is a read, a decision and a revision-guarded write, and
  /// the orchestrator runs a round's tool calls with `Promise.all` — so "swap
  /// those two around and fix the typo in the headline" ran both edits against
  /// the same revision, landed one of them, and answered the other with "that
  /// board was changed while I was editing it — the director has it open". The
  /// director had done nothing; the turn had collided with itself, and the edit
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

  /// Agent 2 as an agent-tool — the only one that does not wait for its agent.
  ///
  /// The analyzer is a queue: a job is an `AgentRun` row a worker claims out of
  /// band, so what this tool does is file jobs and wake a worker. Nothing in the
  /// answer carries tags, and the status says so, because the alternative is a
  /// reply describing a look nobody has read yet — the exact failure the unread
  /// marks were added to prevent.
  ///
  /// It exists because the marks had no door. A picture whose reading failed, or
  /// that predates the queue, was described to the model as unreadable-on-its-own
  /// with the only remedy being the director opening the properties panel — a
  /// capability the assistant could see, name, and not reach.
  async function readPictures(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { all } = await references();
    const asked = asStringArray(args.referenceIds);
    if (!asked.length) return { result: { error: "name the pictures to have read, by their ids" } };

    const { found, missing, overLimit } = pickReferences(all, asked, READ_LIMIT);

    const queued: string[] = [];
    const alreadyQueued: string[] = [];
    const alreadyRead: string[] = [];
    const overBudget: string[] = [];
    const couldNotQueue: string[] = [];

    /// Decided off the same marks the model was shown, rather than off a second
    /// read of the analyzer's rows. That is what makes the answer explicable —
    /// an id it was told is "never read" is one this queues — and it costs no
    /// query: a picture with no mark has been read, and "pending" is the queue
    /// saying a job for it already exists. The one thing the marks cannot see is
    /// a job the *director* filed from the panel during this turn, which costs a
    /// duplicate reading of one picture and nothing else.
    for (const reference of found) {
      /// Tags are the evidence it was read, and re-reading a picture that has
      /// them is a vision call that answers a question already answered.
      if (!reference.unread) {
        alreadyRead.push(reference.id);
        continue;
      }
      if (readAsked.has(reference.id) || reference.unread === "pending") {
        alreadyQueued.push(reference.id);
        continue;
      }
      if (readAsked.size >= READ_LIMIT) {
        overBudget.push(reference.id);
        continue;
      }
      /// Per picture rather than around the loop: filing five jobs and failing
      /// on the sixth is five pictures on their way, and a throw here would
      /// report all six as untouched — which is the model's cue to ask again
      /// next turn and buy the first five a second reading.
      try {
        await queue.enqueue({ projectId, referenceId: reference.id });
      } catch (cause) {
        console.error("could not file an analyzer job:", cause);
        couldNotQueue.push(reference.id);
        continue;
      }
      readAsked.add(reference.id);
      queued.push(reference.id);
    }

    /// Woken whether or not anything was filed, for the reason the panel's own
    /// ask gives: a run left RUNNING by a worker that died is reclaimed once its
    /// lease is up, so an already-queued picture is one that needs a worker
    /// rather than another job.
    const reading = found.filter(
      (reference) => queued.includes(reference.id) || alreadyQueued.includes(reference.id),
    );
    /// A wake-up that could not be scheduled leaves the jobs exactly where they
    /// are — the scheduled worker (infra.md §XIII) is what empties the queue, so
    /// this is the difference between "in a moment" and "when the worker next
    /// runs", not between filed and lost.
    const woken = reading.length ? await queue.kick() : false;

    /// Both halves of "asked for more than this turn will do", said together
    /// because they are one thing to the model: ids it named that no job was
    /// filed for. A second call next turn is free, so the note asks for one
    /// rather than letting the reply report them as read.
    const notQueued = [...overBudget, ...overLimit];

    return {
      result: {
        queued,
        ...(alreadyQueued.length && { alreadyBeingRead: alreadyQueued }),
        ...(alreadyRead.length && { alreadyRead }),
        ...(missing.length && { notFound: missing }),
        ...(notQueued.length && {
          notQueued,
          notQueuedNote: `only ${READ_LIMIT} pictures are sent to be read in one turn — ask for these in the next message rather than reporting them as read`,
        }),
        ...(couldNotQueue.length && {
          couldNotQueue,
          couldNotQueueNote:
            "these could not be filed with the property analyzer — say so rather than reporting them as sent, and the director can ask again",
        }),
        status: !reading.length
          ? "nothing was sent to be read"
          : woken
            ? "the property analyzer is reading them now, in the background — none of their tags are in this answer, so tell the director they have been sent to be read and that the tags appear on the pictures in a moment, and do not describe what these pictures are of"
            : "they are queued with the property analyzer but no reader could be started just now — none of their tags are in this answer, so tell the director they are waiting to be read rather than being read, do not promise the tags in a moment, and do not describe what these pictures are of",
      },
      /// The pictures on their way, so the director can click one and watch it
      /// arrive: a reference tile opens the gallery at that picture, which is
      /// where the analysis shows up.
      attachments: reading.map((reference) => attachmentOf(reference)),
    };
  }

  /// Agent 3 as an agent-tool, ending at an offer rather than at a row.
  ///
  /// The board agent 4 composes is JSON the server writes; the pixels agent 3
  /// cuts are cut in the browser, on bytes read back same-origin (§II.6). So
  /// this cannot file a version even if it wanted to — what it can do is answer
  /// with the same offer the properties panel's own ask answers with, and let
  /// the click carry it there.
  async function makeCrop(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { all, frames } = await references();
    const referenceId = typeof args.referenceId === "string" ? args.referenceId : "";
    const named = frames.get(referenceId);
    if (!named) return { result: { error: `no reference called ${referenceId} in this project` } };

    /// Named a cut rather than a photograph. That is not a crop of a crop: the
    /// box the director wants changed is already on the frame, so this is asked
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

    /// Any ratio the director said, not one of six names. A format the list does
    /// not name is a format all the same — 5:4 for a print, 2.35:1 for that
    /// scope — and the whole path below already carries a measured label, since
    /// a cut asked for a board is held to the slot's own shape.
    ///
    /// A shape that cannot be read is refused rather than dropped: the model
    /// passed it because the director asked for it, so cutting around the
    /// subject instead would be a cut of the wrong shape under a reply that says
    /// it is the right one. Refused here, before the row and before the
    /// photograph is read, so the correction costs a sentence.
    /// And the shapes with no number in them, which the spec asks for beside the
    /// ratios: a director who says "make it a rectangle" has named a shape and
    /// not a format, so answering with the nearest format is a substitution they
    /// did not ask for. Read first because the two vocabularies do not overlap —
    /// "square" is a word and "1:1" is a ratio — so one argument carries both.
    /// A nudge inherits the shape the row was cut at when the director names
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
          error: `“${asked}” is not a shape a cut can be held to — say it as width:height (${CROP_ASPECT_IDS.join(", ")}, or any ratio the director named such as 5:4), or loosely as ${LOOSE_SHAPE_IDS.join("/")}, or leave it out to frame around the subject`,
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
    /// It is what closes the loop without a third turn: the offer carries the
    /// board, and the browser that files the cut puts it on that board in place
    /// of the frame it came out of. Scoped to the project, since the id is a
    /// model argument, and read before the vision call so an unknown board costs
    /// a sentence rather than a photograph.
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: { id: true, title: true, elements: true, layout: true },
        })
      : null;
    if (boardId && !board) {
      return { result: { error: `no board called ${boardId} in this project` } };
    }
    const scene = board ? persistableElements(board.elements) : [];
    /// A cut can only take the place of a picture that is on the board. Asked for
    /// a frame that is not, the crop is still worth making — the director asked
    /// for it — so it is offered without the board rather than refused, and the
    /// answer says so instead of the swap silently never happening.
    ///
    /// Which picture it replaces is the cut when the board holds the cut, and the
    /// frame when it holds the frame — a nudge is asked of the frame either way,
    /// so the two are different ids the moment the board is standing on a cut.
    const placed = board ? sceneReferenceIds(scene) : [];
    const onBoard = placed.includes(named.id)
      ? named.id
      : placed.includes(frame.id)
        ? frame.id
        : null;
    const forBoard =
      board && onBoard
        ? {
            boardId: board.id,
            title: board.title,
            /// Only when it is not the frame the offer is drawn on: the browser
            /// that takes the cut swaps that frame out by default, so saying it
            /// again would be the same id twice on every ordinary offer.
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
    /// report told it to pass — so a director who asks for a square gets a square
    /// even on a scope-shaped opening. A ratio they named themselves is never one
    /// of the names, so naming a shape the list does not carry is also how they
    /// override the opening.
    ///
    /// A frame whose pixel size was never recorded is left alone: a ratio is a
    /// ratio of pixels, so refining such a frame would turn an ask that works
    /// into the refusal `unfittableAspect` makes above — and it would make it
    /// after the photograph had been read.
    const layout =
      forBoard && board?.layout && frame.width && frame.height ? layoutById(board.layout) : null;
    const opening = layout ? slotShapeFor(boardItems(scene), layout, onBoard ?? frame.id) : null;
    ///
    /// A loose ask refines on the same rule read the same way: the slot replaces
    /// it when the opening is *already* the shape they asked for, so "square for
    /// the board" on a square slot is cut to that slot exactly, and "square" on a
    /// scope strip stays square. The alternative — refining every loose ask —
    /// would answer a word the director chose with a ratio they never named.
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
      return {
        result: {
          error: `you have already offered ${cropsAsked} cuts this turn — ask the director which of them is the one, rather than cropping more frames`,
        },
      };
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
        /// under a reply saying the director's cut had been adjusted.
        ...(nudge && { previous: nudge.previous }),
      });
    } catch (cause) {
      /// A refusal the cropper reached on its third read is the most expensive
      /// thing in this file, so the failed row carries the tokens too — a ledger
      /// that only counts the successes is a ledger that says a bad afternoon
      /// was cheap.
      const carried = usageThrown(cause);
      return fail(
        cause instanceof Error ? cause.message : String(cause),
        carried ? spentColumns(MODELS.PRO, carried) : undefined,
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

    const offer = {
      ...offered.offer,
      ...(forBoard && { forBoard }),
      ...(nudge && { origin: nudge.origin }),
    };
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.SUCCEEDED,
        output: { ...offer, model: answer.model, attempts: answer.attempts },
        finishedAt: new Date(),
        ...spent,
      },
    });

    /// The boards this offer leaves standing on the old picture, when the model
    /// did not name one. With a board there is nothing to say — `forBoard` and
    /// `notOnThatBoard` already answer both ways it can go — so this is the other
    /// branch, which said nothing at all: an offer changes no canvas, and a
    /// picture the director has just asked to be different is still on their
    /// board under a reply that reads as though the board were sorted.
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

    /// The frame, not the id the model passed: a nudge is drawn on the frame it
    /// moved a box across, and a tile drawn on the cut would show the picture the
    /// director is asking to change rather than the one being offered.
    const shown = all.find((reference) => reference.id === frame.id);
    return {
      result: {
        referenceId: frame.id,
        /// Named because the answer is about a different id from the one that was
        /// asked about: the cut is still there and untouched, and a model told
        /// only "referenceId: <frame>" would report the director's cut as having
        /// been changed in place.
        ...(nudge && {
          nudgeOf: `${named.id} is untouched — this is that cut moved, offered as a second cut of ${frame.id}. Say it is an adjustment of their cut, and that taking it leaves the old one in the versions list to delete if they want it gone`,
        }),
        keeps: offer.editIntent,
        why: offer.editRationale,
        ...(offer.aspect && { aspect: offer.aspect }),
        /// Said rather than left to `aspect`, because a loose cut is not held to
        /// a ratio and a reply naming one would be naming a promise nobody made.
        /// The measured shape rides with it so the model can answer "roughly
        /// square, 1.09:1" instead of repeating the word back.
        ...(framed && {
          framedAs: `framed ${framed.wants} rather than held to an exact ratio — the cut came out ${cropOfferShape(offer, frame) ?? "a shape this frame's pixel size was never recorded to measure"}`,
        }),
        size: cropOfferCaption(offer, frame),
        /// Said in the answer, not only in the description: the model is about
        /// to write a sentence about what it just did, and "I cropped it" is a
        /// sentence about a row that does not exist.
        status: forBoard
          ? `offered, not filed — the cut appears beside your reply, and when the director takes it in the reference's properties panel it is put on “${forBoard.title}” in place of ${forBoard.takeOff ? `${forBoard.takeOff}, the cut standing there now` : "this frame"}. Do not call swap_on_board for it: tell them to take the cut and the board follows`
          : "offered, not filed — the cut appears beside your reply and the director takes it in the reference's properties panel",
        /// Asked for a board the frame is not on. The cut still stands; what
        /// cannot happen is the swap, and a model told nothing would report a
        /// board change that never comes.
        ...(board &&
          !onBoard && {
            notOnThatBoard: `${referenceId} is not on “${board.title}”, so this cut will not be put on it — use swap_on_board if the director wants it there`,
          }),
        /// No board was named and the picture this cut replaces is on one. Named
        /// with the call that would close it, because the alternative the model
        /// reaches for on its own is a swap of the picture that already exists —
        /// which lands, looks right, and leaves the offer with nowhere to go.
        ...(alsoOnBoards && { alsoOnBoards }),
        /// Said because it is not the shape that was asked for. The model passed
        /// the nearest name it has and the cut was made to the opening itself, so
        /// a reply quoting the argument back would name a shape the cut is not.
        ...(heldToSlot && {
          heldToSlot: `held to ${offer.aspect}, the exact shape of the ${heldToSlot.slotId} slot on “${forBoard?.title}” rather than to ${aspect ?? loose?.wants ?? "the frame's own subject"} — so it fills that opening with no page showing`,
        }),
      },
      attachments: shown ? [cropAttachmentOf(shown, offer)] : [],
    };
  }

  /// What a board holds, read back off its own scene.
  ///
  /// The one tool here that is a pure read of something the model has already
  /// been told exists. It is here because the alternative was worse than a
  /// missing feature: the boards are primed by id, title and page size, so a
  /// model asked "what is on my board?" could only answer it by calling
  /// `compose_moodboard` — paying a vision-free but real model call *and*
  /// rewriting the arrangement — to find out. A read that costs one query is the
  /// thing that makes that never the right call.
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
          },
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    const elements = persistableElements(board.elements);
    const items = boardItems(elements);
    const { pictures, lines, unnamedImages } = boardContents(elements);

    /// The tags are left off on purpose: the photographs of the project are
    /// already primed into the instruction with theirs, so repeating them here
    /// is the same paragraph bought twice. What a board adds is *which* of them
    /// and in what order.
    const on = pictures.map((id, index) => {
      const reference = byId.get(id);
      if (!reference) {
        /// On the board and no longer in the gallery — deleted out from under
        /// it. Said rather than skipped, because the position it occupies is
        /// what the director is counting when they say "the third one".
        return { position: index + 1, id, gone: true };
      }
      const digest = referenceDigest(reference);
      return {
        position: index + 1,
        id,
        title: digest.title,
        shape: digest.shape,
        ...(digest.croppedFrom && { croppedFrom: digest.croppedFrom }),
        ...(digest.keeps && { keeps: digest.keeps }),
      };
    });

    const thumbUrlOf = (id: string) => byId.get(id)?.thumbUrl;

    /// The same gap `compose_moodboard` reports, for a board nobody just
    /// composed. Reachable now only because the template the board was composed
    /// at is stored on the row: the slot rectangles are constants, and a picture
    /// still sitting where that template put it can be measured against its slot
    /// off the scene alone. Without this the only way to ask "does this board
    /// fit" was to rebuild it — a compositor call that rewrites the arrangement
    /// in order to answer a question about it.
    const layout = layoutById(board.layout);
    const loose = layout ? looseFits(scenePlacements(items, layout)) : [];

    return {
      result: {
        boardId: board.id,
        title: board.title,
        page: `${board.widthPx}×${board.heightPx}`,
        /// The template it was last composed at, not a claim about where things
        /// are now — the director may have dragged half of it since, and the
        /// positions below are read off the scene rather than off this.
        ...(board.layout && { composedAs: board.layout }),
        pictures: on,
        ...(lines.length && { lines }),
        ...(unnamedImages && { imagesNotInThisProject: unnamedImages }),
        /// Silent when there is nothing to say, and silent for a board that has
        /// been rearranged by hand: a picture the director moved off its slot is
        /// not measured against it (see `scenePlacements`).
        ...(loose.length && { looseInSlot: loose, looseInSlotNote: LOOSE_IN_SLOT_NOTE }),
        status:
          "read only — nothing on the board changed. Positions are reading order, so 'the third one' is position 3",
      },
      /// Named by the template while the board is still standing in it, so a
      /// board fetched by a read and the same board fetched by the compose that
      /// made it arrive in the chat under one name — the rule is `boardShown`'s
      /// because three doors now draw this tile.
      attachments: [boardShown({ board, elements, thumbUrlOf })],
    };
  }

  /// A second board holding this one's scene — the copy the director has had a
  /// button for since long before the assistant did.
  ///
  /// Every other board tool in this file changes the board the director is
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
    /// already filed. A title the director asked for wins; an empty one is not a
    /// name, so it falls back rather than filing a board called "".
    const asked = typeof args.title === "string" ? normalizedBoardTitle(args.title) : null;
    const title = asked ?? duplicateBoardTitle([...(await boards()), ...titlesFiled], source.title);

    const copy = await db.moodboard.create({
      data: {
        projectId,
        title,
        widthPx: source.widthPx,
        heightPx: source.heightPx,
        /// Copied, where the director's own duplicate used to drop it: without the
        /// template the copy is a board nobody composed, so `inspect_board` cannot
        /// say what sits loosely on it and a rebuild of it picks a new shape by
        /// block count — a variation of a board that no longer looks like it.
        layout: source.layout,
        elements: elements as unknown as Prisma.InputJsonValue,
        appState: persistedAppState(source.appState) as Prisma.InputJsonValue,
      },
      select: { id: true, title: true },
    });
    boardsFiled += 1;
    titlesFiled.push({ title: copy.title });

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
        page: `${source.widthPx}×${source.heightPx}`,
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
          },
          elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
        }),
      ],
    };
  }

  /// The board the director wants gone — put in front of them with a Discard
  /// button on it, and not deleted.
  ///
  /// This is the second offer in the layer and the first one that is a choice
  /// rather than a mechanism. Agent 3 offers a cut because the pixels are cut in
  /// the browser and the server *cannot* file it (§V); nothing stops the server
  /// deleting this row. What stops it is that a discard is the only act in the
  /// project that nothing can undo — a rebuild replaces an arrangement the
  /// compositor can be asked for again, a swap is a swap back, and a deleted
  /// scene is gone — so the last hand on it is the director's.
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
        /// delete board X" with nothing after it is a question the director
        /// cannot answer without going and looking.
        pictures: pictures.length,
        ...(lines.length && { lines }),
        page: `${board.widthPx}×${board.heightPx}`,
        ...(board.layout && { composedAs: board.layout }),
        status:
          "offered, not done — nothing has been deleted and that board is still in the project. The director has a Discard button beside your reply and it is theirs to press. Say what is on the board they would lose, that the photographs on it stay in the gallery, and that it cannot be undone; never say the board is gone, deleted or removed",
      },
      attachments: [
        boardShown({ board, elements, thumbUrlOf: (id) => byId.get(id)?.thumbUrl, discard: true }),
      ],
    };
  }

  /// The picture the director wants out of the project — put in front of them
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
  /// delete this?" with neither of them said is a question the director answers
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
    /// where a director is clearing out the pictures they just uploaded.
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
        /// director told "the photograph would go" about a crop is being asked
        /// the wrong question.
        ...(named.source && {
          cutOf: `${named.source.id} — this is a cut, and the photograph it was cut from stays in the gallery`,
        }),
        /// The cascade, said as the pictures it is rather than as a number: the
        /// director may have taken one of these cuts an hour ago and will not
        /// connect it to the frame they are removing.
        ...(cuts.length && {
          cutsThatWouldGoWithIt: cuts.map((id) => ({
            id,
            title: byId.get(id)?.title ?? "",
          })),
        }),
        ...(standing.own.length && { onBoards: standing.own }),
        /// Split from the boards showing the picture itself, because it is the
        /// half the director cannot check by looking: a frame kept off every
        /// board while a crop of it holds up two reads as "on no board".
        ...(standing.viaVersions.length && { boardsShowingItsCuts: standing.viaVersions }),
        ...(gapBoards.length && {
          gap: "removing it leaves a hole in those boards — an element with nothing behind it — so say so, and offer to put another picture in its place with swap_on_board afterwards",
        }),
        status:
          "offered, not done — nothing has been deleted and that picture is still in the project. The director has a Remove button beside your reply and it is theirs to press. Say what would go with it and that it cannot be undone; never say the picture is gone, deleted or removed",
      },
      attachments: [attachmentOf(named, { cuts: cuts.length, boards: gapBoards })],
    };
  }

  /// Agent 4 end to end: the references the orchestrator named become blocks, a
  /// template is settled before the call, the compositor says which block goes
  /// where, and deterministic code turns that into a board row.
  ///
  /// The board is filed rather than offered for approval. A moodboard is an
  /// excalidraw scene the director then rearranges — the composed one is a first
  /// draft that exists to be pushed around, and a draft they have to accept
  /// before they can see it is a draft they judge from a description.
  async function makeMoodboard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { all } = await references();
    const intention = typeof args.intention === "string" ? args.intention : "";

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

    /// A rename is not a compose, and until now it was one: "call that board Act
    /// two" reached the compositor, paid for it, and wrote back an arrangement it
    /// had just re-decided — so the director's board changed shape as the price of
    /// changing its name. Nothing here is open to judgement, so nothing is asked.
    if (
      existing &&
      renamesOnly({
        title: named,
        referenceIds: asStringArray(args.referenceIds),
        addReferenceIds: asStringArray(args.addReferenceIds),
        removeReferenceIds: asStringArray(args.removeReferenceIds),
        captions: asStringArray(args.captions),
        addCaptions: asStringArray(args.addCaptions),
        removeCaptions: asStringArray(args.removeCaptions),
        layout: args.layout,
      })
    ) {
      const title = composedBoardTitle(named);
      const changed = title !== existing.title;
      /// The title column alone, unguarded and with no revision bump — the same
      /// write the director's own rename makes. The scene is untouched, so the
      /// revision an open tab is autosaving against still holds, and the stored
      /// render is still a picture of this board rather than of one that no
      /// longer exists.
      if (changed) {
        await db.moodboard.update({ where: { id: existing.id }, data: { title } });
      }

      const byId = new Map(all.map((reference) => [reference.id, reference]));
      return {
        result: {
          boardId: existing.id,
          title,
          /// The one ambiguity this path can be wrong about, answered in the
          /// answer rather than guarded against in the call: "rearrange it and
          /// call it X" with no template named arrives here looking exactly like
          /// a rename. Saying what was and was not done lets the model make the
          /// other call in the same turn instead of reporting a reflow that never
          /// happened.
          status: changed
            ? "renamed — no model call was made, nothing on the board moved and it was not laid out again. If they also asked for it rearranged, call compose_moodboard for that board with a layout"
            : "that board is already called that, so nothing changed",
        },
        attachments: [
          boardShown({
            board: { ...existing, title },
            elements: persistableElements(existing.elements),
            thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
          }),
        ],
      };
    }

    /// tech-spec §III.4 gives agent 4 "all current blocks" as its input, and a
    /// rebuild is where that reading bites: asked to lay their board out again,
    /// the director means the pictures already on it. Read off the scene rather
    /// than guessed at by the model, so "make that a 3×3" costs no round of
    /// naming ids back.
    const onBoard = existing ? persistableElements(existing.elements) : [];
    const items = boardItems(onBoard);

    /// Whether this call names a *change* to what the board holds rather than
    /// restating the whole of it. It decides two different things below, and both
    /// of them are "do not lay this board out again": on a board the director
    /// arranged themselves there is no template to reflow into, and on one still
    /// standing in its template the pictures already on it keep their slots.
    const contentsOnly =
      !!existing &&
      changesContentsOnly({
        referenceIds: asStringArray(args.referenceIds),
        addReferenceIds: asStringArray(args.addReferenceIds),
        removeReferenceIds: asStringArray(args.removeReferenceIds),
        captions: asStringArray(args.captions),
        addCaptions: asStringArray(args.addCaptions),
        removeCaptions: asStringArray(args.removeCaptions),
        layout: args.layout,
      });

    /// A picture or a line put on or taken off a board the director arranged
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
    if (existing && contentsOnly && !standsAsComposed(items, layoutById(existing.layout))) {
      return await editInPlace({ board: existing, elements: onBoard, args, named });
    }

    const edit = boardSelection({
      onBoard: existing ? sceneReferenceIds(onBoard) : [],
      requested: asStringArray(args.referenceIds),
      add: asStringArray(args.addReferenceIds),
      remove: asStringArray(args.removeReferenceIds),
    });
    const selection = edit.selection;
    if (!selection.length) {
      return {
        result: {
          error: edit.removed.length
            ? "that would take every picture off the board — say so rather than leaving them with an empty one"
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
      onBoard: existing ? boardContents(onBoard).lines : [],
      requested: asStringArray(args.captions),
      add: asStringArray(args.addCaptions),
      remove: asStringArray(args.removeCaptions),
    });

    const blocks = layoutBlocks(found, text.lines);
    /// A rebuild keeps the board's own template while it has room for the
    /// pictures. Re-picking from the block count is right for a new board and
    /// wrong for one the director has been looking at — see `layoutForBoard`.
    const { layout, reason: layoutReason } = layoutForBoard({
      stored: existing?.layout,
      requested: args.layout,
      blocks,
    });

    /// References the compositor was never even offered: the block cap bites
    /// before the call, and captions are kept ahead of photographs when it does.
    /// `unplaced` cannot say this — it only knows the blocks that were sent — so
    /// without it a director who named fourteen references is told about the
    /// three the compositor left off and nothing about the two that never
    /// reached it.
    const offered = new Set(blocks.map((block) => block.id));
    const notOffered = [...new Set(selection)].filter(
      (id) => !offered.has(id) && !missing.includes(id),
    );
    /// The same admission about the lines, and it is the commoner one: no
    /// template on the list carries a third line, so a director captioning each
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

    /// What is staying exactly where it is.
    ///
    /// A rebuild asks for an assignment of every block to every slot, and on a
    /// board the director is looking at that re-decides eight placements to answer
    /// a call about one. Worse than untidy: a cut is held to the exact shape of the
    /// opening it was made for (§V), so a reflow that moves it into another slot
    /// throws away the photograph read that made it fit.
    ///
    /// Only when the call names a *change* — "lay it out again" is a rebuild and
    /// this is not consulted for it — only while the template is the one the board
    /// already has, and only while every picture is still sitting in it. Anything
    /// else and the arrangement being kept is not the one on the screen.
    const seats =
      existing && contentsOnly && layoutReason === "kept" && standsAsComposed(items, layout)
        ? keptSeats({ items, layout, blocks })
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
      /// whatever the director took off, which is the whole of the change named.
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
      /// a picture the director named does not fall off a board that has a slot
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

    /// The page the board is composed on (§V.1). A rebuild keeps the page the
    /// board already stands on — its id and the name the director may have
    /// edited — because the arrangement is what a rebuild replaces, not the page
    /// it is drawn on. Its *size* still comes from the template: a board rebuilt
    /// at a 1080×1920 masonry is a tall page whatever it was before.
    const standingPage = pagesInReadingOrder(boardPages(onBoard))[0] ?? null;
    const elements = composedScene(placed, {
      page: {
        ...layout.page,
        ...(standingPage && { id: standingPage.id, name: standingPage.name }),
      },
    });
    /// A rebuild keeps the name the director gave the board. Renaming "Act two
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
          layout: layout.id,
          widthPx: layout.page.width,
          heightPx: layout.page.height,
          elements: elements as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          renderRevision: null,
        },
      });
      if (written.count === 0) {
        const message =
          "that board was changed while I was composing it — the director has it open, so tell them and ask again";
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
      board = await db.moodboard.create({
        data: {
          projectId,
          title,
          /// Recorded so the *next* rebuild has something to keep. A board with
          /// no template on it is one the director dragged together, and that is
          /// exactly the board a rebuild has to choose a template for.
          layout: layout.id,
          widthPx: layout.page.width,
          heightPx: layout.page.height,
          elements: elements as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, title: true },
      });
      /// The project now has a board it did not have when the turn started, so
      /// the next round is handed the tools that read and edit one.
      boardsFiled += 1;
      titlesFiled.push({ title: board.title });
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
    /// orchestrator offer the crop instead of the director noticing it.
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
        /// Only when the board changed shape. A rebuild that keeps the template
        /// needs no sentence about it; one that could not is a second change the
        /// director did not ask for, and the arrangement they were looking at is
        /// gone either way.
        ...(layoutReason === "outgrew" &&
          existing && {
            layoutChanged: `that board was a ${existing.layout} and could not hold ${blocks.length} blocks, so it was laid out as ${layout.id} — tell the director its shape changed`,
          }),
        /// Which of the two things happened, said in the answer rather than left
        /// to the model's memory of what it asked for: "I made you a board" about
        /// a board the director already had is the one sentence a rebuild can
        /// get wrong, and the tab count is what gives it away.
        /// A pinned edit is a third thing and has to say so: the director asked
        /// for one picture and the answer is about one picture, so a reply reading
        /// "I laid your board out again" would describe a change that did not
        /// happen to eight photographs that did not move.
        status: !existing
          ? "filed as a new board"
          : seats
            ? `${seats.joining.length ? "placed what joined it" : "taken off in place"} — the other ${seats.kept.length} kept their slots and nothing else on that board moved${run ? "" : ", and no model call was made"}`
            : "rebuilt in place — that board now holds this arrangement instead of what was on it, so say so",
        ...(seats && { keptTheirSlots: seats.kept.length }),
        placed: placed.map(({ slot, block }) => ({ slotId: slot.id, blockId: block.id })),
        /// Everything the answer did not amount to, said rather than swallowed:
        /// a board with a hole in it is still a board, and the director is owed
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
        /// meant a different one, and only the director can say which.
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
  /// a board the director arranged by hand, with no compositor call and nothing
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
  }: {
    board: { id: string; title: string; revision: number; layout: string | null; widthPx: number; heightPx: number };
    elements: readonly SceneElement[];
    args: Record<string, unknown>;
    named: string;
  }): Promise<ToolOutcome> {
    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    const asked = [
      ...new Set(asStringArray(args.addReferenceIds).map((id) => id.trim()).filter(Boolean)),
    ];
    const notFound = asked.filter((id) => !byId.has(id));

    const page = { width: board.widthPx, height: board.heightPx };
    const edit = placeOnBoard({
      elements,
      page,
      add: asked.filter((id) => byId.has(id)),
      remove: asStringArray(args.removeReferenceIds),
      sizeOf: (id) => byId.get(id),
    });

    /// The lines, against the scene the pictures left behind — so a line added in
    /// the same call as a photograph is set above the board as it now stands
    /// rather than above the board as it was.
    const text = placeLinesOnBoard({
      elements: edit.elements,
      page,
      add: asStringArray(args.addCaptions),
      remove: asStringArray(args.removeCaptions),
    });

    const changed =
      edit.added.length || edit.removed.length || text.added.length || text.removed.length;
    if (!changed) {
      return {
        result: {
          error: "nothing on that board changed",
          ...(notFound.length && { notInThisProject: notFound }),
          ...(edit.notOnBoard.length && { notOnBoard: edit.notOnBoard }),
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
    /// the wire for the director to reach for.
    if (!sceneReferenceIds(text.elements).length) {
      return {
        result: {
          error:
            "that would take every picture off the board — say so rather than leaving them with an empty one",
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
        elements: text.elements as unknown as Prisma.InputJsonValue,
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was editing it — the director has it open, so tell them and ask again",
        },
      };
    }

    return {
      result: {
        boardId: board.id,
        title,
        ...(edit.added.length && { added: edit.added }),
        ...(edit.removed.length && { removed: edit.removed }),
        ...(text.added.length && { linesAdded: text.added }),
        ...(text.removed.length && { linesRemoved: text.removed }),
        /// Said in the answer because the model could not have known it before
        /// the call: it asked for a rebuild's argument and got a scene edit, and
        /// the one thing it must not report is that the board was laid out again.
        status:
          "done as a scene edit — that board is arranged by hand rather than by a template, so nothing already on it moved and it was not laid out again. A picture put on it went in under what was already there and a line went above it. If they wanted the whole board laid out again, call compose_moodboard for it with a layout",
        ...(notFound.length && { notInThisProject: notFound }),
        ...(edit.notOnBoard.length && { notOnBoard: edit.notOnBoard }),
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
          elements: text.elements,
          thumbUrlOf: (id) => byId.get(id)?.thumbUrl,
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
  /// director has named both ends of the move, so a rebuild would be buying an
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
            widthPx: true,
            heightPx: true,
          },
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    /// The ceiling is a legibility one, so it truncates rather than refusing —
    /// but what it cut off is named. A call asking for six exchanges used to make
    /// four and answer with a list of four under a status reading "done", so two
    /// cuts the director had taken never reached the board and the reply said they
    /// had. A bound nobody is told about is indistinguishable from work that was
    /// never asked for.
    const parsed = swapRequests(args.swaps);
    const asked = parsed.swaps.slice(0, SWAP_LIMIT);
    const overLimit = parsed.swaps.slice(SWAP_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notMade: overLimit,
        notMadeNote: `only ${SWAP_LIMIT} exchanges are made in one call — these were not, so call again with them rather than telling the director they were done`,
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
    const layout = layoutById(board.layout);
    const swap = swapOnBoard({
      elements,
      layout,
      swaps: runnable,
      sizeOf: (id) => byId.get(id),
    });

    if (!swap.swapped.length && !swap.traded.length) {
      return {
        result: {
          error: "nothing on that board changed",
          ...(notFound.length && { notInThisProject: notFound }),
          ...(swap.notOnBoard.length && { notOnBoard: swap.notOnBoard }),
          ...(swap.alreadyOnBoard.length && { alreadyOnBoard: swap.alreadyOnBoard }),
          ...dropped,
        },
      };
    }

    /// Guarded on the revision that was read, as every server-side write to a
    /// board is: the director may have the tab open, and the tab that loses gets
    /// its own reload rather than its work silently overwritten. The stored
    /// render is disowned because it is a picture of the board as it was.
    const written = await db.moodboard.updateMany({
      where: { id: board.id, revision: board.revision },
      data: {
        elements: swap.elements as unknown as Prisma.InputJsonValue,
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was editing it — the director has it open, so tell them and ask again",
        },
      };
    }

    const items = boardItems(swap.elements);
    /// Whether the exchange actually closed the gap, measured the same way the
    /// compose and the read measure it. A cut taken at the shape the note asked
    /// for drops off this list, which is how the loop is seen to have ended.
    const loose = layout ? looseFits(scenePlacements(items, layout)) : [];

    return {
      result: {
        boardId: board.id,
        title: board.title,
        ...(swap.swapped.length && { swapped: swap.swapped }),
        /// Reported apart from `swapped` because it is a different sentence to
        /// the director: nothing joined the board and nothing left it, two
        /// pictures they were already looking at are in each other's places.
        ...(swap.traded.length && { tradedPlaces: swap.traded }),
        status:
          "done as a scene edit — every other picture on that board is exactly where it was and nothing was laid out again, so say that the board is otherwise untouched",
        ...(notFound.length && { notInThisProject: notFound }),
        ...(swap.notOnBoard.length && { notOnBoard: swap.notOnBoard }),
        ...(swap.alreadyOnBoard.length && { alreadyOnBoard: swap.alreadyOnBoard }),
        ...dropped,
        ...(loose.length && { looseInSlot: loose, looseInSlotNote: LOOSE_IN_SLOT_NOTE }),
      },
      /// The same rule the read door uses, and now the same function: a swap that
      /// refit the cut to its slot leaves the board standing as its template, so
      /// it keeps the name it had; a swap onto a picture the director had moved
      /// does not.
      attachments: [
        boardShown({ board, elements: swap.elements, thumbUrlOf: (id) => byId.get(id)?.thumbUrl }),
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
  /// arrangement the director made by hand. Nothing about the wording of a line
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
            widthPx: true,
            heightPx: true,
          },
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    /// Truncated and said, on the same argument the swap makes. Here the silence
    /// is if anything worse: the words the board carries are what the director
    /// reads, so a rewording that was dropped is a typo they were told was fixed
    /// and will find themselves.
    const parsed = rewordRequests(args.rewordings);
    const asked = parsed.rewordings.slice(0, REWORD_LIMIT);
    const overLimit = parsed.rewordings.slice(REWORD_LIMIT);
    const dropped = {
      ...(overLimit.length && {
        notReworded: overLimit,
        notRewordedNote: `only ${REWORD_LIMIT} lines are rewritten in one call — these were not, so call again with them rather than telling the director the board says them`,
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
    const edit = rewordOnBoard({ elements, rewordings: asked });

    if (!edit.reworded.length) {
      return {
        result: {
          error: "nothing on that board changed",
          ...(edit.notOnBoard.length && {
            notOnBoard: edit.notOnBoard,
            notOnBoardNote:
              "that wording is not on the board — read it with inspect_board and quote the line, or ask the director which one they meant",
          }),
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
        elements: edit.elements as unknown as Prisma.InputJsonValue,
        revision: { increment: 1 },
        renderRevision: null,
      },
    });
    if (written.count === 0) {
      return {
        result: {
          error:
            "that board was changed while I was editing it — the director has it open, so tell them and ask again",
        },
      };
    }

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    return {
      result: {
        boardId: board.id,
        title: board.title,
        reworded: edit.reworded,
        status:
          "done as a scene edit — no model call was made, the line kept its place and every picture on that board is exactly where it was, so say the board is otherwise untouched",
        ...(edit.notOnBoard.length && {
          notOnBoard: edit.notOnBoard,
          notOnBoardNote:
            "that wording is not on the board — read it with inspect_board and quote the line, or ask the director which one they meant",
        }),
        ...(edit.unchanged.length && { alreadySaysThat: edit.unchanged }),
        ...dropped,
      },
      /// The same tile the read and the swap draw, by the same rule: a reword
      /// moves no picture, so a board standing in its template still is.
      attachments: [
        boardShown({ board, elements: edit.elements, thumbUrlOf: (id) => byId.get(id)?.thumbUrl }),
      ],
    };
  }

  async function projectState(): Promise<ProjectState> {
    const [{ all, photos }, filed] = await Promise.all([references(), boards()]);
    return {
      photographs: photos.length,
      crops: all.length - photos.length,
      boards: filed.length + boardsFiled,
      /// Only the ones nothing is going to do anything about: a picture already
      /// queued arrives on its own, so declaring `read_references` for it would
      /// be a schema paid on every round of the window right after an upload.
      stalled: all.filter((reference) => reference.unread && reference.unread !== "pending").length,
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
        /// First. The catalog is a list of what the director has; this is what
        /// they have it *for*, and every line under it is read against it.
        named ? directorBrief(named) : "",
        catalogBrief(photos, { crops: all.length - photos.length }),
        boardsBrief(
          filed.map(({ id, title, widthPx, heightPx, layout }) => ({
            id,
            title,
            width: widthPx,
            height: heightPx,
            layout,
          })),
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
    },

    async execute({ name, args }) {
      const { all, photos } = await references();

      switch (name) {
        case LIST_REFERENCES.name: {
          const catalog = referenceCatalog(args.includeCrops === true ? all : photos);
          /// A cut filed a moment ago is as unread as a photograph uploaded a
          /// moment ago, and this is the only door that lists cuts — so the mark
          /// the brief carries needs its sentence here too, and only when
          /// something in this answer is marked.
          const unread = catalog.references.some((digest) => digest.unread);
          return { result: { ...catalog, ...(unread && { unreadNote: UNREAD_CATALOG_NOTE }) } };
        }

        /// Resolved against every reference, crops included: a cut the model was
        /// given by an earlier call is a picture the director may well want to
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
              /// reply that describes pictures the director cannot see.
              ...(missing.length && { notFound: missing }),
              /// The other half of that difference, and the one the model cannot
              /// work out for itself: these ids are real, they are simply past
              /// what one reply may carry.
              ...(overLimit.length && {
                notShown: overLimit,
                notShownNote: `only ${SHOWN_LIMIT} pictures go in one reply — these were not put in front of the director, so do not write about them as though they are there`,
              }),
            },
            attachments: found.map((reference) => attachmentOf(reference)),
          };
        }

        case READ_REFERENCES.name:
          return readPictures(args);

        case CROP_REFERENCE.name:
          return makeCrop(args);

        case INSPECT_BOARD.name:
          return inspectBoard(args);

        /// Unqueued with the other read: it writes nothing, and the tile it
        /// draws is a question rather than a report — a discard the director has
        /// not taken yet is not made wrong by a swap landing behind it.
        case DISCARD_BOARD.name:
          return offerDiscard(args);

        /// Unqueued for the same reason, and it is not a board edit at all — the
        /// row it is about is a picture, and the boards it reads it only reads to
        /// say what the removal would cost them.
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

        case SWAP_ON_BOARD.name:
          return boardEdits.run(boardKey(args), () => swapPictures(args));

        case REWORD_ON_BOARD.name:
          return boardEdits.run(boardKey(args), () => rewordLines(args));

        case COMPOSE_MOODBOARD.name:
          return boardEdits.run(boardKey(args), () => makeMoodboard(args));

        default:
          return { result: { error: `no tool called ${name}` } };
      }
    },
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
/// dropped without a word is an exchange the director asked for, did not get, and
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
/// meant, and here the mistake is written onto the board in words the director
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
