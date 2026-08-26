import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { spentColumns, spentThrown } from "@/lib/agent/shared/model-cost";
import { boardPages, pageById, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { persistableElements, type SceneElement } from "@/lib/scene/moodboard-scene";
import { keyedQueue } from "@/lib/util/keyed-queue";
import { designerBoardToolset } from "@/server/agents/designer/boards";
import { designerCanvasToolset } from "@/server/agents/designer/canvas";
import { galleryToolset } from "@/server/agents/designer/gallery";
import { imageToolset, type ImageToolset, type PictureBudget } from "@/server/agents/designer/images";
import {
  runDesigner,
  type DesignerCall,
  type DesignerOutcome,
} from "@/server/agents/designer/loop";
import { designerPageToolset } from "@/server/agents/designer/page";
import {
  designerReferences,
  type DesignerReferences,
} from "@/server/agents/designer/references";
import { designReport, type DesignReport } from "@/server/agents/designer/report";
import { skillToolset, type DesignerSkillToolset } from "@/server/agents/designer/skills";
import type { generateContentStream } from "@/server/google/vertex";
import { countedRenders, type renderForModel } from "@/server/render/for-model";
import { withAgent } from "@/server/agents/shared/agent-scope";

/// Agent 8 assembled (compositor-v2.md §VI). The five toolsets, the loop, the
/// ask agent 6's arguments come to in words, and the one `AgentKind.DESIGNER`
/// row the whole call is priced on.
///
/// Everything here is the *door's* work rather than the loop's: the loop's
/// business is rounds and pictures, and it never learns what a board is. What
/// this file owns is the three questions asked before a model call is worth
/// making — is that board this project's, is that page on it, are those
/// pictures real — and the single read of the project's references that every
/// toolset then shares.
///
/// The refusals above the run row are deliberate. A design pointed at a board
/// in another project or at a page that is not there would spend twelve rounds
/// discovering it, and a run row for a call that never reached a model would
/// put a zero-token design on the ledger beside the real ones.

/// What the four toolset files each declare for themselves, named once here
/// because this is the file that holds all five at the same time: a set of
/// declarations and an executor that answers null for a name it does not own.
export type DesignerToolset = {
  declarations: ToolDeclaration[];
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

/// Said when `design_page` arrived with no intention. Agent 6 holds the user's
/// own words and agent 8 is given nothing else about the ask — the board and
/// the page are state it can read, and the intention is the only part of the
/// call nothing else can supply.
export const NO_INTENTION =
  "say what the design is for — design_page needs an intention in the user's own words, and it is the only part of the ask agent 8 cannot read off the board";

export type DesignPageRefusal = {
  error: string;
  /// Set only when the refusal cost a model call — a design that reached the
  /// loop and threw inside it. The three refusals above the run row leave it
  /// off, and that is what tells a design that cost twelve rounds and threw
  /// from one that never reached a model at all: naming a board of another
  /// project costs a round, and the ledger should not say otherwise.
  runId?: string;
};

export type DesignPageAnswer = {
  /// Agent 8's own closing line, for agent 6 to say to the user in fewer words
  /// (§VI). Its own now on every ending: the loop buys one tool-less round
  /// rather than handing back a constant (`DESIGNER_CLOSING_ASK`).
  line: string;
  boardId: string;
  /// What the board is called, off the read the door already made. Said because
  /// agent 6's reply names the board and a design onto a board it did not file
  /// this turn is a board whose name it may never have read.
  boardTitle: string;
  pageId?: string;
  /// What the design actually called, in order, so agent 6's turn can say
  /// whether a picture was drawn or a page was made rather than only that a
  /// design happened.
  calls: string[];
  /// Pictures agent 6 named that this project does not have. Reported rather
  /// than refused: the design still has the rest of them and the gallery, and
  /// the id agent 6 read off a stale catalog is the one thing agent 8 could
  /// never tell it about.
  notFound?: string[];
  /// Only when the loop stopped for a reason other than having answered — a
  /// page that was left mid-pass really was changed, and agent 6 has to say so.
  stopped?: "rounds";
  runId: string;
  /// What the design actually put on the board, read back off the scene after
  /// the loop rather than taken from anything the model said (`report.ts`).
  ///
  /// Here rather than in agent 6's tool layer so that every caller of this door
  /// gets it — `designPage` is called directly by "Let's Vibes" as well as by
  /// `design_page`, and a report assembled in `tools.ts` would be a report only
  /// one of the two can read.
  report: DesignReport;
  /// The board as the design left it: the columns a tile of it is drawn from,
  /// and the scene the report was read out of.
  ///
  /// Handed back rather than left to the caller to fetch, because it is the
  /// same read. `design_page`'s answer rides beside a picture of the board
  /// (§VI) and the scene it needs is megabytes — a caller re-reading it here
  /// would pay for the column twice on the most expensive call in the product,
  /// and could get a different revision than the report describes.
  scene: {
    board: {
      id: string;
      title: string;
      widthPx: number;
      heightPx: number;
      layout: string | null;
      layoutSlots: unknown;
    };
    elements: SceneElement[];
  };
};

export type DesignPageOutcome = DesignPageRefusal | DesignPageAnswer;

/// The columns the door reads. `elements` is the megabytes and there is no
/// resolving a pageId without them — a page is a frame in the scene, and the
/// row's `pageNames` are positional and carry no ids.
const DESIGN_BOARD_SELECT = {
  id: true,
  title: true,
  elements: true,
} as const;

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/// What agent 6's arguments come to in words.
///
/// Pure, and separated from the reads for the reason the render plan is
/// separated from the rasterising: this paragraph is the whole of what the
/// model is told about the ask, and it is worth being able to assert on it
/// without a database.
///
/// The board's id is in it because every canvas tool takes one and the model
/// has no other way to learn it. The intention is verbatim — agent 6 is the one
/// holding the user's own words, and a door that paraphrases them is a second
/// reading of the ask nobody asked for.
export function designAsk({
  board,
  page,
  pages,
  newPage,
  intention,
  pictures,
}: {
  board: { id: string; title: string };
  page: { id: string; name: string; position: number } | null;
  pages: number;
  newPage: boolean;
  intention: string;
  pictures: { id: string; title: string }[];
}): string {
  const named = (of: { id: string; name: string; position: number }) =>
    `${of.name ? `"${of.name}"` : `page ${of.position}`} (pageId ${of.id})`;

  /// Four readings of one pair of arguments, and the fresh-page two are what
  /// §VI's `newPage` guarantee comes to here: the page is made rather than
  /// found, so the work starts on something empty and nothing standing on the
  /// board is at risk. Made by the model and not by this door — `add_page` is
  /// deliberately not in agent 8's set (§IV.2) because `put_on_canvas` with
  /// `kind: "page"` already makes one and takes a box, and what size a fresh
  /// page should be is the design decision this whole agent exists to make.
  const where = newPage
    ? page
      ? `Put this on a fresh page beside ${named(page)}. Make the page yourself with put_on_canvas — leave everything already on the board where it is.`
      : "Put this on a fresh page of its own. Make it yourself with put_on_canvas — leave everything already on the board where it is."
    : page
      ? `Work on ${named(page)}.`
      : pages > 0
        ? `No page was named. The board has ${pages === 1 ? "one page" : `${pages} pages`} — read it before you place anything.`
        : "The board has no pages yet. Make one with put_on_canvas before you place anything on it.";

  return [
    `The board is ${board.title ? `"${board.title}"` : "untitled"} (boardId ${board.id}).`,
    where,
    `What they asked for: ${intention}`,
    ...(pictures.length
      ? [
          "They named these pictures:",
          ...pictures.map(({ id, title }) => `- ${title || "untitled"} (imageId ${id})`),
        ]
      : []),
  ].join("\n\n");
}

/// The six toolsets of §IV, in §IV's own order — the only assembly of agent
/// 8's tools there is.
///
/// The order is the same order twice: it is the list the model is given and the
/// order a name is resolved in, so a tool cannot be declared by one set and
/// answered by another. Built here rather than inline in `designPage` because
/// what agent 8 sends on every round of every design is a number worth being
/// able to read — `npm run floor` prices this list the way it prices agent 6's
/// (the tool reference's §III), and a floor measured off a hand-kept copy of
/// the list is a floor that quietly stops being the real one.
export function designerToolsets({
  db,
  projectId,
  boardId,
  references = designerReferences({ db, projectId }),
  /// One queue for every write the design makes, shared by the three toolsets
  /// that write: a page's rectangle, the objects standing on it and the words
  /// one of those objects carries are one scene and one revision, so a
  /// `resize_page`, a `put_on_canvas` and a `reword_on_board` the model asked
  /// for in the same round have to land one after the other. A queue each would
  /// let each read one revision, land one write and tell the model the user
  /// changed the board underneath the others. Made here rather than taken
  /// from the caller so that assembling the toolsets is what makes it — an
  /// assembly is a design, and a design is one queue.
  boardEdits = keyedQueue(),
  /// Injected on `references`' and `boardEdits`' terms, and for one reason: it
  /// is the only toolset that keeps a ledger the caller has to read back. What
  /// a design was taught goes on its run row (§VIII), and the toolset's own
  /// `read` is the only account of it that has the ceilings already applied.
  skills = skillToolset(),
  render,
  /// The turn's picture ceilings, from the turn that opened the design (§VII).
  /// Left off only by a caller that is not a turn — `npm run floor` prices the
  /// declarations and never spends one, and `imageToolset` opens its own.
  budget,
  /// Injected on `skills`' terms and for its reason: it is the other toolset
  /// that keeps a ledger the caller has to read back. What a design *made* goes
  /// into the report agent 6 answers with, and the toolset's own `made` is the
  /// only account of it that has the refusals already taken out.
  images = imageToolset({ db, projectId, boardId, references, ...(budget && { budget }) }),
}: {
  db: PrismaClient;
  projectId: string;
  boardId: string;
  references?: DesignerReferences;
  boardEdits?: ReturnType<typeof keyedQueue>;
  skills?: DesignerSkillToolset;
  render?: typeof renderForModel;
  budget?: PictureBudget;
  images?: ImageToolset;
}): DesignerToolset[] {
  return [
    designerCanvasToolset({ db, projectId, references, boardEdits, ...(render && { render }) }),
    designerPageToolset({ db, projectId, references, boardEdits, ...(render && { render }) }),
    designerBoardToolset({ db, projectId, references, boardEdits }),
    galleryToolset({ db, projectId, references }),
    images,
    skills,
  ];
}

/// Agent 8's rounds are recorded under agent 6's turn when it was agent 6 that
/// asked for the page, and open a turn of their own when "Let's Vibes" called
/// this door directly — a turn is the outermost agent, not always a chat
/// message.
export function designPage(asked: Parameters<typeof designingPage>[0]) {
  return withAgent("designer", () => designingPage(asked));
}

async function designingPage({
  db,
  projectId,
  boardId: askedBoard,
  pageId: askedPage,
  intention: asked,
  imageIds = [],
  newPage = false,
  /// The model call, injected as it is everywhere else in this directory: every
  /// round is one, and what is worth asserting about a design is which tools it
  /// reached for — which nothing that has to reach Vertex can assert.
  generate,
  /// The on-demand draw, handed to the two toolsets that look. Injected for the
  /// same reason: it is the one part of a read that touches a bucket.
  render,
  /// The turn's own generation and crop tallies, handed down by agent 6's door
  /// (§VII). Not made here, and that is the whole of the sharing: the two
  /// ceilings are per *turn*, and a design runs inside one rather than being
  /// one — so a design that draws a picture spends the same picture agent 6
  /// would have spent drawing it itself.
  budget,
}: {
  db: PrismaClient;
  projectId: string;
  boardId: string;
  pageId?: string;
  intention: string;
  imageIds?: string[];
  newPage?: boolean;
  generate?: typeof generateContentStream;
  render?: typeof renderForModel;
  budget?: PictureBudget;
}): Promise<DesignPageOutcome> {
  const intention = asked.trim();
  if (!intention) return { error: NO_INTENTION };

  /// Scoped by project like every other board read in either agent: a boardId
  /// is something a model wrote, and an id is not a licence to read a row from
  /// somewhere else.
  const boardId = asString(askedBoard);
  const board = boardId
    ? await db.moodboard.findFirst({
        where: { id: boardId, projectId },
        select: DESIGN_BOARD_SELECT,
      })
    : null;
  if (!board) return { error: `no board called ${boardId} in this project` };

  const inOrder = pagesInReadingOrder(boardPages(persistableElements(board.elements)));
  const wanted = asString(askedPage);
  const found = wanted ? pageById(inOrder, wanted) : null;
  if (wanted && !found) {
    return {
      error: `there is no page called ${wanted} on the board ${boardId} — inspect_board lists the pages that board has`,
    };
  }
  const page = found
    ? { id: found.id, name: found.name, position: inOrder.indexOf(found) + 1 }
    : null;

  /// The board's pages as they stood *before* the design, so a page the model
  /// made itself can be told from the ones that were already there.
  ///
  /// This is the whole of what lets a `newPage` design name its own page. Agent
  /// 8 makes a fresh page with `put_on_canvas` rather than being handed one
  /// (§IV.2), so its id exists nowhere until the scene is read back — and
  /// without this snapshot the read afterwards cannot tell it from the four
  /// pages the board already had.
  const pagesBefore = new Set(inOrder.map(({ id }) => id));

  /// The project's pictures, read once and handed to every toolset that reads
  /// them (`references.ts`). Built here rather than inside each one so a design
  /// that lists the gallery and then reads a page pays one query for both — and
  /// so the ids agent 6 named are resolved against the same list the model will
  /// be shown.
  const references = designerReferences({ db, projectId });

  const asked6 = imageIds.map(asString).filter(Boolean);
  const { pictures, notFound } = asked6.length
    ? await (async () => {
        const { rows } = await references();
        const held = asked6.map((id) => rows.get(id));
        return {
          pictures: held
            .filter((row) => row !== undefined)
            .map(({ id, title }) => ({ id, title })),
          notFound: asked6.filter((id) => !rows.has(id)),
        };
      })()
    : { pictures: [], notFound: [] };

  /// Opened before the loop rather than written after it, unlike the
  /// orchestrator's own row next door: that turn answers inside one request and
  /// there is nothing to watch, and this one is twelve rounds of vision — a
  /// design that hangs should be a RUNNING row somebody can find, not a row
  /// that never appears.
  const run = await db.agentRun.create({
    data: {
      projectId,
      agent: AgentKind.DESIGNER,
      status: RunStatus.RUNNING,
      input: {
        boardId: board.id,
        intention,
        ...(page && { onPage: page.id }),
        ...(newPage && { onNewPage: true }),
        ...(pictures.length && { imageIds: pictures.map(({ id }) => id) }),
      },
    },
    select: { id: true },
  });

  /// Every draw this design makes, counted on the way through (§VIII). Wrapped
  /// here rather than in the toolsets because the tally is the *call's* — one
  /// design's looking, on the one row that design is priced on.
  const renders = countedRenders(render);

  /// Null for a design that never looked, so the key is absent rather than
  /// three zeroes — the rows that drew nothing are the ones a hit rate has to
  /// be counted apart from, and a `{made:0,cached:0,failed:0}` on every row
  /// makes that a sum rather than a filter.
  const drawsMade = () => {
    const tally = renders.drew();
    return tally.made + tally.cached + tally.failed > 0 ? tally : null;
  };

  /// Held here rather than found again in the assembled list, so that what
  /// this design was taught can go on its row beside what it spent. §VIII's
  /// remaining guard against an ugly page is the skill, the picture and the
  /// second look, and the first of those is the only one no row has ever named.
  const skills = skillToolset();

  /// Held here rather than found again in the assembled list, on `skills`'
  /// terms: it is the other toolset with a ledger the report is built out of.
  const images = imageToolset({
    db,
    projectId,
    boardId: board.id,
    references,
    ...(budget && { budget }),
  });

  const toolsets = designerToolsets({
    db,
    projectId,
    boardId: board.id,
    references,
    skills,
    images,
    render: renders.render,
    ...(budget && { budget }),
  });

  /// The unknown-tool error belongs here and nowhere else: each toolset answers
  /// null for a name it does not own, and this is the only place that holds
  /// every name.
  const execute = async (call: DesignerCall): Promise<DesignerOutcome> => {
    for (const toolset of toolsets) {
      const outcome = await toolset.execute(call);
      if (outcome) return outcome;
    }
    return { result: { error: `there is no tool called ${call.name}` } };
  };

  let answer;
  try {
    answer = await runDesigner({
      ask: designAsk({
        board: { id: board.id, title: board.title },
        page,
        pages: inOrder.length,
        newPage,
        intention,
        pictures,
      }),
      tools: toolsets.flatMap(({ declarations }) => declarations),
      execute,
      ...(generate && { generate }),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const drew = drawsMade();
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.FAILED,
        error: message,
        finishedAt: new Date(),
        /// What the rounds before the throw cost, priced on the model that
        /// really did them — null when the throw carried no price at all,
        /// which is reaching the model failing rather than the model refusing.
        ...spentThrown(cause),
        /// On the failed row as well as the succeeded one, under the same keys:
        /// the draws a design made before it threw are draws it made, and a hit
        /// rate read off the succeeded rows alone is a hit rate of the designs
        /// that finished. Same for the skills — a design reads them in its
        /// first round or two, so the failures are where they are most likely
        /// to be all there is.
        ...((drew || skills.read().length) && {
          output: {
            ...(drew && { renders: drew }),
            ...(skills.read().length && { skills: skills.read() }),
          },
        }),
      },
    });
    return { error: message, runId: run.id };
  }

  /// Read again rather than remembered, and read *here* rather than in agent
  /// 6's tool layer.
  ///
  /// The design wrote that board through the canvas tools for as many rounds as
  /// it took, so the scene this door has in `board.elements` is several
  /// revisions behind — a report built off it would describe the page as it was
  /// before the design. And the door is where it belongs because both callers
  /// of this function want it: `design_page` and "Let's Vibes" alike answer
  /// with what landed on the page.
  const written = await db.moodboard.findFirst({
    where: { id: board.id, projectId },
    /// The tile's columns beside the scene, so the picture the caller shows and
    /// the report it says are the same revision of the same board.
    select: {
      id: true,
      title: true,
      widthPx: true,
      heightPx: true,
      elements: true,
      layout: true,
      layoutSlots: true,
    },
  });
  const elements = persistableElements(written?.elements ?? board.elements);
  const standing = pagesInReadingOrder(boardPages(elements));

  /// Which page the design was on, in the three ways it can be known — and the
  /// fourth case, which is that it cannot be.
  ///
  /// A page agent 6 named is the page. Otherwise a page on the board now that
  /// was not on it before is the page the model made, which is what `newPage`
  /// asks for and what a design onto a board with no pages ends up doing. Only
  /// a board of one page falls through to that page. What is left — several
  /// pages, none of them new, nobody naming one — is a page only the model
  /// knows it chose, and the report says so by listing the pages instead.
  const madePage = standing.find(({ id }) => !pagesBefore.has(id));
  const designed =
    page?.id ?? madePage?.id ?? (standing.length === 1 ? standing[0]!.id : null);

  const report = designReport({
    elements,
    pageId: designed,
    named: pictures.map(({ id }) => id),
    made: images.made(),
  });

  const drew = drawsMade();
  await db.agentRun.update({
    where: { id: run.id },
    data: {
      status: RunStatus.SUCCEEDED,
      finishedAt: new Date(),
      output: {
        line: answer.line,
        calls: answer.calls.map(({ name }) => name),
        /// The shape of the spend beside its size (§VII). A loop priced per
        /// model call and never per turn is a loop nobody can see getting
        /// longer, and these four are what make a long one readable afterwards
        /// as one design rather than as a bill.
        rounds: answer.rounds,
        ...(answer.roundsDropped > 0 && { roundsDropped: answer.roundsDropped }),
        modelCalls: answer.modelCalls,
        pictures: answer.pictures,
        ...(answer.picturesDropped > 0 && { picturesDropped: answer.picturesDropped }),
        /// The one count worth reading on its own: a picture the budget refused
        /// is the only case where the model asked to look at something and was
        /// answered in words.
        ...(answer.picturesRefused > 0 && { picturesRefused: answer.picturesRefused }),
        /// What the looking cost the bucket rather than the model (§VIII): a
        /// design whose draws are mostly `cached` paid one HEAD for each of
        /// them, and one whose `made` climbs with its rounds wrote the board
        /// every round. The risk this answers says to measure the hit rate
        /// before the render time, and this is the row it is measured off.
        ...(drew && { renders: drew }),
        /// What this design was taught, and the only record of it: the skills
        /// reach the model as text in a transcript nothing keeps (§III.1 never
        /// windows them out, and the loop throws the transcript away). Without
        /// this key, "which of the registry does a design actually read" is a
        /// question only a live run can answer, one design at a time.
        ...(skills.read().length && { skills: skills.read() }),
        ...(notFound.length && { notFound }),
        ...(answer.finish && { finish: answer.finish }),
        ...(answer.stopped && { stopped: answer.stopped }),
      },
      /// Every round's usage on one row, including the rounds that only looked
      /// (§VII). The model is the loop's own — a door that names one is a door
      /// that can name a different one than the call made.
      ...spentColumns(answer.model, answer.usage),
    },
  });

  return {
    line: answer.line,
    boardId: board.id,
    /// Off the read-back rather than off the read on the way in, so the title
    /// and the scene beside it are the same revision of the same row.
    boardTitle: written?.title ?? board.title,
    /// The page the design was really on, which is no longer only the page
    /// agent 6 named: a `newPage` design makes its own with `put_on_canvas`
    /// (§IV.2), and until the read above there was nothing that could name it.
    ...(designed && { pageId: designed }),
    calls: answer.calls.map(({ name }) => name),
    ...(notFound.length && { notFound }),
    ...(answer.stopped && { stopped: answer.stopped }),
    runId: run.id,
    report,
    scene: {
      board: written ?? {
        id: board.id,
        title: board.title,
        /// Only reachable by the board being deleted between the last write and
        /// this read, which is a tab closing mid-design. The tile is drawn from
        /// the scene the door read on the way in rather than from nothing.
        widthPx: 0,
        heightPx: 0,
        layout: null,
        layoutSlots: null,
      },
      elements,
    },
  };
}
