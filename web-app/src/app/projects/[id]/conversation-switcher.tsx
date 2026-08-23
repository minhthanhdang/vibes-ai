"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import {
  CONVERSATION_TITLE_LIMIT,
  NEW_CHAT_TITLE,
  conversationAfterRemoval,
  normalizedConversationTitle,
  withConversationTitle,
} from "@/lib/agent/shared/conversation-list";
import { useChatLog } from "./chat-log";
import { useChatCacheReset } from "./chat-cache";

/// The switcher, in the column's own header (orchestrator-tool-reference §VII.2).
///
/// An expandable list under the bar rather than a `<select>` or a second column:
/// a thread needs a rename field and two destructive buttons beside it, and a
/// native select has room for none of them. Closed by default, because most of
/// the time there is one thread and the header is just its name.
///
/// The bar's parent is already `sticky` — a positioned value — so the panel can
/// be absolute against it with no new wrapper, which is the trick the resize
/// handle already uses.

export type ConversationRow = { id: string; title: string; updatedAt: Date };

export function ConversationSwitcher({
  projectId,
  conversationId,
  conversations,
  onOpen,
}: {
  projectId: string;
  conversationId: string;
  conversations: ConversationRow[] | undefined;
  /// Where the column goes next. `null` means "there is nothing left to open" —
  /// the caller mints a fresh chat, because minting is its business and not this
  /// component's.
  onOpen: (conversationId: string | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const resetChatCache = useChatCacheReset();
  const [isOpen, setIsOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const listKey = trpc.chat.conversations.queryOptions({ projectId }).queryKey;
  const rows = conversations ?? [];
  /// A thread this session minted is in no list, so the header names it the way
  /// the switcher's own empty row does.
  const openTitle = rows.find((row) => row.id === conversationId)?.title ?? NEW_CHAT_TITLE;

  /// Closed by Escape and by a press anywhere outside it — `pointerdown` rather
  /// than `click`, so the press that closes the panel is not also the press that
  /// activates whatever is under it.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [isOpen]);

  const rename = useMutation(
    trpc.chat.rename.mutationOptions({
      /// The row the user just typed into is the one thing on screen that must
      /// not flicker back to the old name for a round trip — the same trade the
      /// board tabs make. Skipped when the name is being *cleared*, because what
      /// the row goes back to is the derived title and only the server knows it.
      onMutate: async ({ conversationId: id, title }) => {
        if (!title) return { previous: undefined };
        await queryClient.cancelQueries({ queryKey: listKey });
        const previous = queryClient.getQueryData(listKey);
        queryClient.setQueryData(listKey, (current) =>
          current ? withConversationTitle(current, id, title) : current,
        );
        return { previous };
      },
      onError: (_error, _input, snapshot) => {
        if (snapshot?.previous) queryClient.setQueryData(listKey, snapshot.previous);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
    }),
  );

  const clear = useMutation(
    trpc.chat.clear.mutationOptions({
      /// The panel goes away with the press: what the user is being shown is the
      /// column underneath, now empty, which is the only confirmation an
      /// irreversible act of this kind can give.
      onMutate: () => setIsOpen(false),
      /// The store, the hydration mark and the query entry, together — the draft
      /// is deliberately the one thing kept. The column redraws from the store,
      /// which is what makes this the whole of the client-side work.
      onSuccess: ({ id }) => resetChatCache(id),
      onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
    }),
  );

  const remove = useMutation(
    trpc.chat.remove.mutationOptions({
      onMutate: ({ conversationId: id }) => {
        setIsOpen(false);
        /// Chosen before the row goes, from the list that still contains the one
        /// being deleted — otherwise "the most recently updated of the rest" is
        /// read off a list that has already lost its head.
        onOpen(conversationAfterRemoval(rows, id, conversationId));
      },
      onSuccess: ({ id }) => resetChatCache(id, { keepSeat: false }),
      onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
    }),
  );

  return (
    <div ref={panel} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label="Switch conversation"
        className="flex min-w-0 max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium hover:bg-current/5"
      >
        <span className="truncate">{openTitle}</span>
        <span aria-hidden className="shrink-0 text-xs opacity-50">
          ⌄
        </span>
      </button>

      {isOpen ? (
        <div className="absolute inset-x-0 top-full z-20 mt-2 flex max-h-96 flex-col gap-1 overflow-y-auto rounded-lg border border-current/15 bg-[var(--background)] p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
          <button
            type="button"
            onClick={() => {
              onOpen(null);
              setIsOpen(false);
            }}
            className="shrink-0 rounded-md border border-dashed border-current/25 px-3 py-1.5 text-left text-xs opacity-70 transition-opacity hover:opacity-100"
          >
            + New chat
          </button>

          {rows.map((row) => (
            <ConversationRowItem
              key={row.id}
              row={row}
              isOpen={row.id === conversationId}
              onOpen={() => {
                onOpen(row.id);
                setIsOpen(false);
              }}
              onRename={(title) =>
                rename.mutate({ projectId, conversationId: row.id, title })
              }
              onClear={() => clear.mutate({ projectId, conversationId: row.id })}
              onRemove={() => remove.mutate({ projectId, conversationId: row.id })}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/// One thread in the list, with the rename field and the two confirmations it
/// needs — mirroring `BoardTab` exactly, including the ref that stops a commit
/// running twice (a blur commits, and Enter blurs).
///
/// Confirmation is inline two-step arm/confirm because that is this app's only
/// pattern: there is no modal, no dialog component and no `window.confirm`
/// anywhere in this codebase, and adding one here would be the largest new thing
/// in the change.
function ConversationRowItem({
  row,
  isOpen,
  onOpen,
  onRename,
  onClear,
  onRemove,
}: {
  row: ConversationRow;
  isOpen: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onClear: () => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [arming, setArming] = useState<"clear" | "remove" | null>(null);
  const committed = useRef(false);

  /// The store is module-level, so this header can read whether *this* thread
  /// has a turn on the wire even though it lives outside the column that started
  /// it. Clearing thread B while a turn runs in A is correctly unaffected: the
  /// flag is per-thread now that the store keys by one.
  const { asking } = useChatLog(row.id);

  function startRename() {
    setArming(null);
    committed.current = false;
    setDraft(row.title);
  }

  function commitRename() {
    if (committed.current || draft === null) return;
    committed.current = true;
    const title = normalizedConversationTitle(draft);
    setDraft(null);
    /// An empty edit is not a cancelled rename here, unlike a board's: it is the
    /// way back to a thread naming itself from its own first message (§VII.4).
    if ((title ?? "") !== row.title) onRename(title ?? "");
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={CONVERSATION_TITLE_LIMIT}
        aria-label={`Rename ${row.title}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitRename}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            committed.current = true;
            setDraft(null);
          }
        }}
        className="shrink-0 rounded-md border border-current/40 bg-transparent px-3 py-1.5 text-xs outline-none"
      />
    );
  }

  if (arming) {
    return (
      <span className="flex shrink-0 flex-col gap-1 rounded-md border border-current/40 px-3 py-1.5 text-xs">
        {arming === "clear" ? (
          /// The sentence §VII.6 turns on. It is the whole reason clearing is
          /// offered at all, and a confirm that did not say it would be asking
          /// the user to agree to something else.
          <span className="opacity-80">
            Clear “{row.title}”? The boards, pages, cuts and pictures these turns made all stand —
            what goes is the words and the tiles above them, and a tile is the only place a deleted
            board’s title survives.
          </span>
        ) : (
          <span className="opacity-80">
            Delete “{row.title}”? The thread goes; everything it made stays in the project.
          </span>
        )}
        <span className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setArming(null);
              if (arming === "clear") onClear();
              else onRemove();
            }}
            className="font-medium underline"
          >
            {arming === "clear" ? "Clear" : "Delete"}
          </button>
          <button
            type="button"
            onClick={() => setArming(null)}
            className="opacity-60 underline hover:opacity-100"
          >
            Cancel
          </button>
        </span>
      </span>
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center rounded-md ${
        isOpen ? "bg-current/10 font-medium" : "opacity-70 hover:opacity-100"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={isOpen ? startRename : undefined}
        aria-current={isOpen}
        className="min-w-0 flex-1 truncate px-3 py-1.5 text-left text-xs"
      >
        {row.title}
      </button>

      {isOpen ? (
        <>
          <button
            type="button"
            onClick={startRename}
            aria-label={`Rename ${row.title}`}
            title="Rename"
            className="px-1 py-1 text-xs opacity-60 hover:opacity-100"
          >
            ✎
          </button>
          {/* Both destructive doors are shut while this thread has a turn on the
              wire: the answer is already paid for, and losing the thread it is
              about to be written into is the one way to throw it away. */}
          <button
            type="button"
            onClick={() => setArming("clear")}
            disabled={asking}
            title="Empty this chat, keep the thread"
            className="px-1 py-1 text-xs opacity-60 hover:opacity-100 disabled:opacity-20"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setArming("remove")}
            disabled={asking}
            title="Delete this chat"
            className="py-1 pr-2 pl-1 text-xs opacity-60 hover:opacity-100 disabled:opacity-20"
          >
            Delete
          </button>
        </>
      ) : null}
    </span>
  );
}
