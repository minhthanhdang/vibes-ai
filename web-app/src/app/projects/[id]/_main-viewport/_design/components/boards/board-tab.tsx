"use client";

import { useRef, useState } from "react";
import { BOARD_TITLE_LIMIT, normalizedBoardTitle } from "@/lib/scene/moodboard-boards";
import { useBoardHeld } from "../../../../_workspace/stores/use-board-hold-store";
import type { Board } from "../../types";

export function BoardTab({
  board,
  isActive,
  onOpen,
  onRename,
  onDuplicate,
  onRemove,
}: {
  board: Board;
  isActive: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  const held = useBoardHeld(board.id);

  const committed = useRef(false);

  function startRename() {
    if (held) return;
    setConfirmingRemoval(false);
    committed.current = false;
    setDraft(board.title);
  }

  function commitRename() {
    if (committed.current || draft === null) return;
    committed.current = true;
    const title = normalizedBoardTitle(draft);
    setDraft(null);
    if (title && title !== board.title) onRename(title);
  }

  if (draft !== null) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={BOARD_TITLE_LIMIT}
        aria-label={`Rename ${board.title}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitRename}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            committed.current = true;
            setDraft(null);
          }
        }}
        className="w-full min-w-40 shrink-0 rounded-lg border border-current/40 bg-transparent px-3 py-1 text-xs outline-none"
      />
    );
  }

  if (confirmingRemoval) {
    return (
      <span className="flex shrink-0 items-center gap-2 rounded-lg border border-current/40 px-3 py-1 text-xs">
        Delete “{board.title}”?
        <button type="button" onClick={onRemove} className="font-medium underline">
          Delete
        </button>
        <button
          type="button"
          onClick={() => setConfirmingRemoval(false)}
          className="opacity-60 underline hover:opacity-100"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center rounded-lg border transition-opacity ${
        isActive ? "border-current/40 font-medium" : "border-current/15 opacity-60 hover:opacity-100"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={startRename}
        aria-current={isActive}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-1 pl-1.5 text-xs"
      >
        {board.renderUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={board.renderUrl}
            alt=""
            loading="lazy"
            className="h-5 w-8 shrink-0 rounded-sm bg-current/5 object-cover"
          />
        ) : (
          <span className="h-5 w-8 shrink-0 rounded-sm border border-dashed border-current/20" />
        )}
        <span className="truncate">{board.title}</span>
      </button>

      {isActive && held ? (
        <span className="pr-3 text-[11px] opacity-50" title="An agent is editing this board">
          editing…
        </span>
      ) : isActive ? (
        <>
          <button
            type="button"
            onClick={startRename}
            aria-label={`Rename ${board.title}`}
            title="Rename"
            className="px-1 py-1 text-xs opacity-60 hover:opacity-100"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            aria-label={`Duplicate ${board.title}`}
            title="Duplicate board"
            className="px-1 py-1 text-xs opacity-60 hover:opacity-100"
          >
            ⧉
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRemoval(true)}
            aria-label={`Delete ${board.title}`}
            title="Delete board"
            className="py-1 pr-3 pl-1 text-xs opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </>
      ) : (
        <span className="pr-3" />
      )}
    </span>
  );
}