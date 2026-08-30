"use client";

import type { DiscardedBoard } from "@/lib/boards/board-discard";

type Listener = (board: DiscardedBoard) => void;

const listeners = new Set<Listener>();

export function onBoardDiscarded(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceBoardDiscarded(board: DiscardedBoard) {
  for (const listener of [...listeners]) listener(board);
}
