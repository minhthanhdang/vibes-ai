import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { runOrchestratorTurn } from "@/server/agents/orchestrator/turn";
import { asHistory, forStorage, messageSchema, type Part } from "@/lib/agent/shared/conversation";
import { CHAT_LIST_LIMIT, wireMessage } from "@/server/api/routers/chat";
import { conversationFor, touchConversation } from "@/server/chat/conversations";
import { withEvents } from "@/server/agents/shared/agent-scope";
import { eventStream } from "@/lib/agent/shared/event-stream";
import type { TurnEvent } from "@/lib/agent/shared/turn-events";
import { PAGES_PER_MESSAGE } from "@/lib/pages/page-brief";
import type { Prisma } from "@/generated/prisma/client";

const attachedPage = z.object({
  boardId: z.string(),
  pageId: z.string(),
  revision: z.number().int().nonnegative(),
  renderUri: z.string().nullish(),
});

export const orchestratorRouter = createTRPCRouter({
  send: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        conversationId: z.string(),
        message: z.string().min(1).max(2000),
        pages: z.array(attachedPage).max(PAGES_PER_MESSAGE).default([]),
        currentBoardId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const at = new Date();

      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

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

      const stream = eventStream<TurnEvent>();

      const work = withEvents(stream.emit, async () => {
        const { reply, attachments, parts, pages } = await runOrchestratorTurn({
          db: ctx.db,
          projectId: project.id,
          message: input.message,
          pages: input.pages,
          currentBoardId: input.currentBoardId,
          history,
        });

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

        return { reply, attachments, conversationId, parts: answered };
      });

      const settled: Promise<TurnEvent> = work.then(
        (answer) => {
          stream.close();
          return { kind: "answer", ...answer } as const;
        },
        (cause) => {
          console.error("orchestrator.send failed:", cause);
          stream.close();
          return {
            kind: "failed",
            error: cause instanceof Error ? cause.message : String(cause),
          } as const;
        },
      );

      try {
        after(settled);
      } catch (cause) {
        console.error("the turn could not be kept alive past the response:", cause);
      }

      return (async function* turnWindow(): AsyncGenerator<TurnEvent> {
        for await (const event of stream.read()) yield event;
        yield await settled;
      })();
    }),
});
