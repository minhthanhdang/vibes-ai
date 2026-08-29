"use client";

import { useEffect, useRef } from "react";
import { BoardTab } from "./board-tab";
import type { Board } from "../../types";

/// The project's boards, in one scrolling column, and the way to start another.
///
/// The list is the whole of the dock it opens into: a board is chosen, renamed,
/// copied and deleted from its own tab, so there is no toolbar around it and
/// nothing here but the tabs and "New board".
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

  /// Opening the dock on a board that is scrolled out of the list would show a
  /// column with nothing in it marked current. Nudged rather than
  /// `scrollIntoView`d: the page under this is scrollable too, and that would
  /// move it.
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
    /// The scrollbar is hidden because the list sits inside the dock's rounded
    /// panel, where a bar drawn along the edge cuts the corners off. The tab
    /// clipped at the edge is the affordance instead; a vertical wheel scrolls
    /// it natively.
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
