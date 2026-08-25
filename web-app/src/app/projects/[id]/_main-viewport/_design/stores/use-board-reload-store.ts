"use client";

import { useSyncExternalStore } from "react";

/// A board on screen that the server has moved on from.
///
/// The editor owns the scene from the moment it mounts — that is why
/// `design-view` pins the query and remounts on a new document rather than
/// letting a refetch replace one under it — so nothing that writes to a board
/// from outside the tab shows up until something asks for it. Until "Let's
/// Vibes" that was fine: agent 6's writes land during a turn the user is reading
/// in the other column, and the save gate catches the rest as a conflict.
///
/// A Vibes run is the case that breaks it. The board is made, opened, and then
/// filled in one page at a time by a loop in this same browser, and a user
/// watching an empty board for four minutes has no way to know it is working.
///
/// A request, like `use-open-board-store`'s, and counted rather than boolean: the
/// same board is asked for again after every page, and a flag would only be
/// seen the first time.
const listeners = new Set<() => void>();
let asked: { boardId: string; at: number } | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read() {
  return asked;
}

export function reloadBoard(boardId: string) {
  asked = { boardId, at: (asked?.at ?? 0) + 1 };
  for (const listener of [...listeners]) listener();
}

/// How many times this board has been asked to reload. Zero for a board nobody
/// has asked about, so the mount that reads it does nothing.
export function useBoardReloads(boardId: string) {
  const request = useSyncExternalStore(subscribe, read, () => null);
  return request && request.boardId === boardId ? request.at : 0;
}
