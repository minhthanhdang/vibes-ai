"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import type {
  AttachmentTarget,
  BoardAttachment,
  ReferenceAttachment,
} from "@/lib/agent/shared/attachments";
import { discardedIn, goneAtLoad, pagesOf, type Discarded } from "@/lib/agent/shared/chat-log";
import { forDisplay, spoken } from "@/lib/agent/shared/conversation";
import type { PageChoice } from "@/lib/pages/page-attach";
import {
  hydrateChat,
  recordBoardDiscarded,
  recordPageDiscarded,
  recordReferenceDiscarded,
  sendTurn,
  typeDraft,
  useChatLog,
  type ChatSeat,
  type RecordChatEvent,
} from "../stores/use-chat-log-store";
import { useOpenBoardStore } from "../../../_workspace/stores/use-open-board-store";
import { picturesForPages } from "../../../_events/page-camera";
import { PagePicker } from "./page-picker";
import { ShownResults } from "./shown-results";

/// The orchestrator's seat. The user talks through the look they are after,
/// and the assistant answers with the project's own pictures — clicking one
/// opens its properties, so a reply is a way into the gallery rather than a
/// description of it.
///
/// The conversation itself is not held here: this column is collapsible, so
/// owning it would mean the arrow above the messages deletes them. It reads the
/// project's log and drives turns through it.
export function ConversationBody({
  seat,
  isStored,
  onOpen,
}: {
  /// Which thread, in which project. Resolved in the workspace and handed down,
  /// because that is where it has to be known while this column is collapsed
  /// (orchestrator-tool-reference §VII.2).
  seat: ChatSeat;
  /// Whether the server holds a page of messages for this thread. False for a
  /// thread this browser minted and nobody has spoken in yet (§VII.3), which is
  /// not a row and would answer a fetch with a 404.
  isStored: boolean;
  onOpen: (target: AttachmentTarget) => void;
}) {
  const { projectId, conversationId } = seat;
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const log = useChatLog(conversationId);
  /// Which board this tab is showing, read here and sent with every message: it
  /// is the one the turn primes the model with, and the browser is the only
  /// thing that knows it. Null on a project page with no board open, which the
  /// turn primes as no board rather than as no boards.
  const openBoardId = useOpenBoardStore((state) => state.openId);

  /// The stored conversation, once. `staleTime: Infinity` because the store is
  /// written through — every message this column shows is either already a row
  /// or about to be one — so a refetch could only put a stale snapshot under a
  /// session that has moved on; the store's own once-guard makes a remount of
  /// this column (the collapse arrow) a no-op either way.
  const stored = useQuery(
    trpc.chat.list.queryOptions(
      { conversationId },
      { staleTime: Infinity, enabled: isStored },
    ),
  );
  useEffect(() => {
    if (stored.data) hydrateChat(conversationId, stored.data.messages);
  }, [stored.data, conversationId]);

  /// The session's own discards, replayed from the log, over the ones the load
  /// discovered by existence — when both name one subject the event's record
  /// wins, because it knows what the user was told at the time.
  const discarded: Discarded = {
    ...goneAtLoad(log.messages, stored.data?.gone),
    ...discardedIn(log.messages),
  };

  /// The switcher's list, after something has been said. It reorders on every
  /// turn — the head of it is "the thread you last spoke in" — and the first
  /// thing said in a thread this browser minted is what *creates* the row the
  /// list is missing (orchestrator-tool-reference §VII.3).
  async function conversationsChanged() {
    await queryClient.invalidateQueries({
      queryKey: trpc.chat.conversations.queryOptions({ projectId }).queryKey,
    });
  }

  /// Every event the session records goes to the store as well as to the column,
  /// so the next load draws it. Fire-and-forget inside the store: the note is
  /// this session's either way.
  const recordEvent: RecordChatEvent = async (input) => {
    const written = await client.chat.record.mutate(
      input as Parameters<typeof client.chat.record.mutate>[0],
    );
    await conversationsChanged();
    return written;
  };

  /// The list every surface that draws a picture reads, and the one the
  /// workspace's derivation sweep watches for a row that owes a thumbnail.
  async function referencesChanged() {
    await queryClient.invalidateQueries({
      queryKey: trpc.reference.listByProject.queryOptions({ projectId }).queryKey,
    });
  }

  /// A board the assistant filed is a row the tab list has never seen, and the
  /// tab list is what decides which board a click can open. Owed after a turn that
  /// broke as much as after one that answered: the tools write as they are called,
  /// so a compose on the round before the failure is a board with nothing on
  /// screen to say it exists.
  async function boardsChanged() {
    await queryClient.invalidateQueries({
      queryKey: trpc.moodboard.listByProject.queryOptions({ projectId }).queryKey,
    });
    /// And the pages the picker offers: a turn that composed a page, added one or
    /// discarded the board it was on has changed which rectangles a message can
    /// attach. Every board's, because the tool takes a board id and the one it
    /// worked on is not always the one on screen.
    await queryClient.invalidateQueries(trpc.moodboard.pages.pathFilter());
  }

  /// The same, for a turn that never answered — and the pictures with it, which
  /// the answered path learns from the attachments and this one cannot: a
  /// `generate_image` on the round before the failure is a picture in the
  /// project with nothing on screen holding it.
  async function turnBroke() {
    await referencesChanged();
    await boardsChanged();
  }

  /// The other end of `discard_board`. The tool offers and this is where the
  /// board actually goes — from the user's own click, because a deletion is
  /// the one act in the project nothing can undo.
  ///
  /// The conversation is told afterwards for the same reason a taken cut tells
  /// it: the model has to know the id is dead before it passes it to a tool on
  /// the next message.
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
    /// The scene of a board that no longer exists. Dropped only while nothing is
    /// mounted on it — an open board finds out through the tab row the list
    /// invalidation redraws.
    queryClient.removeQueries({
      queryKey: trpc.moodboard.scene.queryOptions({ id: board.boardId }).queryKey,
      type: "inactive",
    });
    await boardsChanged();
  }

  /// The other end of `discard_page`, on the same terms as a board's: the tool
  /// offers and the page comes off from the user's own click. What is written
  /// is decided on the server out of the board's stored scene — the chat column
  /// has no scene of a board it is not showing, and the tab that is showing one
  /// finds out through the invalidation below.
  async function discardBoardPage(board: BoardAttachment) {
    const offer = board.discardPage;
    if (!offer) return;
    const gone = await client.moodboard.removePage.mutate({
      id: board.boardId,
      pageId: offer.pageId,
    });
    recordPageDiscarded(seat, gone, recordEvent);
    /// The board's own scene is now a revision behind whatever any mounted tab is
    /// holding. Dropped only while nothing is mounted on it, exactly as a
    /// discarded board's is — an open board keeps its canvas and finds out when
    /// its autosave is refused.
    queryClient.removeQueries({
      queryKey: trpc.moodboard.scene.queryOptions({ id: board.boardId }).queryKey,
      type: "inactive",
    });
    await boardsChanged();
  }

  /// The other end of `discard_reference`, on the same terms: the tool offers and
  /// the picture goes from the user's own click. The gallery is invalidated
  /// because the tile it draws is now a row that is not there, and the boards are
  /// left alone deliberately — the scene still holds an element naming a picture
  /// that has gone, which is a hole the user sees on the board itself.
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
        /// Off the tile rather than off a row: the row is gone by the time this
        /// sentence is written, and what it was — a photograph the user shot or a
        /// picture the assistant drew — is the one thing the note has to get right
        /// about a picture nobody can look at any more.
        origin: reference.origin,
      },
      recordEvent,
    );
    await referencesChanged();
    await queryClient.invalidateQueries({
      queryKey: trpc.reference.versionLinksByProject.queryOptions({ projectId }).queryKey,
    });
  }

  function send(message: string, retryOf?: string, pages?: readonly PageChoice[]) {
    /// The store guards this too — it is the one that knows whether a turn is in
    /// flight — but the composer has to know as well, since a blank or ignored
    /// submit must leave the box alone rather than empty it.
    if (!message || log.asking) return;
    void sendTurn({
      projectId,
      conversationId,
      message,
      retryOf,
      /// A retry carries the pages the failed message carried; an ordinary send
      /// says nothing and the store takes what is picked.
      pages,
      currentBoardId: openBoardId ?? undefined,
      /// And a picture of each of them, from the tab that has the board open —
      /// the whole of what the browser is authoritative for in an attachment
      /// (§V.5). A page of a board nobody is showing gets none, and goes up as
      /// the words alone.
      picture: picturesForPages,
      ask: (input) => client.orchestrator.send.mutate(input),
      onFailed: turnBroke,
      onAnswered: async (attachments) => {
        /// The thread this was asked in has moved to the top of the switcher,
        /// and if it was one this session minted it is a row for the first time.
        await conversationsChanged();

        /// A turn that drew a picture filed a gallery row nothing on screen has
        /// read — `generate_image` writes it mid-turn and the grid and the strip
        /// are both showing a list fetched before it existed. Keyed off the
        /// attachments rather than off the tool that ran, because the chat is
        /// told what a turn produced and not how: a crop the user takes files a
        /// row the same way.
        ///
        /// The grid-sized copy that row still owes is not made here: the sweep
        /// the workspace mounts reads it off this same list, and a turn that
        /// answered is only one of the moments a picture is left owing one.
        if (attachments.some((attachment) => attachment.kind === "reference")) {
          await referencesChanged();
        }

        /// The thing that learned the board exists is the thing that says so.
        const boards = attachments.filter((attachment) => attachment.kind === "board");
        if (!boards.length) return;

        /// A rebuilt board is a scene the cache already holds an older copy of,
        /// and that copy is pinned — the editor is initialised from a document,
        /// so `moodboard.scene` is fetched once and never refetched on mount.
        /// Dropping it is what makes opening the board show the arrangement the
        /// assistant just wrote instead of the one it replaced. A board that is
        /// new has nothing cached and this is a no-op on it.
        ///
        /// Only while nothing is showing it: dropping a scene the editor is
        /// mounted on would unmount the canvas under the user's hands and
        /// take whatever they had drawn since the last save with it. An open
        /// board keeps its copy and finds out the way any other tab does — its
        /// next save conflicts, and it offers a reload.
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
            /// The format decides what a part is drawn as; this column decides
            /// what a bubble, a note, a chip or a tile looks like. Calls and
            /// results draw as nothing, and so does a part this build does not
            /// know — a row is never rejected on read.
            const drawn = forDisplay(message.parts);
            const failed = message.status === "failed";
            const chips = drawn.flatMap((part) =>
              part.kind === "chip" ? [part.name || "Unnamed page"] : [],
            );
            const tiles = drawn.flatMap((part) => (part.kind === "tile" ? [part.attachment] : []));
            return (
              <div key={message.id} className="flex flex-col gap-2">
                {drawn.map((part, index) =>
                  part.kind === "note" ? (
                    <p key={index} className="px-1 text-xs opacity-60">
                      {part.text}
                    </p>
                  ) : part.kind === "bubble" ? (
                    <p
                      key={index}
                      className={`rounded-lg px-3 py-2 text-sm ${
                        failed
                          ? "self-end border border-dashed border-current/30 text-right opacity-60"
                          : message.role === "user"
                            ? "self-end bg-current/10 text-right"
                            : "border border-current/10"
                      }`}
                    >
                      {part.text}
                    </p>
                  ) : null,
                )}
                {/* A message the model never saw, kept so it can go again: the box
                    it was typed in was emptied when it was sent, so dropping it here
                    would make a failed turn cost the user the paragraph they
                    wrote. */}
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
                {/* Which pages went up with those words. Under the bubble rather
                    than in it: the message is what the user wrote, and the
                    attachment is what they pointed at while writing it. */}
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

        {log.asking ? <p className="text-sm opacity-50">Thinking…</p> : null}
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
