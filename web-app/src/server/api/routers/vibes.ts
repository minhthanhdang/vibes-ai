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

/// "Let's Vibes" — the product's headline action (compositor-v2.md §IX).
///
/// `startBatch` makes the boards and makes no model call — and it hands the
/// browser nothing to drive. The run is the vibes queue's
/// (multi-vibes-and-preview-prd §II): each board's page-1 job is filed in the
/// same transaction as the board, the worker designs it and chain-enqueues the
/// next, and a closed tab no longer stops anything. The panel watches by
/// polling `activeRuns`, ends a chain through `stop`, and `resume` re-files
/// the first blank page of a board whose chain ended early. `offer` is the
/// read the panel asks of every opened board — does this one still owe pages —
/// which is `resume`'s old question with the walking taken out of the answer.

/// The form's fields, once. Deliberately loose about everything `vibesBrief`
/// decides — the schema stops a payload nobody could have typed and nothing
/// more, so that what the browser refuses beside a field and what the server
/// refuses are the same reading of the same brief rather than two that drift
/// a release apart.
const vibesFormFields = {
  purpose: z.string().max(VIBES_TEXT_LIMIT),
  pages: z.number().int().min(1).max(VIBES_PAGE_LIMIT),
  palette: z.array(z.string()),
  vibes: z.string().max(VIBES_TEXT_LIMIT).default(""),
  preset: z.string(),
};

/// One board of a run, landed whole — the old `vibes.start`'s body, kept as
/// the private helper `startBatch` calls F×D times (multi-vibes-and-preview-prd
/// §II.3): a second door into board-creation is the §IX.5 failure mode.
///
/// One transaction per board: the board and page 1's job land together or not
/// at all. That is the only atomicity a run ever needed — a board with no job
/// is a run that never starts, which is exactly why `enqueueVibesPage` takes
/// the transaction it is filed in. The *batch* is deliberately not one
/// transaction over all its boards: each board is an independent chain head the
/// moment it exists, and twelve scenes written under one interactive
/// transaction is a timeout risk in exchange for no invariant.
///
/// The run keeps **no thread**. It used to open a `Conversation` of its own,
/// write `Let's Vibes — <purpose>` into it and stamp the board with its id, and
/// the worker appended a row per page — but nobody typed in that thread and
/// nobody read it, and a batch put one per board at the top of the switcher.
/// Nothing is lost with it: the purpose is the board's title, the whole brief
/// is on `Moodboard.vibesBrief`, and what each page's design call did is on its
/// own `AgentRun` row, which is what the run panel reads. `conversationId`
/// stays on the board, nullable and unset here.
async function startVibesBoard(
  db: PrismaClient,
  {
    projectId,
    brief,
    suffix = "",
  }: {
    projectId: string;
    /// Carrying its take stamp already, when it has one — this is the object
    /// written to the column, and the stamp must be on the column to survive a
    /// resume (§II.3, `vibes-brief.ts`).
    brief: VibesBrief;
    /// ` — v2`, ` — v3` on the later takes of one form; empty for take 1 and
    /// the single-design case, so the common board's name does not grow a tail.
    suffix?: string;
  },
) {
  const board = vibesBoard({ brief });

  const made = await db.$transaction(async (tx) => {
    const created = await tx.moodboard.create({
      data: {
        projectId,
        title: `${board.title}${suffix}`,
        /// The board's default page size becomes the preset the form chose,
        /// so a seventh page added by hand afterwards comes at the shape the
        /// set is in (§V.2).
        widthPx: board.size.width,
        heightPx: board.size.height,
        /// The brief, kept on the board it made (§IX.2), and the only record
        /// of the ask there is. Every design call after this one asks for the
        /// same set, and the halves of it that nothing on the board carries are
        /// the user's own words and the palette — so a run whose form was typed
        /// in a tab that has since closed can still be finished.
        vibesBrief: brief as unknown as Prisma.InputJsonValue,
        ...sceneWrite(board.elements),
      },
      select: { id: true, title: true },
    });
    /// Page 1 and only page 1: the chain hands the rest over as each page
    /// settles, because page N+1 is designed against the pages that exist
    /// (§II.2).
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
  /// The batch: one or many brief cards, each becoming one or many boards
  /// (multi-vibes-and-preview-prd §II.3). The one door into board-creation —
  /// it replaced `vibes.start`, whose body survives as `startVibesBoard`
  /// above, because two doors is the §IX.5 failure mode. The single-card,
  /// one-design submission is the old `start` exactly: one board, one job.
  ///
  /// The user's column is left exactly where it was. A batch opens no
  /// conversation of its own and moves nobody onto one — the user is watching
  /// the run panel, and a switcher grown a thread per board is the clutter
  /// this stopped making.
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

      /// One reader for the whole submission, `vibesBrief`'s contract at the
      /// batch size — including the page ceiling, which is a property of the
      /// sum and not of any card. Terse here for the reason `start` is: the
      /// words belong beside the form's cards and button, off the same reader.
      const batch = vibesBatch(input.forms);
      if (!batch)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "that batch is unreadable",
        });

      /// F×D boards, in the order the cards were stacked — sequentially, so
      /// `createdAt` keeps the tab row and the board strip in submission
      /// order. Each design of a multi-design form gets the take stamp on the
      /// brief it is stored with, and takes past the first get the ` — v2`
      /// name; take 1 stays unsuffixed because the single-design case must
      /// not grow a tail.
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

      /// One kick for the batch: the worker claims one job per invocation and
      /// self-kicks while rows remain (§II.5), so every chain head gets picked
      /// up at design speed with cron as the backstop.
      kickVibesWorker();

      /// The form navigates to the first board; the rest are the progress
      /// panel's to show (§II.6).
      return { boards };
    }),

  /// Whether an opened board still owes pages (§IX.5) — the question behind
  /// the resume offer, split from the press that acts on it now that acting
  /// means enqueueing (`resume` below).
  ///
  /// Read off the scene rather than off a record of what ran. A record would be
  /// a second account of the same fact, kept current by every design call and
  /// wrong the morning a page is discarded by hand — where the scene cannot be
  /// wrong about whether anything is on a page, because being on the page is
  /// what the question means.
  offer: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(async ({ ctx, input }) => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.boardId, project: { userId: ctx.user.id } },
        select: { id: true, title: true, vibesBrief: true, elements: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      /// A board with no brief on it was not made by this form and has no run
      /// to pick up, which is a `null` rather than the refusal `resume` makes:
      /// this is the question the browser asks of *every* board it opens, and
      /// most boards in a project were never a Vibes run. Still not an empty
      /// list — an empty `pending` reads as "this run is finished", and a
      /// board that was never a run has not finished one.
      const brief = storedBrief(board.vibesBrief);
      if (!brief) return null;

      const pages = vibesRun({ elements: persistableElements(board.elements), brief });

      return {
        boardId: board.id,
        title: board.title,
        /// Both, off one read: `pages` is what the user is looking at — three
        /// of six done — and `pending` is what the loop is about to do. A
        /// browser given only the second could not say how far the run got.
        pages,
        pending: vibesPending(pages),
      };
    }),

  /// What the queue is doing to this project's boards, shaped for the panel
  /// (multi-vibes-and-preview-prd §II.6). A read the browser polls, which is
  /// the whole replacement for the loop it used to drive: the worker and this
  /// query look at the same `VIBES` rows, so the progress drawn and the work
  /// done cannot disagree.
  ///
  /// Settled rows ride along for `VIBES_SETTLED_WINDOW_MS` so the ending is
  /// seen — the refusal's sentence, the final count — and after the window the
  /// scene speaks instead, through `resume`'s own read.
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

      /// `projectId` again on the boards, though the rows already carried it:
      /// a job is Json and could name any board at all, and a card must never
      /// be built over a board this project does not own.
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

  /// The Stop button, now a row deleted instead of a flag flipped
  /// (multi-vibes-and-preview-prd §II.6). The chain has at most one live row
  /// per board, and stopping is taking that row away so no settle extends it.
  ///
  /// The PRD says to delete only the QUEUED head, but the code wins (Part V):
  /// with the self-kick the head is RUNNING for nearly all of a page's
  /// minutes, and a RUNNING page's settle chain-enqueues the next — deleting
  /// only QUEUED rows would make Stop a no-op whenever a page is in flight.
  /// Deleting the RUNNING ticket cannot abort the model call — the page in
  /// flight still finishes and is still kept, which was always Stop's honest
  /// meaning — it makes the worker's settle CAS miss, so the chain ends there
  /// instead of walking on. What stopping leaves behind is the settled rows,
  /// which read as "Stopped — N of M designed" until the window closes and the
  /// resume offer takes over.
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
      /// Zero is not an error: the chain may have settled its last page while
      /// the button was being pressed, and "nothing left to stop" is that run
      /// answering honestly.
      return { stopped: unqueued.count > 0 };
    }),

  /// The resume offer's press (§IX.5, multi-vibes-and-preview-prd §II.6): the
  /// first blank page goes back on the queue and the chain walks on from
  /// there. A mutation where the offer is a query, because pressing it spends
  /// money — a design call per remaining page — and the enqueue is the whole
  /// of what it does: which pages are blank was `offer`'s read, and the worker
  /// re-reads the scene per page anyway.
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

      /// The offer card's own guard, said server-side too: a board whose chain
      /// is still walking has nothing to resume, and a second chain head over
      /// the same board would be two workers designing the same pages at once.
      /// A courtesy check rather than a lock — two presses in the same instant
      /// can still both file, and what bounds that is the worker's
      /// already-designed settle — but the button this answers is drawn only
      /// when no live card exists, so the race needs two browsers and one tick.
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

      /// The first blank page and only it, `start`'s own shape: the chain
      /// hands the rest over as each page settles (§II.2).
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
