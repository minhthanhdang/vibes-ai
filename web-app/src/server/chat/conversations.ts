import "server-only";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@/generated/prisma/client";
import type { Context } from "@/server/api/trpc";

/// One ownership rule for the doors onto a conversation, shared the way
/// `moodboard.ts` shares `ownedProject`/`ownedBoard` (orchestrator-tool-reference
/// §VII.1). Five procedures across three routers write or read a thread by an id
/// that came off the client, and five copies of the check is four chances to
/// write one of them slightly differently.

type OwnedContext = Context & { user: { id: string } };

/// Someone else's thread is a 404 the same way someone else's board is — the
/// existence of a row is private, so this is never a 403.
///
/// `projectId` is optional because `chat.list` is given only a conversation id
/// and takes the project *off* the row; every write door has a project id in
/// hand and passes it, which is what stops a thread of one project being
/// written through a door opened on another.
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

/// The thread an id names, opened if it is not there yet (§VII.3).
///
/// "New chat" writes no row — the browser mints the id and the first thing said
/// creates the thread — so every write door has to be able to open one. What it
/// is *not* is an upsert: an id that already names a row must belong to
/// `projectId`, or a guessed id would write into someone else's thread. The
/// caller has already established that `projectId` is this user's, which is what
/// makes the create below safe and the equality check above sufficient.
///
/// The unique violation is caught rather than prevented because two doors can
/// legitimately race: a turn running for ninety seconds and a cut taken in the
/// properties panel while it runs are two writes into one unspoken thread.
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

  try {
    return await tx.conversation.create({
      data: { id, projectId },
      select: { id: true, projectId: true },
    });
  } catch (cause) {
    /// The other door got there first. It opened the same id under the same
    /// project — the id is the browser's and the browser is in one project — so
    /// re-reading is the whole of the recovery.
    if (!(cause instanceof Prisma.PrismaClientKnownRequestError) || cause.code !== "P2002") throw cause;
    const raced = await tx.conversation.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });
    if (!raced || raced.projectId !== projectId) throw new TRPCError({ code: "NOT_FOUND" });
    return raced;
  }
}

/// What orders the switcher, moved (§VII.1).
///
/// `at` is the caller's, captured at the *top* of the mutation rather than read
/// off the clock here: a turn takes ninety seconds and writes its rows at the
/// end, so a long question asked in thread A before a short one in B would
/// otherwise sort below B for having committed later.
///
/// Only the two doors that mean *spoken in* call this. A rename is not speaking
/// in a thread and neither is clearing one, and either bumping the list would
/// break the only ordering a user can predict without reading.
export function touchConversation(tx: Prisma.TransactionClient, id: string, at: Date) {
  return tx.conversation.update({ where: { id }, data: { updatedAt: at }, select: { id: true } });
}
