import "server-only";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@/generated/prisma/client";
import type { Context } from "@/server/api/trpc";

type OwnedContext = Context & { user: { id: string } };

export async function ownedConversation(
  ctx: OwnedContext,
  { id, projectId }: { id: string; projectId?: string },
) {
  const conversation = await ctx.db.conversation.findFirst({
    where: { id, ...(projectId ? { projectId } : {}), project: { userId: ctx.user.id } },
    select: { id: true, projectId: true, title: true },
  });
  if (!conversation) throw new TRPCError({ code: "NOT_FOUND" });
  return conversation;
}

export async function conversationFor(
  tx: Prisma.TransactionClient,
  { id, projectId }: { id: string; projectId: string },
) {
  const existing = await tx.conversation.findUnique({
    where: { id },
    select: { id: true, projectId: true },
  });
  if (existing) {
    if (existing.projectId !== projectId) throw new TRPCError({ code: "NOT_FOUND" });
    return existing;
  }

  await tx.conversation.createMany({ data: [{ id, projectId }], skipDuplicates: true });
  const opened = await tx.conversation.findUnique({
    where: { id },
    select: { id: true, projectId: true },
  });
  if (!opened || opened.projectId !== projectId) throw new TRPCError({ code: "NOT_FOUND" });
  return opened;
}

export function touchConversation(tx: Prisma.TransactionClient, id: string, at: Date) {
  return tx.conversation.update({ where: { id }, data: { updatedAt: at }, select: { id: true } });
}
