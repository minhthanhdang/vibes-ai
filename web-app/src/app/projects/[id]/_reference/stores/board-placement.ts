"use client";

import { useSyncExternalStore } from "react";
import { sameReferenceCounts, sceneReferenceCounts } from "@/lib/references/reference-usage";

/// What the open board is showing, published for the reference strip beside it.
///
/// The strip is the board's only drag source and the two are in different
/// columns of the workspace — the canvas is inside `MoodboardPanel`, the strip is
/// in the sidebar — so a prop would have to be threaded through three components
/// that have no other reason to know about each other. An external store is the
/// same shape the sidebar's own width already uses, and it keeps the board free
/// to publish from a timer rather than from a render.
export type BoardPlacement = {
  boardId: string;
  /// Reference id → how many elements of the board show it.
  counts: ReadonlyMap<string, number>;
};

const listeners = new Set<() => void>();
let placement: BoardPlacement | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// The same object has to come back until the board actually changes, or
/// `useSyncExternalStore` re-renders the strip on every check.
function readPlacement() {
  return placement;
}

/// Called from the canvas's quiet period, so it is handed the editor's raw
/// element array rather than a set someone else had to build. Unchanged is the
/// common case by far — moving a photo does not change which photos are on the
/// board — and it must not cost the strip a render.
export function publishBoardPlacement(boardId: string, elements: unknown) {
  const counts = sceneReferenceCounts(elements);
  if (placement?.boardId === boardId && sameReferenceCounts(placement.counts, counts)) return;
  placement = { boardId, counts };
  for (const listener of listeners) listener();
}

/// No board is open. Not the same as an empty board: the strip stops asking the
/// question rather than answering "none of them are placed".
export function clearBoardPlacement() {
  if (placement === null) return;
  placement = null;
  for (const listener of listeners) listener();
}

export function useBoardPlacement() {
  return useSyncExternalStore(subscribe, readPlacement, () => null);
}
