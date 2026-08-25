"use client";

import { useEffect, useRef } from "react";
import { BoardTab } from "./board-tab";
import type { Board } from "../../types";

/// The project's boards, in one scrolling row, and the way to start another.
///
/// The row is the whole of the dock it opens into: a board is chosen, renamed,
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

  /// A mouse has one wheel and it points the wrong way. The row scrolls on one
  /// axis, so a vertical wheel over it is chained to the page instead — the
  /// tabs sit still while the whole workspace nudges. Turning the delta
  /// sideways is what a horizontal row of anything is expected to do.
  ///
  /// Listened for directly because React's `wheel` is passive, and a handler
  /// that cannot call `preventDefault` cannot stop the page taking the scroll
  /// as well.
  useEffect(() => {
    const strip = row.current;
    if (!strip) return;

    const turnSideways = (event: WheelEvent) => {
      /// A trackpad already sends the sideways delta; only the wheel needs help.
      if (event.deltaX !== 0) return;
      if (strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };

    strip.addEventListener("wheel", turnSideways, { passive: false });
    return () => strip.removeEventListener("wheel", turnSideways);
  }, []);

  /// Opening the dock on a board that is scrolled out of the strip would show a
  /// row with nothing in it marked current. Nudged rather than
  /// `scrollIntoView`d: the page under this is scrollable too, and that would
  /// move it.
  useEffect(() => {
    const strip = row.current;
    const tab = strip?.querySelector('[aria-current="true"]')?.parentElement;
    if (!strip || !tab) return;

    const edge = strip.getBoundingClientRect();
    const seat = tab.getBoundingClientRect();
    const margin = 8;
    if (seat.left < edge.left) strip.scrollLeft -= edge.left - seat.left + margin;
    else if (seat.right > edge.right) strip.scrollLeft += seat.right - edge.right + margin;
  }, [activeId, boards]);

  return (
    /// The scrollbar is hidden because the row sits inside the dock's pill,
    /// where a bar drawn across the bottom edge cuts the corners off. The tab
    /// clipped at the edge is the affordance instead, and the wheel above is
    /// what makes it reachable without one.
    <div
      ref={row}
      className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
        className="shrink-0 rounded-full border border-dashed border-current/25 px-3 py-1 text-xs opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
      >
        + New board
      </button>
    </div>
  );
}
