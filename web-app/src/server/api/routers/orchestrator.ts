import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { runOrchestratorTurn } from "@/server/agents/turn";
import { forStorage, type Part } from "@/lib/agent/conversation";
import { PAGES_PER_MESSAGE } from "@/lib/pages/page-brief";
import type { Prisma } from "@/generated/prisma/client";

const turn = z.object({ role: z.enum(["user", "model"]), text: z.string() });

/// A page the user attached to this message (§V.5): a pointer to one, and a
/// picture of it. Nothing that is *said* about the page comes from here — the
/// turn builds that from the stored scene — so the only thing this schema has to
/// stop is a payload nobody could have meant.
const attachedPage = z.object({
  boardId: z.string(),
  pageId: z.string(),
  revision: z.number().int().nonnegative(),
  renderUri: z.string().nullish(),
});

/// A ceiling on the *payload*, not on the conversation. What the model is shown
/// is decided by `historyWindow` inside the turn, which clamps; this only stops
/// a body nobody could have meant. It was 20 and it was the window, which made
/// the twenty-first message of a project a permanent validation failure rather
/// than a longer conversation.
const HISTORY_PAYLOAD_LIMIT = 200;

export const orchestratorRouter = createTRPCRouter({
  /// One user message in, one assistant reply out — plus whatever the tools
  /// put in front of them. Ownership is the only thing decided here; the turn
  /// itself is `runOrchestratorTurn`, so the command-line harness runs it too.
  send: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        message: z.string().min(1).max(2000),
        history: z.array(turn).max(HISTORY_PAYLOAD_LIMIT).default([]),
        /// At most two per message, and the turn clamps to the same number: a
        /// page rides on every tool round of the turn as an image part plus a
        /// text block, so this is the one input whose size is multiplied by the
        /// turn's own shape.
        pages: z.array(attachedPage).max(PAGES_PER_MESSAGE).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const { reply, attachments, parts, pages } = await runOrchestratorTurn({
        db: ctx.db,
        projectId: project.id,
        message: input.message,
        pages: input.pages,
        history: input.history,
      });

      /// The turn, kept. Written here rather than inside the turn because this
      /// mutation is the door that owns the project id and has checked it —
      /// `npm run smoke` runs the same turn with no rows to write — and written
      /// after the turn rather than around it so a turn that dies leaves
      /// nothing: a `failed` message is the browser's to draw and never a row.
      /// A tab that closes mid-turn changes none of this — the mutation runs to
      /// the end on the server, so the answer it paid for is stored either way.
      ///
      /// The pages stored are the ones the turn validated, joined back to the
      /// client's claims only for the fields validation does not return; the
      /// answer is the turn's record (`forStorage`) with what the tools put in
      /// front of the user after the words, the order the column draws them in.
      const turnId = randomUUID();
      const claimed = new Map(input.pages.map((page) => [`${page.boardId}/${page.pageId}`, page]));
      const asked: Part[] = [
        ...pages.map(({ boardId, pageId, name }): Part => {
          const page = claimed.get(`${boardId}/${pageId}`);
          return {
            type: "page",
            boardId,
            pageId,
            revision: page?.revision ?? 0,
            name,
            ...(page?.renderUri ? { renderUri: page.renderUri } : {}),
          };
        }),
        { type: "text", text: input.message },
      ];
      const answered: Part[] = [
        ...forStorage(parts),
        ...attachments.map((attachment): Part => ({ type: "attachment", attachment })),
      ];
      await ctx.db.chatMessage.createMany({
        data: [
          { projectId: project.id, turnId, role: "user", status: "sent", parts: asked },
          { projectId: project.id, turnId, role: "assistant", status: "sent", parts: answered },
        ].map((row) => ({ ...row, parts: row.parts as unknown as Prisma.InputJsonValue })),
      });

      return { reply, attachments };
    }),
});
