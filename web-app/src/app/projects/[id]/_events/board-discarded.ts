"use client";

import type { DiscardedBoard } from "@/lib/boards/board-discard";

/// A board that has just stopped existing, on its way to the conversation.
///
/// The second event to cross between the columns, and it is announced from both
/// doors for one reason: the chat may be holding a tile of that board. A tile
/// whose board is gone is a click that opens *a different board* — the tab row
/// falls back to the first one for an id it does not hold — which is the one
/// kind of failure this pipeline reports to nobody.
///
/// An event rather than a store, like a taken cut: it happens once, and reading
/// it twice would say it twice in the conversation.
type Listener = (board: DiscardedBoard) => void;

const listeners = new Set<Listener>();

export function onBoardDiscarded(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// Copied before the walk, for the reason `announceCutTaken` copies: a listener
/// that unsubscribes while handling would mutate the set being iterated.
export function announceBoardDiscarded(board: DiscardedBoard) {
  for (const listener of [...listeners]) listener(board);
}
