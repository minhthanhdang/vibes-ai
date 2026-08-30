"use client";

import { create } from "zustand";

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

export function releaseBoards(boardIds: readonly string[]) {
  for (const boardId of boardIds) releaseBoard(boardId);
}

export function useBoardHeld(boardId: string) {
  return useBoardHoldStore((state) => (state.held[boardId] ?? 0) > 0);
}
