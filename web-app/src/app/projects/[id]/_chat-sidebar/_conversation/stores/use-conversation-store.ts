"use client";

import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import {
  NO_OPEN_CONVERSATIONS,
  openConversationFor,
  parseOpenConversations,
  serializeOpenConversations,
  withOpenConversation,
  type OpenConversations,
} from "@/lib/ui/open-conversation";

const STORAGE_KEY = "director-assistant:open-conversation";

/// Which thread each project is open on, persisted — the house's persisted-store
/// split, exactly as `use-sidebar-store.ts` sits beside `sidebar.ts`
/// (orchestrator-tool-reference §VII.2).
///
/// **Nothing subscribes to the `storage` event, and that is the design.**
/// `localStorage` is shared across every tab of one origin, so a second tab
/// choosing a thread writes into the same entry this one reads — listening for
/// it would swap this window's column out from under a half-written message.
/// Read at mount, written on every choice, and never told about anyone else's.
/// `persist` does not listen for it either, so nothing has to be turned off.
///
/// The stored shape is the one `@/lib/ui/open-conversation` already reads and
/// writes rather than `persist`'s `{state,version}` envelope, so a browser
/// holding a selection from before this store existed still opens on it.
const storage: PersistStorage<{ open: OpenConversations }> = {
  getItem: (name) => {
    try {
      return { state: { open: parseOpenConversations(window.localStorage.getItem(name)) } };
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, serializeOpenConversations(value.state.open));
    } catch {
      /// A blocked storage still gets the in-memory selection; only the reload is
      /// lost, and a reload landing on the most recent thread is the fallback
      /// this feature already has.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      /// Nothing to undo — an entry that cannot be removed cannot be read either.
    }
  },
};

type ConversationState = {
  open: OpenConversations;
  chooseConversation: (projectId: string, conversationId: string) => void;
};

/// `skipHydration` because the server has no `localStorage`: rehydrating at
/// module evaluation would put the stored selection into the first client render
/// and mismatch the HTML the server sent. The component that owns this store
/// rehydrates in an effect instead — default, then stored, one re-render, no
/// mismatch.
export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      open: NO_OPEN_CONVERSATIONS,
      chooseConversation: (projectId, conversationId) => {
        const next = withOpenConversation(get().open, projectId, conversationId);
        if (next === get().open) return;
        set({ open: next });
      },
    }),
    {
      name: STORAGE_KEY,
      storage,
      skipHydration: true,
      partialize: ({ open }) => ({ open }),
    },
  ),
);

export function chooseConversation(projectId: string, conversationId: string) {
  useConversationStore.getState().chooseConversation(projectId, conversationId);
}

export function useOpenConversation(projectId: string): string | null {
  return useConversationStore((state) => openConversationFor(state.open, projectId));
}
