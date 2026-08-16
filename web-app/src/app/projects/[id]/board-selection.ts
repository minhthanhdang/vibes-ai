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
/// director clicks a tab themselves, so a board the assistant composed an hour
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
