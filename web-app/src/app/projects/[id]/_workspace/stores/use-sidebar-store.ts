"use client";

import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import {
  SIDEBAR_DEFAULT_STATE,
  clampSidebarWidth,
  parseSidebarState,
  serializeSidebarState,
  type SidebarState,
} from "@/lib/ui/sidebar";

const STORAGE_KEY = "director-assistant:sidebar";

let writeThrough = true;

const storage: PersistStorage<SidebarState> = {
  getItem: (name) => {
    try {
      return { state: parseSidebarState(window.localStorage.getItem(name)) };
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (!writeThrough) return;
    try {
      window.localStorage.setItem(name, serializeSidebarState(value.state));
    } catch {
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
    }
  },
};

type SidebarStore = SidebarState & {
  toggleSidebar: () => void;
  openSidebar: () => void;
  setSidebarWidth: (width: number) => void;
};

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set, get) => ({
      ...SIDEBAR_DEFAULT_STATE,
      toggleSidebar: () => set({ isOpen: !get().isOpen }),
      openSidebar: () => {
        if (!get().isOpen) set({ isOpen: true });
      },
      setSidebarWidth: (width) => set({ width: clampSidebarWidth(width) }),
    }),
    {
      name: STORAGE_KEY,
      storage,
      skipHydration: true,
      partialize: ({ isOpen, width }) => ({ isOpen, width }),
    },
  ),
);

export function toggleSidebar() {
  useSidebarStore.getState().toggleSidebar();
}

export function openSidebar() {
  useSidebarStore.getState().openSidebar();
}

export function setSidebarWidth(width: number, { persist = true } = {}) {
  writeThrough = persist;
  try {
    useSidebarStore.getState().setSidebarWidth(width);
  } finally {
    writeThrough = true;
  }
}
