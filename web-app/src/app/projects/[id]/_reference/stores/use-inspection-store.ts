"use client";

import { create } from "zustand";

/// Which reference the properties panel is open on, published for whatever asked
/// for it.
///
/// The panel is rendered by the sidebar's reference strip, and the gallery grid
/// is in the other column — the same split `use-board-placement-store.ts`
/// crosses, and the same answer: a prop would have to be threaded through the
/// workspace and two components that have no other reason to know about each
/// other.
///
/// The gallery needs to be able to open it because a frame's crops are shown
/// only there. The grid says how many a photo has; this is the way from that
/// number to the list it counts.
type InspectionState = {
  inspectedId: string | null;
  inspectReference: (id: string | null) => void;
};

export const useInspectionStore = create<InspectionState>()((set) => ({
  inspectedId: null,
  inspectReference: (id) => set({ inspectedId: id }),
}));

export function inspectReference(id: string | null) {
  useInspectionStore.getState().inspectReference(id);
}
