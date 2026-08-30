"use client";

import { useEffect, useRef } from "react";
import { BoardTab } from "./board-tab";
import type { Board } from "../../types";

export function BoardTabs({
  boards,
  activeId,
  isCreating,
  onOpen,
  onRename,
  onDuplicate,
  onRemove,
  onCreate,
}: {
  boards: readonly Board[] | undefined;
  activeId: string | null;
  isCreating: boolean;
  onOpen: (board: Board) => void;
  onRename: (board: Board, title: string) => void;
  onDuplicate: (board: Board) => void;
  onRemove: (board: Board) => void;
  onCreate: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = row.current;
    const tab = strip?.querySelector('[aria-current="true"]')?.parentElement;
    if (!strip || !tab) return;

    const edge = strip.getBoundingClientRect();
    const seat = tab.getBoundingClientRect();
    const margin = 8;
    if (seat.top < edge.top) strip.scrollTop -= edge.top - seat.top + margin;
    else if (seat.bottom > edge.bottom) strip.scrollTop += seat.bottom - edge.bottom + margin;
  }, [activeId, boards]);

  return (
    <div
      ref={row}
      className="flex min-h-0 flex-col items-stretch gap-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {boards?.map((board) => (
        <BoardTab
          key={board.id}
          board={board}
          isActive={board.id === activeId}
          onOpen={() => onOpen(board)}
          onRename={(title) => onRename(board, title)}
          onDuplicate={() => onDuplicate(board)}
          onRemove={() => onRemove(board)}
        />
      ))}

      <button
        type="button"
        onClick={onCreate}
        disabled={isCreating}
        className="shrink-0 rounded-lg border border-dashed border-current/25 px-3 py-1 text-xs opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
      >
        + New board
      </button>
    </div>
  );
}
