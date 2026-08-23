import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { EVENT_KINDS, chatAttachmentSchema } from "@/lib/agent/conversation";
import { subjectsIn } from "@/lib/agent/chat-log";
import {
  CONVERSATIONS_PER_PROJECT,
  CONVERSATION_TITLE_LIMIT,
  NEW_CHAT_TITLE,
  conversationLabel,
  normalizedConversationTitle,
} from "@/lib/agent/conversation-list";
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

  /// One thread emptied, and kept (§VII.6). Clear empties the seat you are
  /// sitting in; `remove` below takes the seat away.
  ///
  /// What it does **not** touch is the sentence the confirm has to say out loud:
  /// the boards, the pages, the cuts and the pictures those turns made all
  /// stand. The conversation is the record of the work and not the work. What
  /// goes is the words and the tiles above them — which is not nothing, because
  /// after a board is deleted its tile's snapshot is the only place its title
  /// survives.
  ///
  /// From the user's own click and only ever from there. There is no
  /// `clear_chat` tool and there will not be one: it would be a tool that
  /// deletes the only account of what the tools did, offered by the thing being
  /// accounted for.
  clear: protectedProcedure
    .input(z.object({ projectId: z.string(), conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await ownedConversation(ctx, {
        id: input.conversationId,
        projectId: input.projectId,
      });

      return ctx.db.$transaction(async (tx) => {
        /// The derived name, written into the column before the message it is
        /// derived from goes (§VII.4 as amended). Without this, three cleared
        /// threads all read "New chat" — which is verbatim the state §VII.3
        /// refuses empty rows to avoid, created by the other door. The sentence
        /// is: the thread keeps the name it had; what goes is the record.
        ///
        /// Only when there is no written title — a hand-written one already
        /// survives being emptied — and only when there is something to derive.
        /// A thread whose whole content was an unreadable part has nothing to
        /// keep, and stays deriving.
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

        /// `updatedAt` is deliberately not moved. A thread emptied today is the
        /// one most likely to be reopened, and sorting it to the top is the
        /// reverse of §VII.1's own argument for what the ordering means.
        return { id: conversation.id, title };
      });
    }),

  /// The other half, and not the same door (§VII.6): the row goes, the messages
  /// cascade with it, and `Moodboard.conversationId` nulls — a board a run made
  /// outlives the thread that accounts for it, which is the one sentence the
  /// confirms are built on.
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

  /// A name the user wrote, which outranks the one the thread derives from its
  /// own first message (§VII.4). An empty title is not a rejected rename — it is
  /// the way back to deriving, which is why this takes a string that may be
  /// empty where `moodboard.rename` takes one that may not.
  ///
  /// `updatedAt` is not touched: a rename is not speaking in a thread, and
  /// bumping it would break the one thing the switcher's order promises.
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
      /// The *resolved* label goes back, not the column: a rename to nothing
      /// leaves the row deriving, and the switcher has to be told what it now
      /// derives to rather than drawing an empty pill until the list refetches.
      return wireConversation(renamed);
    }),
});
