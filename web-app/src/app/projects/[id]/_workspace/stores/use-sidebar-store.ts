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

/// A drag reports a width per pointer event and only the released width is worth
/// a synchronous `localStorage` write, so the one setter that must not reach the
/// disk lowers this for the length of its `set`. `persist` writes inside the
/// wrapped `set`, synchronously, which is what makes a module flag enough.
let writeThrough = true;

/// The stored shape is the one `@/lib/ui/sidebar` already reads and writes —
/// `{"isOpen":…,"width":…}` under the key above — rather than `persist`'s own
/// `{state,version}` envelope, so a browser holding a value from before this
/// store existed still opens at the width it was left at. `parseSidebarState`
/// degrades anything written by another build, or by hand, to the default.
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
      // A blocked storage still gets the in-memory state; only the reload is lost.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Nothing to undo — the entry that could not be removed is unreadable anyway.
    }
  },
};

type SidebarStore = SidebarState & {
  toggleSidebar: () => void;
  openSidebar: () => void;
  setSidebarWidth: (width: number) => void;
};

/// `skipHydration` because the server has no `localStorage`: rehydrating at
/// module evaluation would put the stored width into the first client render and
/// mismatch the HTML the server sent. `project-workspace.tsx` rehydrates in an
/// effect instead, which gives the sequence the old external store gave —
/// default, then stored, one re-render, no mismatch.
export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set, get) => ({
      ...SIDEBAR_DEFAULT_STATE,
      toggleSidebar: () => set({ isOpen: !get().isOpen }),
      /// The sidebar holds the properties panel, so anything outside it that
      /// opens a reference's properties has to make sure there is a column to
      /// open them in — a collapsed sidebar renders no strip and therefore no
      /// panel.
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
