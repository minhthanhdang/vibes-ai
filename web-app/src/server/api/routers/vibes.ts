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
  vibesIntention,
} from "@/lib/vibes/vibes-brief";
import { vibesBoard } from "@/lib/vibes/vibes-start";
import { vibesAsk, vibesSaid } from "@/lib/vibes/vibes-account";
import { vibesPageDesigned, vibesPending, vibesRun } from "@/lib/vibes/vibes-resume";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import { designPage } from "@/server/agents/designer/design";
import { designerReferences } from "@/server/agents/designer/references";
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
  /// `designPage`'s, unchanged and unforked: the day this mutation starts
  /// passing something agent 6's door cannot is the day agent 8 has two
  /// behaviours and one instruction (§IX.5).
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
      const board = await ctx.db.moodboard.findFirst({
        where: { id: input.boardId, project: { userId: ctx.user.id } },
        select: { id: true, projectId: true, conversationId: true, vibesBrief: true },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });

      const brief = storedBrief(board.vibesBrief);
      if (!brief)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "that board was not started from a Vibes brief",
        });

      /// The project's whole gallery, in the order `list_gallery` answers in —
      /// starred first, then newest — because the catalogue in the intention is
      /// capped at `CATALOG_LIMIT` and the cap is only defensible if what
      /// survives it is the front of that order. Not the canvas selection: the
      /// board is minutes old, so a selection on the one the user was looking
      /// at before the form means nothing here.
      const { all } = await designerReferences({ db: ctx.db, projectId: board.projectId })();

      /// Where this page's account of itself goes while it happens. Per page and
      /// not per run: the run is six mutations, so each page is its own stream
      /// with its own window onto its own work.
      const stream = eventStream<VibesEvent>();

      /// The page, started here and awaited by nobody in this function — the
      /// same shape and the same reason as `orchestrator.send`. tRPC calls
      /// `.return()` on the generator when the response is cancelled, so a page
      /// whose row was written inside the generator would be a page a closed tab
      /// designed, paid for and then forgot to record.
      const work = withEvents(stream.emit, async () => {
        /// No `budget`, alone among agent 8's callers. The ceilings are a turn's
        /// (§VII) and agent 6's door hands down the turn it is running inside;
        /// this is a page of its own, so each one opens its own — which is the
        /// honest reading of a run the user watches page by page and can stop.
        const outcome = await designPage({
          db: ctx.db,
          projectId: board.projectId,
          boardId: board.id,
          pageId: input.pageId,
          intention: vibesIntention({ brief, index: input.index, pictures: all }),
        });

        /// Did anything land? A design that runs out of rounds does not refuse —
        /// it answers with agent 8's own "I ran out of steps" line — so a run
        /// that took every line for a page reported six successes over a board
        /// with five pages on it (§IX.5). The scene is the only thing that knows,
        /// and it is asked the same way `vibes.resume` asks it, off the same
        /// reader, so the walk's account and the offer the board makes when it is
        /// next opened cannot disagree.
        ///
        /// One read of the elements column against a design call that costs
        /// minutes and dollars, and only when the design answered: a refusal
        /// placed nothing by definition.
        const empty =
          "line" in outcome
            ? await ctx.db.moodboard
                .findUnique({ where: { id: board.id }, select: { elements: true } })
                .then((written) =>
                  written
                    ? !vibesPageDesigned({
                        elements: persistableElements(written.elements),
                        pageId: input.pageId,
                      })
                    : false,
                )
            : false;

        /// One assistant row per page, carrying agent 8's own closing line
        /// (§IX.2) — and carrying the refusal when there is no line, because the
        /// conversation is the only account of the run the user ever reads. A run
        /// that stopped at page four otherwise leaves three answers under an ask
        /// for six pages and nothing saying which page went missing or why.
        ///
        /// The row's sentence is `vibesSaid`'s and not built here: the ask and
        /// every answer under it are one account written by two mutations, and
        /// the page number is on all of them because the line is on none of them.
        /// Into the run's own thread (orchestrator-tool-reference §VII.9), which
        /// the board is carrying — and into a thread opened here when it is not.
        /// Null happens twice: a board composed before conversations existed, and
        /// a board whose thread the user deleted mid-run. Writing no row in either
        /// case would leave a resumed run with no account of itself, which is the
        /// thing §IX.2 exists to prevent, so the run gets a thread rather than
        /// losing its record.
        ///
        /// `updatedAt` is deliberately left where `start` put it: the ask is when
        /// the user spoke, and a run answering its own pages for twenty minutes is
        /// not the user speaking again (§VII.1).
        const conversationId = await ctx.db.$transaction(async (tx) => {
          const id =
            board.conversationId ??
            (
              await tx.conversation.create({
                data: { projectId: board.projectId },
                select: { id: true },
              })
            ).id;
          if (!board.conversationId) {
            await tx.moodboard.update({ where: { id: board.id }, data: { conversationId: id } });
          }
          await tx.chatMessage.create({
            data: {
              conversationId: id,
              turnId: randomUUID(),
              role: "assistant",
              status: "sent",
              parts: [
                {
                  type: "text",
                  text: vibesSaid({
                    index: input.index,
                    total: brief.pages,
                    outcome:
                      "line" in outcome ? { line: outcome.line, empty } : { error: outcome.error },
                  }),
                },
              ] satisfies Part[] as unknown as Prisma.InputJsonValue,
            },
          });
          return id;
        });

        /// The outcome goes back rather than being thrown, refusal and all: the
        /// browser is the loop, and a loop told a page failed can stop with the
        /// pages before it kept — which is the whole reason this is six mutations
        /// and not one.
        /// The thread rides back on both branches: the run panel is the only thing
        /// that knows a row was just written into a conversation the browser may
        /// be showing, and nothing else would tell that column about it (§VII.9).
        return "line" in outcome
          ? {
              pageId: input.pageId,
              conversationId,
              line: outcome.line,
              /// Not a refusal and not a halt: the loop counts the page out of
              /// what is designed and walks on, because the next page is as
              /// likely to finish as this one was.
              empty,
              calls: outcome.calls,
              runId: outcome.runId,
            }
          : { pageId: input.pageId, conversationId, error: outcome.error };
      });

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
