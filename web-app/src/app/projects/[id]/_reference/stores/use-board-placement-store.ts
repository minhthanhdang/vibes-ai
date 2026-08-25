"use client";

import { create } from "zustand";
import { sameReferenceCounts, sceneReferenceCounts } from "@/lib/references/reference-usage";

/// What the open board is showing, published for the reference strip beside it.
///
/// The strip is the board's only drag source and the two are in different
/// columns of the workspace — the canvas is inside `DesignView`, the strip is
/// in the sidebar — so a prop would have to be threaded through three components
/// that have no other reason to know about each other. A store is the same shape
/// the sidebar's own width already uses, and it keeps the board free to publish
/// from a timer rather than from a render.
export type BoardPlacement = {
  boardId: string;
  /// Reference id → how many elements of the board show it.
  counts: ReadonlyMap<string, number>;
};

type BoardPlacementState = {
  placement: BoardPlacement | null;
  /// Called from the canvas's quiet period, so it is handed the editor's raw
  /// element array rather than a set someone else had to build. Unchanged is the
  /// common case by far — moving a photo does not change which photos are on the
  /// board — and it must not cost the strip a render, so the same object has to
  /// come back until the board actually changes.
  publishBoardPlacement: (boardId: string, elements: unknown) => void;
  /// No board is open. Not the same as an empty board: the strip stops asking
  /// the question rather than answering "none of them are placed".
  clearBoardPlacement: () => void;
};

export const useBoardPlacementStore = create<BoardPlacementState>()((set, get) => ({
  placement: null,
  publishBoardPlacement: (boardId, elements) => {
    const counts = sceneReferenceCounts(elements);
    const { placement } = get();
    if (placement?.boardId === boardId && sameReferenceCounts(placement.counts, counts)) return;
    set({ placement: { boardId, counts } });
  },
  clearBoardPlacement: () => {
    if (get().placement === null) return;
    set({ placement: null });
  },
}));

export function publishBoardPlacement(boardId: string, elements: unknown) {
  useBoardPlacementStore.getState().publishBoardPlacement(boardId, elements);
}

export function clearBoardPlacement() {
  useBoardPlacementStore.getState().clearBoardPlacement();
}
