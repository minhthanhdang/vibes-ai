"use client";

import { BoardTab } from "./board-tab";
import type { Board } from "../../types";

/// The project's boards, in one scrolling row, and the way to start another.
///
/// The row is the design view's whole top bar: a board is chosen, renamed,
/// copied and deleted from its own tab, so there is no toolbar above it and
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
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
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
        className="shrink-0 rounded-full border border-dashed border-current/25 px-3 py-1 text-xs opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
      >
        + New board
      </button>
    </div>
  );
}
