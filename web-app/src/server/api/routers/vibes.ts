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
import { vibesAsk, vibesBoard } from "@/lib/vibes/vibes-start";
import { vibesPending, vibesRun } from "@/lib/vibes/vibes-resume";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import { designPage } from "@/server/agents/designer/design";
import { designerReferences } from "@/server/agents/designer/references";
import type { Part } from "@/lib/agent/conversation";
import type { Prisma } from "@/generated/prisma/client";

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

      /// The run goes in the conversation, starting here (§IX.2). Written after
      /// the board rather than before it, so a create that fails leaves no row
      /// asking for a board that was never made — and it is a turn of its own,
      /// the way `chat.record` is: the assistant rows that answer it are one per
      /// page and arrive from `designPage`, each its own turn.
      await ctx.db.chatMessage.create({
        data: {
          projectId: project.id,
          turnId: randomUUID(),
          role: "user",
          status: "sent",
          parts: [
            { type: "text", text: vibesAsk(brief) },
          ] satisfies Part[] as unknown as Prisma.InputJsonValue,
        },
      });

      return { boardId: made.id, title: made.title, pageIds: board.pageIds };
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

      /// The same refusal `designPage` makes, and for the same reason: a board
      /// with no brief on it was not made by this form, and there is no run to
      /// pick up. Refused here rather than answered with an empty list, because
      /// an empty list reads as "nothing left to do".
      const brief = storedBrief(board.vibesBrief);
      if (!brief)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "that board was not started from a Vibes brief",
        });

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
        select: { id: true, projectId: true, vibesBrief: true },
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

      /// One assistant row per page, carrying agent 8's own closing line
      /// (§IX.2) — and carrying the refusal when there is no line, because the
      /// conversation is the only account of the run the user ever reads. A run
      /// that stopped at page four otherwise leaves three answers under an ask
      /// for six pages and nothing saying which page went missing or why.
      const said =
        "line" in outcome
          ? outcome.line
          : `Page ${input.index + 1} was not designed — ${outcome.error}`;
      await ctx.db.chatMessage.create({
        data: {
          projectId: board.projectId,
          turnId: randomUUID(),
          role: "assistant",
          status: "sent",
          parts: [{ type: "text", text: said }] satisfies Part[] as unknown as Prisma.InputJsonValue,
        },
      });

      /// The outcome goes back rather than being thrown, refusal and all: the
      /// browser is the loop, and a loop told a page failed can stop with the
      /// pages before it kept — which is the whole reason this is six mutations
      /// and not one.
      return "line" in outcome
        ? { pageId: input.pageId, line: outcome.line, calls: outcome.calls, runId: outcome.runId }
        : { pageId: input.pageId, error: outcome.error };
    }),
});
