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
import { useChatLog } from "../stores/use-chat-log-store";
import { useChatCacheReset } from "../hooks/use-chat-cache";
import type { ConversationRow } from "../types";

export function ConversationHeader({
  projectId,
  conversationId,
  conversations,
  seatsLeft,
  canMint,
  onOpen,
}: {
  projectId: string;
  conversationId: string;
  conversations: ConversationRow[] | undefined;
  seatsLeft: number | null;
  canMint: boolean;
  onOpen: (conversationId: string | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const resetChatCache = useChatCacheReset();
  const [isOpen, setIsOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const listKey = trpc.chat.conversations.queryOptions({ projectId }).queryKey;
  const rows = conversations ?? [];
  const openTitle = rows.find((row) => row.id === conversationId)?.title ?? NEW_CHAT_TITLE;

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
      onMutate: () => setIsOpen(false),
      onSuccess: ({ id }) => resetChatCache(id),
      onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
    }),
  );

  const remove = useMutation(
    trpc.chat.remove.mutationOptions({
      onMutate: ({ conversationId: id }) => {
        setIsOpen(false);
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
            disabled={!canMint}
            onClick={() => {
              onOpen(null);
              setIsOpen(false);
            }}
            className="shrink-0 rounded-md border border-dashed border-current/25 px-3 py-1.5 text-left text-xs opacity-70 transition-opacity hover:opacity-100 disabled:opacity-30 disabled:hover:opacity-30"
          >
            + New chat
          </button>

          {seatsLeft === null ? null : (
            <p className="shrink-0 px-3 py-1 text-[11px] opacity-50">
              {canMint
                ? `${seatsLeft} of your plan's chats left in this project`
                : "Your plan's chats for this project are all open — delete one to start another."}
            </p>
          )}

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
