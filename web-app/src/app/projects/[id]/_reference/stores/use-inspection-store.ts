"use client";

import { create } from "zustand";

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
