"use client";

import { create } from "zustand";

type OpenBoardState = {
  requestedId: string | null;
  openId: string | null;
  openBoard: (id: string | null) => void;
  boardOpened: (id: string | null) => void;
};

export const useOpenBoardStore = create<OpenBoardState>()((set) => ({
  requestedId: null,
  openId: null,
  openBoard: (id) => set({ requestedId: id }),
  boardOpened: (id) => set({ openId: id }),
}));

export function openBoard(id: string | null) {
  useOpenBoardStore.getState().openBoard(id);
}

export function boardOpened(id: string | null) {
  useOpenBoardStore.getState().boardOpened(id);
}
