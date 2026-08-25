"use client";

import { create } from "zustand";

/// Which board something outside the design view has asked to open, and which
/// one that view settled on.
///
/// The same cross-column problem `use-inspection-store.ts` solves, and the same
/// answer: the assistant is in the sidebar, the tab row is in the other column,
/// and a prop between them would have to be threaded through the workspace and
/// two components that otherwise know nothing about each other.
///
/// `requestedId` is a request, not the selection. The view still decides which
/// board is open — this only says which one was pointed at, and it is cleared
/// the moment the user clicks a tab themselves, so a board the assistant
/// composed an hour ago cannot pull the view back off the one they are working
/// on.
///
/// `openId` is the other direction: what the board's column says back, and the
/// chat needs it to list the pages a message can attach one of (§V.5). The view
/// decides — the tab clicked, the board a request pointed at, the one left after
/// a deletion — so it is announced from there rather than re-derived beside the
/// composer from a list that is one invalidation behind.
///
/// `openId` is not cleared when the view unmounts: switching to the gallery does
/// not put the board away, and a user who was composing a minute ago and is now
/// typing about it should still be able to attach the page they were looking at.
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

/// Called from render effects and event handlers that are not reading the store,
/// so they take the action off the instance rather than subscribing to it.
export function openBoard(id: string | null) {
  useOpenBoardStore.getState().openBoard(id);
}

export function boardOpened(id: string | null) {
  useOpenBoardStore.getState().boardOpened(id);
}
