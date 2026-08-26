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
  /// put in front of them, and, while it is happening, an account of what the
  /// turn is doing. Ownership is the only thing decided here; the turn itself is
  /// `runOrchestratorTurn`, so the command-line harness runs it too.
  ///
  /// A turn is 130–180 seconds when it designs a page, and for all of it the
  /// column used to say `Thinking…`. What it says now is the rounds, the tools
  /// and the model's own summaries, streamed as they happen — `httpBatchStreamLink`
  /// is already the app's only link, so this is a return type and no transport
  /// change at all.
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

      /// Where the turn's account of itself goes while it happens. The queue is
      /// between an agent that emits and the generator below that yields, and
      /// it is lossy rather than blocking on purpose — see `event-stream.ts`.
      const stream = eventStream<TurnEvent>();

      /// The turn, started here and awaited by nobody in this function.
      ///
      /// **This is the whole of the guarantee.** tRPC calls `.return()` on the
      /// generator when the response is cancelled (`readableStreamFrom`'s
      /// `cancel`, verified in the installed copy), so persistence sitting
      /// inside the generator would be persistence a closed tab silently threw
      /// away — the tools have already written their boards and pictures, and
      /// the user would come back to "Send again" under a question whose work
      /// actually happened. A promise is not cancellable, so what the generator
      /// holds is a *window* onto work that is already running rather than the
      /// thing running it.
      ///
      /// `withEvents` wraps it from out here, outside the agent door, so the
      /// sink is in scope before `runOrchestratorTurn` pushes the first label.
      const work = withEvents(stream.emit, async () => {
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
        /// A tab that closes mid-turn changes none of this — the write is inside
        /// the promise above and not inside the generator below, so the answer it
        /// paid for is stored whether or not anyone is still listening.
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

        /// `parts` is the assistant row exactly as it was just stored. Without
        /// it the session that ran the turn would hold a message synthesized
        /// from the reply alone, and the collapsed step summary under it would
        /// be empty until the page reloaded — the wrong way round.
        return { reply, attachments, conversationId, parts: answered };
      });

      /// The terminal event, and the reason `work` can never reject: both
      /// outcomes are turned into a value here, in the same tick the promise is
      /// made. So `after` below cannot produce an unhandled rejection, and a
      /// turn that broke reaches the column as something it can draw rather than
      /// as a stream that died.
      const settled: Promise<TurnEvent> = work.then(
        (answer) => {
          stream.close();
          return { kind: "answer", ...answer } as const;
        },
        (cause) => {
          /// Logged here because converting the throw into an event takes it out
          /// of the route handler's `onError`, which is where a failed turn used
          /// to be recorded.
          console.error("orchestrator.send failed:", cause);
          stream.close();
          return {
            kind: "failed",
            error: cause instanceof Error ? cause.message : String(cause),
          } as const;
        },
      );

      /// And the invocation's lifetime tied to the work rather than to the
      /// socket: without this the execution context can be reclaimed once the
      /// response ends. `analysis-queue.ts` is the precedent, including the
      /// try/catch — `after` throws outright when there is no request to run
      /// after (the command-line harness), and a lifetime that could not be
      /// extended is a turn the generator below is still awaiting, never a turn
      /// that was lost.
      ///
      /// Note what is deliberately *not* here: tRPC hands the procedure an abort
      /// signal, and wiring it into the turn would delete this whole guarantee
      /// in one line. Client disconnect must keep not killing the turn.
      try {
        after(settled);
      } catch (cause) {
        console.error("the turn could not be kept alive past the response:", cause);
      }

      /// The window. A plain `async` resolver returning a generator rather than
      /// an `async function*` resolver, and the difference is load-bearing: a
      /// generator's body does not run until it is pulled, which happens from
      /// the response-piping context where `after` throws — so everything above
      /// would have been silently skipped.
      return (async function* turnWindow(): AsyncGenerator<TurnEvent> {
        for await (const event of stream.read()) yield event;
        /// Last, always, and after the rows are committed: a client holding the
        /// answer is holding a stored one.
        yield await settled;
      })();
    }),
});
