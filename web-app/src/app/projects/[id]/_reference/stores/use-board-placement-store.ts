"use client";

import { create } from "zustand";
import { sameReferenceCounts, sceneReferenceCounts } from "@/lib/references/reference-usage";

export type BoardPlacement = {
  boardId: string;
  counts: ReadonlyMap<string, number>;
};

type BoardPlacementState = {
  placement: BoardPlacement | null;
  publishBoardPlacement: (boardId: string, elements: unknown) => void;
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
