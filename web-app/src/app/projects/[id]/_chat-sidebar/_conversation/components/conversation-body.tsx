"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { attachmentKey, attachmentTarget, type AttachmentTarget, type BoardAttachment, type ChatAttachment, type ReferenceAttachment } from "@/lib/agent/shared/attachments";
import type { BoardPreview as BoardPreviewData } from "@/lib/boards/board-preview";
import { discardedIn, goneAtLoad, pagesOf, shownAs, type Discarded } from "@/lib/agent/shared/chat-log";
import { forDisplay, spoken } from "@/lib/agent/shared/conversation";
import {
  pageChoiceKey,
  pageChoiceNote,
  type PageChoice,
} from "@/lib/pages/page-attach";
import { PAGES_PER_MESSAGE } from "@/lib/pages/page-brief";
import {
  hydrateChat,
  listedPages,
  pickPage,
  recordBoardDiscarded,
  recordPageDiscarded,
  recordReferenceDiscarded,
  sendTurn,
  typeDraft,
  useChatLog,
  type ChatSeat,
  type RecordChatEvent,
} from "../stores/use-chat-log-store";
import { useOpenBoard } from "../../../_workspace/stores/use-open-board-store";
import { picturesForPages } from "../../../_events/page-camera";

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
  const openBoardId = useOpenBoard();

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

/// The pages of the board the tab is showing, to attach one to this message
/// (§V.5).
///
/// The whole of what a page attachment is on this side: what goes up is a pointer
/// — which board, which page, at which revision — and everything the model reads
/// about it is built on the server from the stored scene. So this lists what the
/// server holds rather than what the canvas is showing: a page drawn a second ago
/// and not yet saved is not a page the model could be handed, and offering it
/// would be a chip for something that goes up as nothing.
///
/// Nothing at all when the board has no pages: a board never composed and never
/// given one by hand has no rectangle to attach, and a picker saying so on every
/// project that has not got there yet is chrome above the box the user types
/// in.
function PagePicker({
  conversationId,
  attached,
}: {
  conversationId: string;
  attached: PageChoice[];
}) {
  const trpc = useTRPC();
  const boardId = useOpenBoard();
  /// Behind `moodboard.pages` rather than the scene the editor is mounted on —
  /// that one is pinned and must not be refetched under the canvas. This is free
  /// to be refetched, and is: the user draws a page on the board and then
  /// turns to the chat to talk about it.
  const { data } = useQuery(
    trpc.moodboard.pages.queryOptions(
      { id: boardId ?? "" },
      /// A board's pages change under this — a compose, an `add_page`, the
      /// user drawing one — so the list is asked for again rather than
      /// served from a cache the last message filled.
      { enabled: !!boardId, staleTime: 0 },
    ),
  );

  /// A page picked and since deleted stops being a chip here rather than going up
  /// as an id the server drops in silence.
  useEffect(() => {
    if (data) listedPages(conversationId, data);
  }, [data, conversationId]);

  if (!boardId || !data?.pages.length) return null;

  const picked = new Set(attached.map(pageChoiceKey));
  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 text-[11px] opacity-50">
        Attach a page of “{data.title}” — up to {PAGES_PER_MESSAGE} per message
      </span>
      <ul className="flex flex-wrap gap-1">
        {data.pages.map((page) => {
          const on = picked.has(pageChoiceKey({ boardId: data.boardId, pageId: page.pageId }));
          return (
            <li key={page.pageId}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() =>
                  pickPage(conversationId, {
                    boardId: data.boardId,
                    pageId: page.pageId,
                    revision: data.revision,
                    name: page.name,
                  })
                }
                className={`flex flex-col rounded-lg border px-2 py-1 text-left text-[11px] transition-opacity ${
                  on ? "border-current/50 bg-current/10" : "border-current/15 hover:opacity-70"
                }`}
              >
                <span className="max-w-40 truncate font-medium">
                  {page.name || `Page ${page.position}`}
                </span>
                <span className="opacity-60">{pageChoiceNote(page)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/// What the assistant put in front of the user, under the words that were
/// about it. A row of thumbnails rather than a list of titles: the whole point
/// of showing a reference is that the picture answers faster than its name, and
/// the sidebar is too narrow for more than a strip.
///
/// A board is drawn as a wider tile than a photograph, and says so on its face.
/// It is not one of the pictures — it is the thing the pictures were put into,
/// and clicking it leaves the gallery entirely, so it should not be mistaken for
/// another reference on the way to being clicked. What it shows is the
/// arrangement itself, drawn from the placements, and it falls back to the
/// opening slot's photograph only for a board with nothing placed on it.
///
/// A picture offered for removal is drawn wide for the opposite reason: it is
/// not one of the project's pictures but a decision about one, and the line
/// under it is what the decision is made on.
function ShownResults({
  attachments,
  discarded,
  onOpen,
  onDiscard,
  onDiscardPage,
  onDiscardReference,
}: {
  attachments: ChatAttachment[];
  discarded: Discarded;
  onOpen: (target: AttachmentTarget) => void;
  onDiscard: (board: BoardAttachment) => Promise<void>;
  onDiscardPage: (board: BoardAttachment) => Promise<void>;
  onDiscardReference: (reference: ReferenceAttachment) => Promise<void>;
}) {
  /// Which board is on its way out, and which one would not go. Local to the
  /// strip because both are about a button that is on screen: the conversation
  /// records the discard that *happened*, and a delete that failed is not one.
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  /// One handler for both kinds, keyed on the id of whatever is going: a board
  /// and a picture are two doors onto the same act, and two copies of the
  /// in-flight/failed pair would be two ways for that act to be reported.
  async function discard(id: string, remove: () => Promise<void>) {
    setDiscarding(id);
    setFailed(null);
    try {
      await remove();
    } catch {
      setFailed(id);
    } finally {
      setDiscarding(null);
    }
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {attachments.map((shown) => {
        const { attachment, gone } = shownAs(discarded, shown);
        const wide = attachment.kind !== "reference" || !!attachment.discard || !!gone;
        /// A discarded board is still drawn — it is under a reply that was about
        /// it — but it is no longer a way in: the tab row falls back to the first
        /// board for an id it does not hold, so a click would open somebody
        /// else's arrangement and read as the discard having failed.
        const Tile = gone ? "span" : "button";
        return (
          <li key={attachmentKey(shown)} className={wide ? "w-full" : ""}>
            <Tile
              {...(gone
                ? { "aria-disabled": true }
                : {
                    type: "button" as const,
                    onClick: () => onOpen(attachmentTarget(attachment)),
                  })}
              title={attachment.caption || attachment.title}
              className={`flex flex-col gap-1 rounded-lg border p-1 text-left transition-opacity ${
                gone ? "opacity-50" : "hover:opacity-70"
              } ${wide ? "w-full border-current/30" : "w-24 border-current/10"}`}
            >
              {attachment.kind === "board" && attachment.preview ? (
                <BoardPreview preview={attachment.preview} />
              ) : attachment.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachment.thumbUrl}
                  alt={attachment.title}
                  className={`w-full rounded object-cover ${wide ? "h-24" : "h-16"}`}
                />
              ) : (
                <span className="grid h-24 w-full place-items-center rounded border border-dashed border-current/20 text-[11px] opacity-50">
                  No preview yet
                </span>
              )}
              {wide ? (
                <span className="truncate text-xs font-medium">{attachment.title}</span>
              ) : null}
              {attachment.kind === "board" && attachment.lines.length ? (
                /// What the board says, beside the arrangement rather than in
                /// it: a headline is a few pixels tall in the miniature, so a
                /// reply about the words would otherwise be illustrated by a
                /// grey bar.
                <span className="flex flex-col text-[11px] leading-tight opacity-60">
                  {attachment.lines.map((line, index) => (
                    <span key={index} className="truncate">
                      “{line}”
                    </span>
                  ))}
                  {attachment.linesOver ? (
                    <span className="truncate">+{attachment.linesOver} more</span>
                  ) : null}
                </span>
              ) : null}
              <span className="truncate text-[11px] opacity-70">
                {attachment.kind === "board"
                  ? `${gone ? "Discarded" : attachment.discard ? (attachment.discardPage ? "Discard page?" : "Discard?") : "Moodboard"} · ${attachment.caption}`
                  : gone
                    ? `Removed · ${attachment.caption || attachment.title}`
                    : attachment.discard
                      ? `Remove? · ${attachment.caption || attachment.title}`
                      : attachment.caption || attachment.title}
              </span>
            </Tile>
            {/* The one act in this project nothing can undo, so it is a button
                under the board rather than something a tool did. Outside the
                tile because the tile is itself a button — the board is still
                openable while the question is up, which is most of how it gets
                answered. */}
            {attachment.kind === "board" && attachment.discard && !gone ? (
              <span className="flex items-center gap-2 px-1 pt-1 text-[11px]">
                <button
                  type="button"
                  disabled={discarding === attachment.boardId}
                  onClick={() =>
                    void discard(attachment.boardId, () =>
                      attachment.discardPage ? onDiscardPage(attachment) : onDiscard(attachment),
                    )
                  }
                  className="rounded-full border border-current/25 px-2 py-0.5 hover:bg-current/10 disabled:opacity-40"
                >
                  {discarding === attachment.boardId
                    ? "Discarding…"
                    : attachment.discardPage
                      ? "Discard page"
                      : "Discard board"}
                </button>
                <span className="opacity-50">
                  {failed === attachment.boardId
                    ? "Could not discard — try again."
                    : attachment.discardPage
                      ? "Cannot be undone. The board's other pages stay, and the photographs stay in the gallery."
                      : "Cannot be undone. The photographs stay in the gallery."}
                </span>
              </span>
            ) : null}
            {/* The same button one kind over, and the sentence beside it is
                doing more work: a picture takes its cuts with it and leaves a
                hole in every board it was on, none of which is visible from the
                tile. */}
            {attachment.kind === "reference" && attachment.discard && !gone ? (
              <span className="flex items-center gap-2 px-1 pt-1 text-[11px]">
                <button
                  type="button"
                  disabled={discarding === attachment.referenceId}
                  onClick={() =>
                    void discard(attachment.referenceId, () => onDiscardReference(attachment))
                  }
                  className="rounded-full border border-current/25 px-2 py-0.5 hover:bg-current/10 disabled:opacity-40"
                >
                  {discarding === attachment.referenceId ? "Removing…" : "Remove picture"}
                </button>
                <span className="opacity-50">
                  {failed === attachment.referenceId
                    ? "Could not remove — try again."
                    : removalCost(attachment.discard)}
                </span>
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/// What the user is told they are about to lose, beside the button. The
/// cuts and the boards are the two halves of it the tile cannot show — a crop
/// made an hour ago is a row in another panel, and a board is a whole other
/// column.
function removalCost({ cuts, boards }: { cuts: number; boards: readonly unknown[] }) {
  const parts = [
    cuts ? `${cuts} ${cuts === 1 ? "crop" : "crops"} of it go too` : null,
    boards.length
      ? `${boards.length} ${boards.length === 1 ? "board" : "boards"} lose a picture`
      : null,
  ].filter(Boolean);
  return parts.length ? `Cannot be undone. ${parts.join(", ")}.` : "Cannot be undone.";
}

/// `h-24`, as a number. A preview's inner box is sized off it in pixels rather
/// than by `aspect-ratio`, because a block box with a definite height and
/// `width: auto` fills its line instead of taking its shape — which is the
/// stretch both previews below exist to avoid.
const PREVIEW_STRIP_HEIGHT = 96;

/// The board that was composed, at the size of a thumbnail.
///
/// The page is a box at the page's own shape — a portrait masonry board is a
/// tall sliver in the strip and a widescreen diptych nearly fills it, which is
/// the first true thing about a board and the one a single cover photograph
/// cannot say. Every placement is positioned in percent inside it, so the
/// miniature is the arrangement rather than a picture of one of its parts.
///
/// A photograph is drawn at the box it occupies on the board, gaps and all: a
/// picture sitting loose in its slot looks loose here too, which is the same
/// thing the reply's own sentence about cropping is about.
function BoardPreview({ preview }: { preview: BoardPreviewData }) {
  return (
    <span className="flex h-24 w-full items-center justify-center overflow-hidden rounded bg-current/5">
      <span
        className="relative block shrink-0 overflow-hidden rounded-[2px] bg-white/90"
        style={{
          height: PREVIEW_STRIP_HEIGHT,
          width: Math.round(PREVIEW_STRIP_HEIGHT * preview.aspectRatio),
        }}
      >
        {preview.items.map((item, index) => (
          <span
            key={index}
            className={`absolute block overflow-hidden ${
              item.kind === "text" ? "bg-black/20" : "bg-black/5"
            }`}
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              width: `${item.width}%`,
              height: `${item.height}%`,
              ...(item.angle && { transform: `rotate(${item.angle}deg)` }),
            }}
          >
            {item.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </span>
        ))}
      </span>
    </span>
  );
}
