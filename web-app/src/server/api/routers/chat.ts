import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { EVENT_KINDS, chatAttachmentSchema } from "@/lib/agent/conversation";
import { subjectsIn } from "@/lib/agent/chat-log";
import { CONVERSATIONS_PER_PROJECT, conversationLabel } from "@/lib/agent/conversation-list";
import { conversationFor, ownedConversation, touchConversation } from "@/server/chat/conversations";
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

/// One thread as the switcher reads it. The first user row rides along only so
/// `conversationLabel` can derive a name from it (orchestrator-tool-reference
/// §VII.4) — `parts` never crosses the wire, because a switcher does not need
/// the conversation to draw a list of them.
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
  /// The project's threads, newest-spoken-in first — which is the only ordering
  /// of a switcher a user can predict without reading it (§VII.1).
  ///
  /// Capped at `CONVERSATIONS_PER_PROJECT` and nothing else. §VII.7 designed a
  /// union with "whichever one the client says is open", so a selection that had
  /// fallen out of the fifty could still be named in the header — but the id of
  /// the open thread lives in `localStorage`, which the server component that
  /// prefetches this cannot read, so taking it as an input would give the
  /// prefetch a cache key the browser never asks for and cost every load after
  /// the first a round trip. It buys nothing either: the column only ever opens
  /// a thread that is in this list, one this session minted (named from the
  /// store), or a fresh one — so there is no thread on screen this list cannot
  /// name. A selection older than the fifty most recent falls back to the most
  /// recent, which is `openConversationId`'s rule for a selection the list no
  /// longer answers to.
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

  /// One conversation, oldest message first. Ownership is re-derived from the
  /// thread the way every other router derives it from the project, because the
  /// id came off the client — and the project the gone-ness read below is scoped
  /// through comes off the row rather than off the request.
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

      /// A tile whose subject was deleted by another door — the gallery, the
      /// tab row, a session with no chat open — has no event in the log to
      /// settle it, so the dead are discovered by existence: one bulk read over
      /// the ids the stored attachments name. Only gone-ness is discovered;
      /// the attachments themselves are snapshots of what the assistant showed
      /// at the time and are never refreshed. The chat is a record.
      ///
      /// Scoped to the *project*, not the thread: a board composed in one
      /// conversation is a board of the project, and every thread in it can see
      /// that board. A conversation partitions talk, not the project (§VII.5).
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

  /// The client's one door for writing a message: something the user did with
  /// their hands — a cut taken in the properties panel, a board or page or
  /// picture thrown away from an offer — which the conversation has to hear
  /// about without a turn being asked. It stays the user's, and it is a turn of
  /// its own: it asks nothing and answers nothing, so it shares a `turnId` with
  /// nothing.
  ///
  /// The conversation id is required and the browser always has one: it minted
  /// it at "New chat" (§VII.3). A thread nobody has spoken in is opened here,
  /// because a note is genuinely the first thing said in it — and because three
  /// records in flight under one unspoken chat have to land in one thread, which
  /// a server-minted id could not promise.
  record: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        conversationId: z.string(),
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
      /// Read before anything is written, so the thread sorts by when the user
      /// did the thing rather than by when the write landed (§VII.1).
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
});
