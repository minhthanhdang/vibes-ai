import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { sceneWrite } from "@/server/moodboards/scene-write";
import {
  VIBES_PAGE_LIMIT,
  VIBES_TEXT_LIMIT,
  vibesBrief,
} from "@/lib/vibes/vibes-brief";
import { vibesAsk, vibesBoard } from "@/lib/vibes/vibes-start";
import type { Part } from "@/lib/agent/conversation";
import type { Prisma } from "@/generated/prisma/client";

/// "Let's Vibes" — the product's headline action (compositor-v2.md §IX).
///
/// Two mutations, and this file holds the first. `start` makes the board and
/// makes no model call; the browser then walks the `pageIds` it comes back
/// with, one `designPage` at a time. Sequential and browser-driven is the
/// decision (§IX.2): there is no queue and no streaming in this app, so six
/// pages in one mutation would be one request running for minutes with nothing
/// to show and nothing to stop — where six mutations are bounded work, honest
/// progress, a failure at page four that keeps pages one to three, and a Stop
/// button that means it.

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
});
