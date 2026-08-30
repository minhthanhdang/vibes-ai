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

export type DesignerToolset = {
  declarations: ToolDeclaration[];
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

export const NO_INTENTION =
  "say what the design is for — design_page needs an intention in the user's own words, and it is the only part of the ask agent 8 cannot read off the board";

export type DesignPageRefusal = {
  error: string;
  runId?: string;
};

export type DesignPageAnswer = {
  line: string;
  boardId: string;
  boardTitle: string;
  pageId?: string;
  calls: string[];
  notFound?: string[];
  stopped?: "rounds";
  runId: string;
  report: DesignReport;
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

const DESIGN_BOARD_SELECT = {
  id: true,
  title: true,
  elements: true,
} as const;

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

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

export function designerToolsets({
  db,
  projectId,
  boardId,
  references = designerReferences({ db, projectId }),
  boardEdits = keyedQueue(),
  skills = skillToolset(),
  render,
  budget,
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
  generate,
  render,
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

  const pagesBefore = new Set(inOrder.map(({ id }) => id));

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

  const renders = countedRenders(render);

  const drawsMade = () => {
    const tally = renders.drew();
    return tally.made + tally.cached + tally.failed > 0 ? tally : null;
  };

  const skills = skillToolset();

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
        ...spentThrown(cause),
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

  const written = await db.moodboard.findFirst({
    where: { id: board.id, projectId },
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
        rounds: answer.rounds,
        ...(answer.roundsDropped > 0 && { roundsDropped: answer.roundsDropped }),
        modelCalls: answer.modelCalls,
        pictures: answer.pictures,
        ...(answer.picturesDropped > 0 && { picturesDropped: answer.picturesDropped }),
        ...(answer.picturesRefused > 0 && { picturesRefused: answer.picturesRefused }),
        ...(drew && { renders: drew }),
        ...(skills.read().length && { skills: skills.read() }),
        ...(notFound.length && { notFound }),
        ...(answer.finish && { finish: answer.finish }),
        ...(answer.stopped && { stopped: answer.stopped }),
      },
      ...spentColumns(answer.model, answer.usage),
    },
  });

  return {
    line: answer.line,
    boardId: board.id,
    boardTitle: written?.title ?? board.title,
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
        widthPx: 0,
        heightPx: 0,
        layout: null,
        layoutSlots: null,
      },
      elements,
    },
  };
}
