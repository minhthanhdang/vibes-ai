"use client";

import { useSyncExternalStore } from "react";

/// Which board something outside the moodboard panel has asked to open.
///
/// The same cross-column problem `reference-inspection.ts` solves, and the same
/// answer: the assistant is in the sidebar, the tab row is in the other column,
/// and a prop between them would have to be threaded through the workspace and
/// two components that otherwise know nothing about each other.
///
/// A request, not the selection. The panel still decides which board is open —
/// this only says which one was pointed at, and it is cleared the moment the
/// user clicks a tab themselves, so a board the assistant composed an hour
/// ago cannot pull the view back off the one they are working on.
const listeners = new Set<() => void>();
let requestedId: string | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readRequested() {
  return requestedId;
}

export function openBoard(id: string | null) {
  if (requestedId === id) return;
  requestedId = id;
  for (const listener of listeners) listener();
}

export function useRequestedBoard() {
  return useSyncExternalStore(subscribe, readRequested, () => null);
}

/// And the other direction: which board the panel actually settled on.
///
/// A request is what the assistant's column says to the board's; this is what the
/// board's column says back, and the chat needs it to list the pages a message can
/// attach one of (§V.5). The panel decides — the tab clicked, the board a request
/// pointed at, the one left after a deletion — so it is announced from there rather
/// than re-derived beside the composer from a list that is one invalidation behind.
///
/// Not cleared when the panel unmounts: switching to the gallery does not put the
/// board away, and a user who was composing a minute ago and is now typing
/// about it should still be able to attach the page they were looking at.
let openId: string | null = null;

function readOpen() {
  return openId;
}

export function boardOpened(id: string | null) {
  if (openId === id) return;
  openId = id;
  for (const listener of listeners) listener();
}

export function useOpenBoard() {
  return useSyncExternalStore(subscribe, readOpen, () => null);
}
