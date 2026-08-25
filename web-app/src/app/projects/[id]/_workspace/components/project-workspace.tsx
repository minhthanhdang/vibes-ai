"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SIDEBAR_KEYBOARD_STEP,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarPageWidth,
  widthAfterDrag,
} from "@/lib/ui/sidebar";
import { DesignView } from "../../_main-viewport/_design/components/design-view";
import { ProjectBrief } from "./project-brief";
import { GalleryView } from "../../_main-viewport/_gallery/components/gallery-view";
import { ConversationBody } from "../../_chat-sidebar/_conversation/components/conversation-body";
import { SidebarGallery } from "../../_chat-sidebar/components/sidebar-gallery";
import { GalleryUploader } from "../../_main-viewport/_gallery/components/gallery-uploader";
import { usePendingUploads } from "../../_main-viewport/_gallery/stores/use-pending-uploads-store";
import { useDerivedReferenceCopies } from "../../_reference/hooks/use-derived-reference-copies";
import { inspectReference } from "../../_reference/stores/use-inspection-store";
import { openBoard } from "../stores/use-open-board-store";
import { focusVersion } from "../../_reference/stores/use-version-focus-store";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { openConversationId } from "@/lib/agent/shared/conversation-list";
import { ConversationHeader } from "../../_chat-sidebar/_conversation/components/conversation-header";
import {
  chooseConversation,
  useConversationStore,
  useOpenConversation,
} from "../../_chat-sidebar/_conversation/stores/use-conversation-store";
import {
  mintChat,
  recordBoardDiscarded,
  recordCutTaken,
  recordReferenceDiscarded,
  type ChatSeat,
  type RecordChatEvent,
} from "../../_chat-sidebar/_conversation/stores/use-chat-log-store";
import { onBoardDiscarded } from "../../_events/board-discarded";
import { onReferenceDiscarded } from "../../_events/reference-discarded";
import { onCutTaken } from "../../_events/cut-taken";
import { setSidebarWidth, toggleSidebar, useSidebarStore } from "../stores/use-sidebar-store";
import { VibesRunPanel } from "../../_main-viewport/_design/_vibes/components/vibes-run-panel";

type WorkspaceView = "gallery" | "design";

const VIEWS: { id: WorkspaceView; label: string }[] = [
  { id: "gallery", label: "Gallery" },
  { id: "design", label: "Design" },
];

export function ProjectWorkspace({
  projectId,
  title,
  brief,
}: {
  projectId: string;
  title: string;
  brief: string;
}) {
  const isSidebarOpen = useSidebarStore((state) => state.isOpen);
  const width = useSidebarStore((state) => state.width);

  /// The stored width and collapsed state arrive after hydration, never during
  /// it: the server rendered the default, and `persist` is told to skip its own
  /// module-evaluation rehydrate so that this effect is the one re-render that
  /// swaps them in (see `use-sidebar-store.ts`).
  useEffect(() => void useSidebarStore.persist.rehydrate(), []);
  useEffect(() => void useConversationStore.persist.rehydrate(), []);
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  /// The project's threads, and which one is open — resolved here rather than in
  /// the column because the column unmounts on collapse and the three listeners
  /// below have to keep working while it is shut, which is the reason they live
  /// out here at all (orchestrator-tool-reference §VII.2).
  const { data: conversations } = useQuery(trpc.chat.conversations.queryOptions({ projectId }));

  /// The threads this browser has minted and may not have spoken in yet (§VII.3).
  /// "New chat" writes no row, so a minted id is in no list — and without this
  /// the column would jump straight off it the moment the list landed. The
  /// newest is also the fallback for a project with nothing to open at all.
  ///
  /// It does not survive a reload, and that is right: an empty chat is not worth
  /// restoring, and pressing "New chat" again costs nothing.
  const [mintedIds, setMintedIds] = useState<string[]>(() => [crypto.randomUUID()]);
  const freshId = mintedIds[mintedIds.length - 1]!;
  const session = useMemo(() => new Set(mintedIds), [mintedIds]);
  useEffect(() => {
    for (const id of mintedIds) mintChat(id);
  }, [mintedIds]);

  const chosenId = useOpenConversation(projectId);
  const conversationId = openConversationId(conversations, chosenId, session, freshId);

  /// Whether the column should fetch a stored page of messages for this thread.
  ///
  /// Two things have to be true. It has to be a row — a minted thread is in no
  /// list, and asking `chat.list` about one would be a 404 for a conversation
  /// that does not exist yet. And it must not be a thread *this session* minted:
  /// once the first message is sent it becomes a row and joins the list, but its
  /// messages are already in the store, and fetching them again would be a
  /// round trip whose only possible outcome is being thrown away by the store's
  /// once-guard.
  const isStored =
    (conversations?.some((row) => row.id === conversationId) ?? false) &&
    !session.has(conversationId);

  const seat: ChatSeat = { projectId, conversationId };

  /// Where the switcher sends the column. `null` is "there is nothing left to
  /// open" — a fresh chat, minted here because minting is the workspace's
  /// business: it owns the session's list of unspoken threads.
  ///
  /// Pressing "New chat" while already sitting in one does nothing, which is the
  /// honest answer: you are already in a new chat. Minting a second would put
  /// the half-written sentence in the first somewhere with no row in the
  /// switcher to get back to it.
  const openConversation = useCallback(
    (id: string | null) => {
      if (id) {
        chooseConversation(projectId, id);
        return;
      }
      if (!isStored && session.has(conversationId)) return;
      const fresh = crypto.randomUUID();
      mintChat(fresh);
      setMintedIds((ids) => [...ids, fresh]);
      chooseConversation(projectId, fresh);
    },
    [conversationId, isStored, projectId, session],
  );

  /// The store's copy of every event the listeners below put in the column, so
  /// a reload draws the note and the tile the session drew.
  ///
  /// The switcher is told afterwards: a note is the first thing said in a thread
  /// nobody had spoken in, so the record may have just *opened* the row this
  /// list is missing — and on an old thread it has still moved it to the top.
  const recordEvent: RecordChatEvent = useCallback(
    async (input) => {
      const written = await client.chat.record.mutate(
        input as Parameters<typeof client.chat.record.mutate>[0],
      );
      await queryClient.invalidateQueries({
        queryKey: trpc.chat.conversations.queryOptions({ projectId }).queryKey,
      });
      return written;
    },
    [client, projectId, queryClient, trpc],
  );
  const [isResizing, setIsResizing] = useState(false);
  /// The gallery is where references arrive, the board is where they are
  /// composed. They want the same column and all of it, so they take turns
  /// rather than splitting it.
  const [view, setView] = useState<WorkspaceView>("gallery");
  /// Held here rather than in the uploader: the dropzone knows which files are
  /// in flight and the gallery is what has to show them.
  const uploads = usePendingUploads();

  /// The grid-sized copy a picture nobody uploaded is still owed — a drawing
  /// the assistant filed, above all. Kept here for the reason the listeners
  /// below are: the turn that drew it may not have been the last thing to
  /// happen, and the column that ran the derivation collapses.
  useDerivedReferenceCopies(projectId);

  /// A cut the user takes in the properties panel goes back into the
  /// conversation — it is the other end of `crop_reference`, and the note it
  /// leaves is what lets the next turn name the new row without buying a round
  /// to find it. Listened for here rather than in the assistant's column, because
  /// that column collapses and the taking does not wait for it to be open.
  useEffect(
    () => onCutTaken((cut) => recordCutTaken({ projectId, conversationId }, cut, recordEvent)),
    [projectId, conversationId, recordEvent],
  );

  /// A board that has gone, from whichever door it went by: the chat's own
  /// Discard button, or the delete in the tab row. The conversation may be
  /// holding a tile of it, and a tile whose board no longer exists opens
  /// whichever board the tab row falls back to — the one failure in this
  /// pipeline that is reported to neither the user nor the model.
  useEffect(
    () =>
      onBoardDiscarded((board) =>
        recordBoardDiscarded({ projectId, conversationId }, board, recordEvent),
      ),
    [projectId, conversationId, recordEvent],
  );

  /// And a picture that has gone, by whichever door: the chat's Remove button,
  /// the gallery tile's, or the versions list's. Same reason, one column over —
  /// a tile whose picture no longer exists is a click the properties panel has
  /// nowhere to answer.
  useEffect(
    () =>
      onReferenceDiscarded((reference) =>
        recordReferenceDiscarded({ projectId, conversationId }, reference, recordEvent),
      ),
    [projectId, conversationId, recordEvent],
  );

  /// Pointer capture keeps the drag alive over the gallery and past the window
  /// edge, which a plain pointermove on the handle loses the moment the cursor
  /// outruns it.
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    handle.setPointerCapture(event.pointerId);
    setIsResizing(true);

    const onMove = (move: PointerEvent) =>
      setSidebarWidth(widthAfterDrag(startWidth, startX, move.clientX), { persist: false });
    const onEnd = (end: PointerEvent) => {
      setSidebarWidth(widthAfterDrag(startWidth, startX, end.clientX));
      setIsResizing(false);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  return (
    /// The sidebar is a flex sibling, not an overlay — expanding it narrows the
    /// gallery instead of covering it.
    <div className="flex min-h-0 flex-1 items-stretch">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-2">
          <Link href="/projects" className="text-sm opacity-50 hover:opacity-80">
            ← Projects
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <ProjectBrief projectId={projectId} brief={brief} />

          <nav className="mt-2 flex gap-1 self-start rounded-full border border-current/15 p-0.5">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                aria-current={view === option.id}
                className={`rounded-full px-3 py-1 text-xs transition-opacity ${
                  view === option.id ? "bg-current/10 font-medium" : "opacity-60 hover:opacity-100"
                }`}
              >
                {option.label}
              </button>
            ))}
          </nav>
        </header>

        {view === "gallery" ? (
          <>
            <GalleryUploader projectId={projectId} uploads={uploads} />
            <GalleryView projectId={projectId} pendingUploads={uploads.pending} />
          </>
        ) : (
          <DesignView projectId={projectId} />
        )}
      </main>

      <aside
        style={{ width: sidebarPageWidth({ isOpen: isSidebarOpen, width }) }}
        className={`shrink-0 overflow-hidden border-l border-current/10 ${
          /// Animating the collapse is worth it; animating a drag makes the edge
          /// trail the pointer.
          isResizing ? "" : "transition-[width] duration-200"
        }`}
      >
        {/* `sticky` is a positioned value, so the resize handle can be absolute
            against it without a second wrapper. */}
        <div className="sticky top-0 flex h-dvh flex-col">
          {isSidebarOpen ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              aria-valuenow={width}
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") setSidebarWidth(width + SIDEBAR_KEYBOARD_STEP);
                else if (event.key === "ArrowRight") setSidebarWidth(width - SIDEBAR_KEYBOARD_STEP);
                else return;
                event.preventDefault();
              }}
              className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-current/20 focus-visible:bg-current/30 focus-visible:outline-none"
            />
          ) : null}

          <div
            className={`flex items-center gap-2 border-b border-current/10 px-3 py-3 ${
              isSidebarOpen ? "justify-between" : "justify-center"
            }`}
          >
            {isSidebarOpen ? (
              <ConversationHeader
                projectId={projectId}
                conversationId={conversationId}
                conversations={conversations}
                onOpen={openConversation}
              />
            ) : null}
            <button
              type="button"
              onClick={toggleSidebar}
              aria-expanded={isSidebarOpen}
              aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              className="rounded-md border border-current/20 px-2 py-1 text-xs transition-opacity hover:opacity-70"
            >
              {isSidebarOpen ? "→" : "←"}
            </button>
          </div>

          {isSidebarOpen ? (
            <>
              <SidebarGallery projectId={projectId} />
              {/* What the assistant showed is a way into the workspace, not a
                  picture of it. A reference switches the column back to the grid
                  it lives in — the properties panel lays over that column, and
                  opening it on top of the board would hide what it was covering
                  — and a board switches the column to the board. */}
              <ConversationBody
                /// Keyed by the thread, so switching one out gives the column a
                /// fresh instance rather than one carrying the last thread's
                /// local state. What is *not* thrown away is the draft: that
                /// lives in the store, under the thread's own key.
                key={conversationId}
                seat={seat}
                isStored={isStored}
                onOpen={(target) => {
                  setView(target.view);
                  if (target.view !== "gallery") {
                    openBoard(target.boardId);
                    return;
                  }
                  /// The cut is put down before the panel goes looking for it,
                  /// so the frame opens at the row that was clicked instead of at
                  /// the top of a list holding it.
                  focusVersion(
                    target.versionId
                      ? { frameId: target.inspectId, versionId: target.versionId }
                      : null,
                  );
                  inspectReference(target.inspectId);
                }}
              />
            </>
          ) : (
            <span className="mt-6 self-center text-xs tracking-widest opacity-40 [writing-mode:vertical-rl]">
              ASSISTANT
            </span>
          )}
        </div>
      </aside>

      {/* The Vibes loop, mounted where it outlives both the board it is
          designing and the switch to the references grid (`compositor-v2.md`
          §IX.2). Draws nothing until a run is announced. */}
      <VibesRunPanel projectId={projectId} />
    </div>
  );
}
