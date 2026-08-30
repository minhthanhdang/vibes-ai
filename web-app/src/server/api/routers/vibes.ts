import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { sceneWrite } from "@/server/moodboards/scene-write";
import {
  VIBES_DESIGN_LIMIT,
  VIBES_FORM_LIMIT,
  VIBES_PAGE_LIMIT,
  VIBES_TEXT_LIMIT,
  storedBrief,
  type VibesBrief,
} from "@/lib/vibes/vibes-brief";
import { vibesBoard } from "@/lib/vibes/vibes-start";
import { vibesPending, vibesRun } from "@/lib/vibes/vibes-resume";
import { vibesBatch, vibesBatchProgress, vibesSettledCutoff } from "@/lib/vibes/vibes-batch";
import { vibesJob } from "@/lib/vibes/vibes-queue";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import { enqueueVibesPage, kickVibesWorker } from "@/server/agents/vibes/vibes-queue";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

const vibesFormFields = {
  purpose: z.string().max(VIBES_TEXT_LIMIT),
  pages: z.number().int().min(1).max(VIBES_PAGE_LIMIT),
  palette: z.array(z.string()),
  vibes: z.string().max(VIBES_TEXT_LIMIT).default(""),
  width: z.number(),
  height: z.number(),
};

async function startVibesBoard(
  db: PrismaClient,
  {
    projectId,
    brief,
    suffix = "",
  }: {
    projectId: string;
    brief: VibesBrief;
    suffix?: string;
  },
) {
  const board = vibesBoard({ brief });

  const made = await db.$transaction(async (tx) => {
    const created = await tx.moodboard.create({
      data: {
        projectId,
        title: `${board.title}${suffix}`,
        widthPx: board.size.width,
        heightPx: board.size.height,
        vibesBrief: brief as unknown as Prisma.InputJsonValue,
        ...sceneWrite(board.elements),
      },
      select: { id: true, title: true },
    });
    const first = board.pageIds[0];
    if (first) {
      await enqueueVibesPage(tx, {
        projectId,
        boardId: created.id,
        pageId: first,
        index: 0,
      });
    }
    return created;
  });

  return {
    boardId: made.id,
    title: made.title,
    pageIds: board.pageIds,
  };
}

export const vibesRouter = createTRPCRouter({
  startBatch: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        forms: z
          .array(
            z.object({
              ...vibesFormFields,
              designs: z.number().int().min(1).max(VIBES_DESIGN_LIMIT),
            }),
          )
          .min(1)
          .max(VIBES_FORM_LIMIT),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const batch = vibesBatch(input.forms);
      if (!batch)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "that batch is unreadable",
        });

      const boards = [];
      for (const [formIndex, form] of batch.entries()) {
        for (let design = 1; design <= form.designs; design += 1) {
          const brief =
            form.designs > 1
              ? { ...form.brief, take: { design, designs: form.designs } }
              : form.brief;
          const made = await startVibesBoard(ctx.db, {
            projectId: project.id,
            brief,
            suffix: design > 1 ? ` — v${design}` : "",
          });
          boards.push({
            boardId: made.boardId,
            title: made.title,
            pageIds: made.pageIds,
            formIndex,
            designIndex: design - 1,
          });
        }
      }

      kickVibesWorker();

      return { boards };
    }),

  offer: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(async ({ ctx, input }) => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.boardId, project: { userId: ctx.user.id } },
        select: { id: true, title: true, vibesBrief: true, elements: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      const brief = storedBrief(board.vibesBrief);
      if (!brief) return null;

      const pages = vibesRun({ elements: persistableElements(board.elements), brief });

      return {
        boardId: board.id,
        title: board.title,
        pages,
        pending: vibesPending(pages),
      };
    }),

  activeRuns: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const rows = await ctx.db.agentRun.findMany({
        where: {
          projectId: project.id,
          agent: AgentKind.VIBES,
          OR: [
            { status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] } },
            { finishedAt: { gte: vibesSettledCutoff(new Date()) } },
          ],
        },
        select: { status: true, input: true, output: true, error: true, startedAt: true },
      });

      const boardIds = [
        ...new Set(
          rows.flatMap((row) => {
            const job = vibesJob(row.input);
            return job ? [job.boardId] : [];
          }),
        ),
      ];
      if (boardIds.length === 0) return { boards: [] };

      const boards = await ctx.db.moodboard.findMany({
        where: { id: { in: boardIds }, projectId: project.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, vibesBrief: true },
      });

      return {
        boards: vibesBatchProgress(
          rows,
          boards.flatMap((board) => {
            const brief = storedBrief(board.vibesBrief);
            return brief
              ? [
                  {
                    boardId: board.id,
                    title: board.title,
                    total: brief.pages,
                  },
                ]
              : [];
          }),
        ),
      };
    }),

  stop: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.boardId, project: { userId: ctx.user.id } },
        select: { id: true, projectId: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      const unqueued = await ctx.db.agentRun.deleteMany({
        where: {
          projectId: board.projectId,
          agent: AgentKind.VIBES,
          status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] },
          input: { path: ["boardId"], equals: board.id },
        },
      });
      return { stopped: unqueued.count > 0 };
    }),

  resume: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.boardId, project: { userId: ctx.user.id } },
        select: { id: true, projectId: true, vibesBrief: true, elements: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      const brief = storedBrief(board.vibesBrief);
      if (!brief)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "that board was not started from a Vibes brief",
        });

      const live = await ctx.db.agentRun.findFirst({
        where: {
          projectId: board.projectId,
          agent: AgentKind.VIBES,
          status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] },
          input: { path: ["boardId"], equals: board.id },
        },
        select: { id: true },
      });
      if (live)
        throw new TRPCError({ code: "CONFLICT", message: "this board's run is still going" });

      const pending = vibesPending(
        vibesRun({ elements: persistableElements(board.elements), brief }),
      );
      const next = pending[0];
      if (!next)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "every page of this run is designed",
        });

      await enqueueVibesPage(ctx.db, {
        projectId: board.projectId,
        boardId: board.id,
        pageId: next.pageId,
        index: next.index,
      });
      kickVibesWorker();

      return { boardId: board.id, remaining: pending.length };
    }),
});
