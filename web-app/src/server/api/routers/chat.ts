import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { EVENT_KINDS, chatAttachmentSchema } from "@/lib/agent/shared/conversation";
import { subjectsIn } from "@/lib/agent/shared/chat-log";
import {
  CONVERSATIONS_PER_PROJECT,
  CONVERSATION_TITLE_LIMIT,
  NEW_CHAT_TITLE,
  conversationLabel,
  normalizedConversationTitle,
} from "@/lib/agent/shared/conversation-list";
import { conversationFor, ownedConversation, touchConversation } from "@/server/chat/conversations";
import type { ChatMessage, Prisma } from "@/generated/prisma/client";

export const CHAT_LIST_LIMIT = 200;

export const wireMessage = ({ id, seq, turnId, role, status, parts, createdAt }: ChatMessage) => ({
  id,
  seq,
  turnId,
  role,
  status,
  parts,
  at: createdAt.toISOString(),
});

const CONVERSATION_ROW = {
  id: true,
  title: true,
  updatedAt: true,
  messages: {
    where: { role: "user" },
    orderBy: { seq: "asc" },
    take: 1,
    select: { parts: true },
  },
} satisfies Prisma.ConversationSelect;

type ConversationRow = {
  id: string;
  title: string;
  updatedAt: Date;
  messages: { parts: unknown }[];
};

const wireConversation = ({ id, title, updatedAt, messages }: ConversationRow) => ({
  id,
  title: conversationLabel({ title, firstUserParts: messages[0]?.parts }),
  updatedAt,
});

export const chatRouter = createTRPCRouter({
  conversations: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const rows = await ctx.db.conversation.findMany({
        where: { projectId: project.id },
        orderBy: { updatedAt: "desc" },
        take: CONVERSATIONS_PER_PROJECT,
        select: CONVERSATION_ROW,
      });

      return rows.map(wireConversation);
    }),

  list: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const conversation = await ownedConversation(ctx, { id: input.conversationId });

      const rows = await ctx.db.chatMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { seq: "desc" },
        take: CHAT_LIST_LIMIT,
      });
      const messages = rows.reverse().map(wireMessage);

      const named = subjectsIn(messages);
      const [boards, references] = await Promise.all([
        named.boardIds.length
          ? ctx.db.moodboard.findMany({
              where: { id: { in: named.boardIds }, projectId: conversation.projectId },
              select: { id: true },
            })
          : [],
        named.referenceIds.length
          ? ctx.db.reference.findMany({
              where: { id: { in: named.referenceIds }, projectId: conversation.projectId },
              select: { id: true },
            })
          : [],
      ]);
      const alive = new Set([...boards, ...references].map((row) => row.id));
      return {
        messages,
        gone: {
          boardIds: named.boardIds.filter((id) => !alive.has(id)),
          referenceIds: named.referenceIds.filter((id) => !alive.has(id)),
        },
      };
    }),

  record: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        conversationId: z.string(),
        event: z.enum(EVENT_KINDS),
        note: z.string().min(1).max(2000),
        payload: z.json().optional(),
        attachment: chatAttachmentSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const at = new Date();

      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.$transaction(async (tx) => {
        const conversation = await conversationFor(tx, {
          id: input.conversationId,
          projectId: project.id,
        });
        const row = await tx.chatMessage.create({
          data: {
            conversationId: conversation.id,
            turnId: randomUUID(),
            role: "user",
            status: "sent",
            parts: [
              {
                type: "event",
                event: input.event,
                note: input.note,
                payload: input.payload ?? null,
              },
              ...(input.attachment ? [{ type: "attachment", attachment: input.attachment }] : []),
            ] as Prisma.InputJsonValue,
          },
        });
        await touchConversation(tx, conversation.id, at);
        return { message: wireMessage(row), conversationId: conversation.id };
      });
    }),

  clear: protectedProcedure
    .input(z.object({ projectId: z.string(), conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await ownedConversation(ctx, {
        id: input.conversationId,
        projectId: input.projectId,
      });

      return ctx.db.$transaction(async (tx) => {
        let title = conversation.title;
        if (!title.trim()) {
          const first = await tx.chatMessage.findFirst({
            where: { conversationId: conversation.id, role: "user" },
            orderBy: { seq: "asc" },
            select: { parts: true },
          });
          const derived = conversationLabel({ title: "", firstUserParts: first?.parts });
          if (derived !== NEW_CHAT_TITLE) {
            title = derived;
            await tx.conversation.update({ where: { id: conversation.id }, data: { title } });
          }
        }

        await tx.chatMessage.deleteMany({ where: { conversationId: conversation.id } });

        return { id: conversation.id, title };
      });
    }),

  remove: protectedProcedure
    .input(z.object({ projectId: z.string(), conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await ownedConversation(ctx, {
        id: input.conversationId,
        projectId: input.projectId,
      });
      await ctx.db.conversation.delete({ where: { id: conversation.id } });
      return { id: conversation.id };
    }),

  rename: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        conversationId: z.string(),
        title: z.string().max(CONVERSATION_TITLE_LIMIT),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await ownedConversation(ctx, {
        id: input.conversationId,
        projectId: input.projectId,
      });
      const written = normalizedConversationTitle(input.title) ?? "";
      const renamed = await ctx.db.conversation.update({
        where: { id: conversation.id },
        data: { title: written },
        select: CONVERSATION_ROW,
      });
      return wireConversation(renamed);
    }),
});
