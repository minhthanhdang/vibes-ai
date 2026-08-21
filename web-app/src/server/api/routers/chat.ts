import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { EVENT_KINDS, chatAttachmentSchema } from "@/lib/agent/conversation";
import { subjectsIn } from "@/lib/agent/chat-log";
import type { ChatMessage, Prisma } from "@/generated/prisma/client";

/// A ceiling on one read, not on the conversation: the page the column hydrates
/// from, and the same page `orchestrator.send` reads history back from, newest
/// end kept. `historyWindow` decides what a request carries, and it works from
/// far less than this — messages past the ceiling are still rows, just not part
/// of the page the sidebar opens with.
export const CHAT_LIST_LIMIT = 200;

/// The row as the wire carries it: the format's own fields (`messageSchema`),
/// with `createdAt` as the `at` string and the store's columns nowhere renamed.
/// The client parses, because a stored row is never rejected on read and the
/// place that rule lives is the schema, not a router.
export const wireMessage = ({ id, seq, turnId, role, status, parts, createdAt }: ChatMessage) => ({
  id,
  seq,
  turnId,
  role,
  status,
  parts,
  at: createdAt.toISOString(),
});

export const chatRouter = createTRPCRouter({
  /// A project's conversation, oldest first. Ownership is re-derived from the
  /// project the way every other router does it, because the id came off the
  /// client.
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const rows = await ctx.db.chatMessage.findMany({
        where: { projectId: project.id },
        orderBy: { seq: "desc" },
        take: CHAT_LIST_LIMIT,
      });
      const messages = rows.reverse().map(wireMessage);

      /// A tile whose subject was deleted by another door — the gallery, the
      /// tab row, a session with no chat open — has no event in the log to
      /// settle it, so the dead are discovered by existence: one bulk read over
      /// the ids the stored attachments name. Only gone-ness is discovered;
      /// the attachments themselves are snapshots of what the assistant showed
      /// at the time and are never refreshed. The chat is a record.
      const named = subjectsIn(messages);
      const [boards, references] = await Promise.all([
        named.boardIds.length
          ? ctx.db.moodboard.findMany({
              where: { id: { in: named.boardIds }, projectId: project.id },
              select: { id: true },
            })
          : [],
        named.referenceIds.length
          ? ctx.db.reference.findMany({
              where: { id: { in: named.referenceIds }, projectId: project.id },
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

  /// The client's one door for writing a message: something the user did with
  /// their hands — a cut taken in the properties panel, a board or page or
  /// picture thrown away from an offer — which the conversation has to hear
  /// about without a turn being asked. It stays the user's, and it is a turn of
  /// its own: it asks nothing and answers nothing, so it shares a `turnId` with
  /// nothing.
  record: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        event: z.enum(EVENT_KINDS),
        note: z.string().min(1).max(2000),
        payload: z.json().optional(),
        /// A cut taken by hand carries its tile — the picture under the note,
        /// which is what a reload has to draw. Written as its own part after the
        /// event, the shape the assistant's answers keep tiles in.
        attachment: chatAttachmentSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const row = await ctx.db.chatMessage.create({
        data: {
          projectId: project.id,
          turnId: randomUUID(),
          role: "user",
          status: "sent",
          parts: [
            { type: "event", event: input.event, note: input.note, payload: input.payload ?? null },
            ...(input.attachment ? [{ type: "attachment", attachment: input.attachment }] : []),
          ] as Prisma.InputJsonValue,
        },
      });
      return wireMessage(row);
    }),
});
