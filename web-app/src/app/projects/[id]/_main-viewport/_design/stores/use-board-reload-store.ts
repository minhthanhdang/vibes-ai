"use client";

import { create } from "zustand";

type BoardReloadState = {
  asked: Readonly<Record<string, number>>;
  reloadBoard: (boardId: string) => void;
};

export const useBoardReloadStore = create<BoardReloadState>()((set) => ({
  asked: {},
  reloadBoard: (boardId) =>
    set((state) => ({ asked: { ...state.asked, [boardId]: (state.asked[boardId] ?? 0) + 1 } })),
}));

export function reloadBoard(boardId: string) {
  useBoardReloadStore.getState().reloadBoard(boardId);
}

export function useBoardReloads(boardId: string) {
  return useBoardReloadStore((state) => state.asked[boardId] ?? 0);
}
