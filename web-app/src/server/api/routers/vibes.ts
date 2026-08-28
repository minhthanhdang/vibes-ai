import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { sceneWrite } from "@/server/moodboards/scene-write";
import {
  VIBES_PAGE_LIMIT,
  VIBES_TEXT_LIMIT,
  storedBrief,
  vibesBrief,
} from "@/lib/vibes/vibes-brief";
import { vibesBoard } from "@/lib/vibes/vibes-start";
import { vibesAsk } from "@/lib/vibes/vibes-account";
import { vibesPending, vibesRun } from "@/lib/vibes/vibes-resume";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import { runVibesPage } from "@/server/agents/vibes/run-vibes-page";
import type { Part } from "@/lib/agent/shared/conversation";
import type { Prisma } from "@/generated/prisma/client";
import { after } from "next/server";
import { withEvents } from "@/server/agents/shared/agent-scope";
import { eventStream } from "@/lib/agent/shared/event-stream";
import type { VibesEvent } from "@/lib/vibes/vibes-events";

/// "Let's Vibes" — the product's headline action (compositor-v2.md §IX).
///
/// Two mutations. `start` makes the board and makes no model call; the browser
/// then walks the `pageIds` it comes back with, calling `designPage` once per
/// page, in order. Sequential and browser-driven is the decision (§IX.2):
/// there is no queue and no streaming in this app, so six
/// pages in one mutation would be one request running for minutes with nothing
/// to show and nothing to stop — where six mutations are bounded work, honest
/// progress, a failure at page four that keeps pages one to three, and a Stop
/// button that means it.
///
/// `resume` is the third, and it is a read: a closed tab stops the loop (§IX.5)
/// and nothing on the server is watching for that, so the answer is a question
/// the browser can ask of a half-finished board when it is opened again.

export const vibesRouter = createTRPCRouter({
  /// The board, its pages and their ground, from the form alone.
  ///
  /// The input schema is deliberately loose about everything `vibesBrief`
  /// decides — it stops a payload nobody could have typed and nothing more.
  /// The form's own rules live in one reader (§IX.3) so that what the browser
  /// refuses beside a field and what the server refuses are the same reading of
  /// the same brief, rather than two that drift a release apart.
  start: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        purpose: z.string().max(VIBES_TEXT_LIMIT),
        pages: z.number().int().min(1).max(VIBES_PAGE_LIMIT),
        palette: z.array(z.string()),
        vibes: z.string().max(VIBES_TEXT_LIMIT).default(""),
        preset: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      /// Read at the top, for the reason every other speaking door reads it
      /// there: the thread sorts by when the user asked (§VII.1).
      const at = new Date();

      const brief = vibesBrief(input);
      if (!brief)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "that brief is unreadable",
        });

      const board = vibesBoard({ brief });

      /// One statement: a board row that exists without its pages is a board
      /// the user is navigated to and finds empty, and the pages are the whole
      /// of what `start` was for.
      const made = await ctx.db.moodboard.create({
        data: {
          projectId: project.id,
          title: board.title,
          /// The board's default page size becomes the preset the form chose,
          /// so a seventh page added by hand afterwards comes at the shape the
          /// set is in (§V.2).
          widthPx: board.size.width,
          heightPx: board.size.height,
          /// The brief, kept on the board it made (§IX.2). Every design call
          /// after this one asks for the same set, and the two halves of the
          /// ask that nothing on the board carries are the user's own words and
          /// the four colours past the ground — so a run whose form was typed
          /// in a tab that has since closed can still be finished.
          vibesBrief: brief as unknown as Prisma.InputJsonValue,
          ...sceneWrite(board.elements),
        },
        select: { id: true, title: true },
      });

      /// The run goes in the conversation, starting here (§IX.2) — and in a
      /// conversation **of its own** (orchestrator-tool-reference §VII.9). The
      /// run is a thread by any reading: one ask, a known number of answers, and
      /// an end. Dropping six assistant rows into whatever the user last had
      /// open is the case multi-chat exists to prevent.
      ///
      /// Written after the board rather than before it, so a create that fails
      /// leaves no row asking for a board that was never made — and it is a turn
      /// of its own, the way `chat.record` is: the assistant rows that answer it
      /// are one per page and arrive from `designPage`, each its own turn.
      ///
      /// The thread names itself the way every other does: no `title` is
      /// written, and its first user row is `Let's Vibes — <purpose>`, so the
      /// switcher reads that with no title column to go stale (§VII.4).
      const conversation = await ctx.db.$transaction(async (tx) => {
        const opened = await tx.conversation.create({
          data: { projectId: project.id, createdAt: at, updatedAt: at },
          select: { id: true },
        });
        await tx.chatMessage.create({
          data: {
            conversationId: opened.id,
            turnId: randomUUID(),
            role: "user",
            status: "sent",
            parts: [
              { type: "text", text: vibesAsk(brief) },
            ] satisfies Part[] as unknown as Prisma.InputJsonValue,
          },
        });
        return opened;
      });

      /// The thread's id goes on the board, because it has to outlive the tab:
      /// `resume` reads the board and nothing else, so a run picked up the next
      /// morning writes its remaining pages into the same thread (§VII.9).
      /// Stamped after both, for the reason the message was written after the
      /// board — a board pointing at a thread that was never opened is the one
      /// half-state this order rules out.
      await ctx.db.moodboard.update({
        where: { id: made.id },
        data: { conversationId: conversation.id },
      });

      /// The column is deliberately *not* moved onto this thread. The user is
      /// watching the run panel; yanking their column onto a conversation they
      /// did not open is the interruption multi-chat exists to prevent, and the
      /// thread is already at the top of the switcher for whenever they want it.
      return {
        boardId: made.id,
        title: made.title,
        pageIds: board.pageIds,
        conversationId: conversation.id,
      };
    }),

  /// Where a stopped run picks up (§IX.5).
  ///
  /// A query and not a mutation, which is the whole shape of the answer: the
  /// pages already exist, the brief is already on the board, and nothing here
  /// decides anything — it reads the scene and says which pages are still
  /// blank. The browser then walks `pending` exactly as it walked `start`'s own
  /// `pageIds`, calling `designPage` with the index each one carries.
  ///
  /// Read off the scene rather than off a record of what ran. A record would be
  /// a second account of the same fact, kept current by every design call and
  /// wrong the morning a page is discarded by hand — where the scene cannot be
  /// wrong about whether anything is on a page, because being on the page is
  /// what the question means.
  resume: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(async ({ ctx, input }) => {
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.boardId, project: { userId: ctx.user.id } },
        select: { id: true, title: true, vibesBrief: true, elements: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      /// A board with no brief on it was not made by this form and has no run
      /// to pick up, which is a `null` rather than the refusal `designPage`
      /// makes: this is the question the browser asks of *every* board it
      /// opens, and most boards in a project were never a Vibes run. Still not
      /// an empty list — an empty `pending` reads as "this run is finished",
      /// and a board that was never a run has not finished one.
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

  /// One page of the run, designed. The browser calls this once per id in
  /// `start`'s `pageIds`, in order, waiting for each before it asks for the
  /// next — the pages have to be designed in reading order because every page
  /// after the first is asked to belong beside the ones already there (§IX.3).
  ///
  /// A caller and not an agent (§IX.2). Everything below the intention is
  /// `designPage`'s, unchanged and unforked: the day this door starts
  /// passing something agent 6's door cannot is the day agent 8 has two
  /// behaviours and one instruction (§IX.5). The body itself lives in
  /// `runVibesPage` (multi-vibes-and-preview-prd §II.4) so the queue worker
  /// can call it without a session; what stays here is what only a browser
  /// needs — the ownership check and the event stream.
  designPage: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        pageId: z.string(),
        /// The page's position in `start`'s own `pageIds`, which is what the
        /// browser is holding. 0-based here and said to the model 1-based; the
        /// bound is the page limit because a run cannot be longer than one.
        index: z.number().int().min(0).max(VIBES_PAGE_LIMIT - 1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      /// Someone else's board is a 404 the same way someone else's reference
      /// is, and the brief comes off the same read: a board with no brief on it
      /// was not made by this form, and designing a page of it from a form
      /// nobody filled in is the one thing this door must not invent.
      ///
      /// Ownership lives here and not in `runVibesPage`, because it is a fact
      /// about the *ask* rather than about the page: this door has a session to
      /// check it against, and the queue worker that is coming has none — its
      /// ask was checked when the job was enqueued
      /// (multi-vibes-and-preview-prd §II.4).
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.boardId, project: { userId: ctx.user.id } },
        select: { id: true, vibesBrief: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      /// Checked here as well as inside `runVibesPage`, because the two refuse
      /// differently and both refusals are right: this one is a BAD_REQUEST
      /// thrown before any stream is opened, where the extraction's is a throw
      /// its caller settles as a failure. Duplicated only until the mutation
      /// itself goes (§II.4).
      if (!storedBrief(board.vibesBrief))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "that board was not started from a Vibes brief",
        });

      /// Where this page's account of itself goes while it happens. Per page and
      /// not per run: the run is six mutations, so each page is its own stream
      /// with its own window onto its own work.
      const stream = eventStream<VibesEvent>();

      /// The page, started here and awaited by nobody in this function — the
      /// same shape and the same reason as `orchestrator.send`. tRPC calls
      /// `.return()` on the generator when the response is cancelled, so a page
      /// whose row was written inside the generator would be a page a closed tab
      /// designed, paid for and then forgot to record. The write is inside
      /// `runVibesPage`, which is inside this promise — started before the
      /// generator is handed back.
      ///
      /// `withEvents` wraps the call rather than living in the extraction: the
      /// stream exists to feed a watching browser, and the extraction's other
      /// caller has no watcher (§II.4).
      const work = withEvents(stream.emit, () =>
        runVibesPage({
          db: ctx.db,
          boardId: board.id,
          pageId: input.pageId,
          index: input.index,
        }),
      );

      /// The terminal event, and the reason `work` can never reject: both
      /// outcomes are turned into a value here, in the same tick the promise is
      /// made. A page that threw becomes a refusal the run can fold, which is
      /// exactly what the browser's own `catch` did with it before — and `after`
      /// below cannot produce an unhandled rejection.
      const settled: Promise<VibesEvent> = work.then(
        (answer) => {
          stream.close();
          const { conversationId, ...outcome } = answer;
          return { kind: "page", outcome, conversationId } as const;
        },
        (cause) => {
          console.error("vibes.designPage failed:", cause);
          stream.close();
          return {
            kind: "page",
            outcome: {
              pageId: input.pageId,
              error: cause instanceof Error ? cause.message : String(cause),
            },
            /// No thread to name: a page that threw never got as far as the row,
            /// so there is nothing for the panel to refresh.
            conversationId: "",
          } as const;
        },
      );

      /// The invocation's lifetime tied to the work rather than to the socket,
      /// `orchestrator.send`'s reason and `analysis-queue.ts`'s guard. A page is
      /// two to three minutes and the run is six of them.
      try {
        after(settled);
      } catch (cause) {
        console.error("the page could not be kept alive past the response:", cause);
      }

      /// A plain `async` resolver returning a generator rather than an
      /// `async function*` resolver: a generator's body does not run until it is
      /// pulled, which happens where `after` throws.
      return (async function* page(): AsyncGenerator<VibesEvent> {
        for await (const event of stream.read()) yield event;
        yield await settled;
      })();
    }),
});
