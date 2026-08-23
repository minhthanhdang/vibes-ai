import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { runOrchestratorTurn } from "@/server/agents/turn";
import { asHistory, forStorage, messageSchema, type Part } from "@/lib/agent/conversation";
import { CHAT_LIST_LIMIT, wireMessage } from "@/server/api/routers/chat";
import { conversationFor, touchConversation } from "@/server/chat/conversations";
import { PAGES_PER_MESSAGE } from "@/lib/pages/page-brief";
import type { Prisma } from "@/generated/prisma/client";

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

export const orchestratorRouter = createTRPCRouter({
  /// One user message in, one assistant reply out — plus whatever the tools
  /// put in front of them. Ownership is the only thing decided here; the turn
  /// itself is `runOrchestratorTurn`, so the command-line harness runs it too.
  send: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        /// Which thread this is being asked in (orchestrator-tool-reference
        /// §VII.5). Required, and the browser always has one — it minted the id
        /// at "New chat" and the thread is opened by the write below if nothing
        /// has been said in it yet.
        conversationId: z.string(),
        message: z.string().min(1).max(2000),
        /// At most two per message, and the turn clamps to the same number: a
        /// page rides on every tool round of the turn as an image part plus a
        /// text block, so this is the one input whose size is multiplied by the
        /// turn's own shape.
        pages: z.array(attachedPage).max(PAGES_PER_MESSAGE).default([]),
        /// Which board the tab is showing, so the turn can prime that one
        /// (§II.1). Optional because a message can be sent from a project page
        /// with no board open, and unchecked against the project on purpose: an
        /// id from a tab whose board was deleted since primes as no board rather
        /// than failing a send.
        currentBoardId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      /// Read at the top, so the thread sorts by when the question was asked
      /// rather than by when the turn committed: a long question asked in one
      /// thread before a short one in another must not sort below it (§VII.1).
      const at = new Date();

      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      /// The conversation, read back from the store rather than posted by the
      /// browser: the same page `chat.list` hydrates the column from, parsed by
      /// the same schema and reduced by the same projection, so what the user
      /// can see the model was told is what it was told — held now by there
      /// being one copy, not by two ends kept in agreement. Read before the
      /// turn is run and its rows are written, so the question being asked is
      /// not its own history.
      ///
      /// Off `conversationId` and not off the project, which is the whole of the
      /// feature (§VII.5): the window is spent on the thread being asked in.
      /// Scoped through the project as well, so an id naming someone else's
      /// thread reads as the empty history it deserves — and is refused
      /// outright by the write below.
      ///
      /// A thread nobody has spoken in yet is not a row, and reads as no
      /// history. That is the correct answer rather than a missing one.
      const rows = await ctx.db.chatMessage.findMany({
        where: { conversationId: input.conversationId, conversation: { projectId: project.id } },
        orderBy: { seq: "desc" },
        take: CHAT_LIST_LIMIT,
      });
      const history = asHistory(
        rows.reverse().flatMap((row) => {
          const parsed = messageSchema.safeParse(wireMessage(row));
          return parsed.success ? [parsed.data] : [];
        }),
      );

      /// `runOrchestratorTurn` takes a project and a history and knows nothing
      /// about threads — from inside a turn there is only one conversation,
      /// which is what keeps the model, the instruction and the floors exactly
      /// where they were (§VII).
      const { reply, attachments, parts, pages } = await runOrchestratorTurn({
        db: ctx.db,
        projectId: project.id,
        message: input.message,
        pages: input.pages,
        currentBoardId: input.currentBoardId,
        history,
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
      /// A short transaction after the turn and never around it: a Postgres
      /// transaction must not be held open for the length of a Gemini call. The
      /// thread is opened here if it is not there yet, which also means a thread
      /// deleted from a second tab while this turn was running is re-opened by
      /// the turn's own write rather than the paid answer being thrown away.
      const conversationId = await ctx.db.$transaction(async (tx) => {
        const conversation = await conversationFor(tx, {
          id: input.conversationId,
          projectId: project.id,
        });
        await tx.chatMessage.createMany({
          data: [
            { conversationId: conversation.id, turnId, role: "user", status: "sent", parts: asked },
            {
              conversationId: conversation.id,
              turnId,
              role: "assistant",
              status: "sent",
              parts: answered,
            },
          ].map((row) => ({ ...row, parts: row.parts as unknown as Prisma.InputJsonValue })),
        });
        await touchConversation(tx, conversation.id, at);
        return conversation.id;
      });

      return { reply, attachments, conversationId };
    }),
});
