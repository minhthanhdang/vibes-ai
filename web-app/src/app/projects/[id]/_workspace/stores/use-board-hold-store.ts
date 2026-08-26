"use client";

import { create } from "zustand";

/// Which boards an agent is currently writing to, in this tab.
///
/// A board being rewritten by agent 8 is a board the user must not edit: nothing
/// today stops a drag landing on a page half-way through being laid out, and the
/// save that follows it either loses their work to the revision guard or lands
/// on top of the agent's. Under a hold the canvas goes read-only — still
/// pannable, so the page can be watched being built — and, because there is then
/// no unsaved work to lose, the reload the turn owes the board becomes safe to
/// take while it is still on screen.
///
/// Held **by count, not by flag**: two `design_page` calls on one board in a
/// turn, or a Vibes run over a board the chat is also designing, must not be
/// released by whichever finishes first.
///
/// It lives here rather than beside `use-board-reload-store` in `_design/`
/// because it is written from two columns — the chat's turn and the Vibes
/// panel — and read by a third. That is `use-open-board-store`'s situation
/// exactly, and why that one lives here.
///
/// Per tab, deliberately. The alternative is polling the `AgentRun` rows, where a
/// `RUNNING` row from a crashed run locks a board until an age cutoff lets it
/// go; here the stream's end *is* the release. A second tab on the same board
/// stays editable, and nothing outside this browser is enforced at all — the
/// server's revision guard is still what actually protects a write.
type BoardHoldState = { held: Readonly<Record<string, number>> };

export const useBoardHoldStore = create<BoardHoldState>()(() => ({ held: {} }));

export function holdBoard(boardId: string) {
  useBoardHoldStore.setState((state) => ({
    held: { ...state.held, [boardId]: (state.held[boardId] ?? 0) + 1 },
  }));
}

export function releaseBoard(boardId: string) {
  useBoardHoldStore.setState((state) => {
    const count = state.held[boardId] ?? 0;
    if (count === 0) return state;
    const held = { ...state.held };
    if (count > 1) held[boardId] = count - 1;
    else delete held[boardId];
    return { held };
  });
}

/// The holds a turn still had open, dropped on its way out — the path that
/// answered and the path that broke alike. A count that a lost `called` left
/// standing would otherwise lock the board for the life of the tab.
///
/// One release per hold the caller opened, rather than emptying the store:
/// clearing it would drop a Vibes run's hold on the same board, which is the
/// one thing counting them is for.
export function releaseBoards(boardIds: readonly string[]) {
  for (const boardId of boardIds) releaseBoard(boardId);
}

/// Whether an agent is holding this board. A scalar, so a board nobody is
/// holding never re-renders on someone else's hold.
export function useBoardHeld(boardId: string) {
  return useBoardHoldStore((state) => (state.held[boardId] ?? 0) > 0);
}
