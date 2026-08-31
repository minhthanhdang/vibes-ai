"use client";

import { create } from "zustand";

export type SidebarTab = "references" | "vibes";

type SidebarTabState = {
  tab: SidebarTab;
  setTab: (tab: SidebarTab) => void;
};

export const useSidebarTabStore = create<SidebarTabState>()((set) => ({
  tab: "references",
  setTab: (tab) => set({ tab }),
}));

export function setSidebarTab(tab: SidebarTab) {
  useSidebarTabStore.getState().setTab(tab);
}
