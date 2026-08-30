"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import type {
  AttachmentTarget,
  BoardAttachment,
  ReferenceAttachment,
} from "@/lib/agent/shared/attachments";
import { discardedIn, goneAtLoad, pagesOf, type Discarded } from "@/lib/agent/shared/chat-log";
import {
  boardIsHeld,
  boardWatchAfter,
  NO_BOARD_WATCH,
  type BoardWatch,
} from "@/lib/boards/board-hold";
import { forDisplay, spoken, stepsOf } from "@/lib/agent/shared/conversation";
import type { PageChoice } from "@/lib/pages/page-attach";
import type { AgentEvent } from "@/lib/agent/shared/turn-events";
import {
  hydrateChat,
  recordBoardDiscarded,
  recordPageDiscarded,
  recordReferenceDiscarded,
  sendTurn,
  typeDraft,
  useChatLog,
} from "../stores/use-chat-log-store";
import type { ChatSeat, RecordChatEvent } from "../types";
import { useOpenBoardStore } from "../../../_workspace/stores/use-open-board-store";
import {
  holdBoard,
  releaseBoard,
  releaseBoards,
} from "../../../_workspace/stores/use-board-hold-store";
import { reloadBoard } from "../../../_main-viewport/_design/stores/use-board-reload-store";
import { picturesForPages } from "../../../_events/page-camera";
import { MarkdownText } from "@/components/markdown-text";
import { PagePicker } from "./page-picker";
import { ShownResults } from "./shown-results";
import { TurnProgress, TurnSummary } from "./turn-steps";

export function ConversationBody({
  seat,
  isStored,
  onOpen,
}: {
  seat: ChatSeat;
  isStored: boolean;
  onOpen: (target: AttachmentTarget) => void;
}) {
  const { projectId, conversationId } = seat;
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const log = useChatLog(conversationId);
  const openBoardId = useOpenBoardStore((state) => state.openId);

  const stored = useQuery(
    trpc.chat.list.queryOptions(
      { conversationId },
      { staleTime: Infinity, enabled: isStored },
    ),
  );
  useEffect(() => {
    if (stored.data) hydrateChat(conversationId, stored.data.messages);
  }, [stored.data, conversationId]);

  const discarded: Discarded = {
    ...goneAtLoad(log.messages, stored.data?.gone),
    ...discardedIn(log.messages),
  };

  async function conversationsChanged() {
    await queryClient.invalidateQueries({
      queryKey: trpc.chat.conversations.queryOptions({ projectId }).queryKey,
    });
  }

  const recordEvent: RecordChatEvent = async (input) => {
    const written = await client.chat.record.mutate(
      input as Parameters<typeof client.chat.record.mutate>[0],
    );
    await conversationsChanged();
    return written;
  };

  async function referencesChanged() {
    await queryClient.invalidateQueries({
      queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
    });
  }

  async function boardsChanged() {
    await queryClient.invalidateQueries({
      queryKey: trpc.moodboard.listByProject.queryOptions({ projectId }).queryKey,
    });
    await queryClient.invalidateQueries(trpc.moodboard.pages.pathFilter());
  }

  async function turnBroke() {
    await referencesChanged();
    await boardsChanged();
  }

  async function discardBoard(board: BoardAttachment) {
    await client.moodboard.remove.mutate({ id: board.boardId });
    recordBoardDiscarded(
      seat,
      {
        boardId: board.boardId,
        title: board.title,
        pictures: board.images,
      },
      recordEvent,
    );
    queryClient.removeQueries({
      queryKey: trpc.moodboard.scene.queryOptions({ id: board.boardId }).queryKey,
      type: "inactive",
    });
    await boardsChanged();
  }

  async function discardBoardPage(board: BoardAttachment) {
    const offer = board.discardPage;
    if (!offer) return;
    const gone = await client.moodboard.removePage.mutate({
      id: board.boardId,
      pageId: offer.pageId,
    });
    recordPageDiscarded(seat, gone, recordEvent);
    queryClient.removeQueries({
      queryKey: trpc.moodboard.scene.queryOptions({ id: board.boardId }).queryKey,
      type: "inactive",
    });
    await boardsChanged();
  }

  async function discardReference(reference: ReferenceAttachment) {
    await client.reference.remove.mutate({ id: reference.referenceId });
    recordReferenceDiscarded(
      seat,
      {
        referenceId: reference.referenceId,
        title: reference.title,
        frameId: reference.frameId,
        cuts: reference.discard?.cuts,
        boards: reference.discard?.boards,
        origin: reference.origin,
      },
      recordEvent,
    );
    await referencesChanged();
    await queryClient.invalidateQueries({
      queryKey: trpc.reference.versionLinksByProject.queryOptions({ projectId }).queryKey,
    });
  }

  const watch = useRef<BoardWatch>(NO_BOARD_WATCH);
  const reloaded = useRef<Set<string>>(new Set());

  function watchBoards(event: AgentEvent) {
    const before = watch.current;
    const after = boardWatchAfter(before, event);
    if (after === before) return;
    watch.current = after;
    for (const boardId of new Set(after.touched)) {
      const was = boardIsHeld(before, boardId);
      const now = boardIsHeld(after, boardId);
      if (was === now) continue;
      if (now) {
        holdBoard(boardId);
        continue;
      }
      releaseBoard(boardId);
      reloadBoard(boardId);
      reloaded.current.add(boardId);
    }
  }

  function turnSettled() {
    const { held, touched } = watch.current;
    const alreadyReloaded = reloaded.current;
    watch.current = NO_BOARD_WATCH;
    reloaded.current = new Set();
    releaseBoards([...new Set(held.map((hold) => hold.boardId))]);
    for (const boardId of touched) {
      if (!alreadyReloaded.has(boardId)) reloadBoard(boardId);
    }
  }

  function send(message: string, retryOf?: string, pages?: readonly PageChoice[]) {
    if (!message || log.asking) return;
    void sendTurn({
      projectId,
      conversationId,
      message,
      retryOf,
      pages,
      currentBoardId: openBoardId ?? undefined,
      picture: picturesForPages,
      ask: (input) => client.orchestrator.send.mutate(input),
      onEvent: watchBoards,
      onFailed: async () => {
        turnSettled();
        await turnBroke();
      },
      onAnswered: async (attachments) => {
        turnSettled();
        await conversationsChanged();

        if (attachments.some((attachment) => attachment.kind === "reference")) {
          await referencesChanged();
        }

        const boards = attachments.filter((attachment) => attachment.kind === "board");
        if (!boards.length) return;

        for (const board of boards) {
          queryClient.removeQueries({
            queryKey: trpc.moodboard.scene.queryOptions({ id: board.boardId }).queryKey,
            type: "inactive",
          });
        }
        await boardsChanged();
      },
    });
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {log.messages.length ? (
          log.messages.map((message) => {
            const drawn = forDisplay(message.parts);
            const failed = message.status === "failed";
            const chips = drawn.flatMap((part) =>
              part.kind === "chip" ? [part.name || "Unnamed page"] : [],
            );
            const tiles = drawn.flatMap((part) => (part.kind === "tile" ? [part.attachment] : []));
            const steps = stepsOf(message.parts);
            return (
              <div key={message.id} className="flex flex-col gap-2">
                {drawn.map((part, index) =>
                  part.kind === "note" ? (
                    <p key={index} className="px-1 text-xs opacity-60">
                      {part.text}
                    </p>
                  ) : part.kind === "bubble" ? (
                    <div
                      key={index}
                      className={`rounded-lg px-3 py-2 text-sm ${
                        failed
                          ? "self-end whitespace-pre-wrap border border-dashed border-current/30 text-right opacity-60"
                          : message.role === "user"
                            ? "self-end whitespace-pre-wrap bg-current/10 text-right"
                            : "border border-current/10"
                      }`}
                    >
                      {message.role === "user" || failed ? (
                        part.text
                      ) : (
                        <MarkdownText text={part.text} />
                      )}
                    </div>
                  ) : null,
                )}
                {failed ? (
                  <button
                    type="button"
                    onClick={() => send(spoken(message.parts), message.id, pagesOf(message))}
                    disabled={log.asking}
                    className="self-end text-xs underline opacity-70 disabled:opacity-30"
                  >
                    Send again
                  </button>
                ) : null}
                {chips.length ? (
                  <span className="self-end px-1 text-[11px] opacity-60">
                    {chips.join(" · ")} attached
                  </span>
                ) : null}
                {tiles.length ? (
                  <ShownResults
                    attachments={tiles}
                    discarded={discarded}
                    onOpen={onOpen}
                    onDiscard={discardBoard}
                    onDiscardPage={discardBoardPage}
                    onDiscardReference={discardReference}
                  />
                ) : null}
                {steps.length ? <TurnSummary steps={steps} /> : null}
              </div>
            );
          })
        ) : (
          <p className="text-sm opacity-60">
            Describe the look you are after — palette, lighting, texture, framing. Most references
            are your own uploads; this is where you work out what they need to say, and where you
            ask for the texture, gradient or backdrop none of them is — that one is drawn for you.
          </p>
        )}

        {log.progress ? (
          <TurnProgress progress={log.progress} />
        ) : log.asking ? (
          <p className="text-sm opacity-50">Thinking…</p>
        ) : null}
        {log.error ? <p className="text-sm text-red-500">{log.error}</p> : null}
      </div>

      <form
        className="flex flex-col gap-2 border-t border-current/10 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          send(log.draft.trim());
        }}
      >
        <PagePicker conversationId={conversationId} attached={log.attached} />
        <textarea
          value={log.draft}
          onChange={(event) => typeDraft(conversationId, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(log.draft.trim());
            }
          }}
          rows={3}
          placeholder="Low-key light, deep shadows, a gloomy historical mansion"
          className="resize-none rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
        />
        <button
          type="submit"
          disabled={log.asking}
          className="rounded-lg border border-current/20 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
