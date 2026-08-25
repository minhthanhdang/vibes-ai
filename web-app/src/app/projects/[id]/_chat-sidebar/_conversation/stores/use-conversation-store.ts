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
import { mintChat } from "./use-chat-log-store";

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

/// The same array for a project that has minted nothing, or the selector below
/// hands the container a new one on every render.
const NONE: readonly string[] = [];

type ConversationState = {
  open: OpenConversations;
  /// The threads this browser has minted and may not have spoken in yet
  /// (§VII.3). "New chat" writes no row, so a minted id is in no list — and
  /// without this the column would jump straight off it the moment the list
  /// landed. The newest is also the fallback for a project with nothing to open
  /// at all.
  ///
  /// Kept out of `partialize`, so it does not survive a reload — and that is
  /// right: an empty chat is not worth restoring, and pressing "New chat" again
  /// costs nothing.
  ///
  /// Keyed by project like the selection above, and for a sharper reason: an id
  /// minted here and then spoken in belongs to *that* project from the first
  /// message, and offering it as another project's fresh thread would open one
  /// project's conversation under another's brief.
  minted: Readonly<Record<string, readonly string[]>>;
  chooseConversation: (projectId: string, conversationId: string) => void;
  mintConversation: (projectId: string) => string;
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
      minted: {},
      chooseConversation: (projectId, conversationId) => {
        const next = withOpenConversation(get().open, projectId, conversationId);
        if (next === get().open) return;
        set({ open: next });
      },
      /// A thread born hydrated: there is nothing stored to fetch for it, and
      /// the log is told so here rather than by an effect in the column, so an
      /// id is never handed out before it is safe to open.
      mintConversation: (projectId) => {
        const id = crypto.randomUUID();
        mintChat(id);
        set((state) => ({
          minted: { ...state.minted, [projectId]: [...(state.minted[projectId] ?? NONE), id] },
        }));
        return id;
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

export function mintConversation(projectId: string) {
  return useConversationStore.getState().mintConversation(projectId);
}

export function useOpenConversation(projectId: string): string | null {
  return useConversationStore((state) => openConversationFor(state.open, projectId));
}

export function useMintedConversations(projectId: string): readonly string[] {
  return useConversationStore((state) => state.minted[projectId] ?? NONE);
}
