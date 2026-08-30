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
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
    }
  },
};

const NONE: readonly string[] = [];

type ConversationState = {
  open: OpenConversations;
  minted: Readonly<Record<string, readonly string[]>>;
  chooseConversation: (projectId: string, conversationId: string) => void;
  mintConversation: (projectId: string) => string;
};

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

export function adoptMintedConversation(projectId: string, conversationId: string) {
  const state = useConversationStore.getState();
  if (state.minted[projectId]?.length) return;
  mintChat(conversationId);
  useConversationStore.setState({
    minted: { ...state.minted, [projectId]: [conversationId] },
  });
}

export function useOpenConversation(projectId: string): string | null {
  return useConversationStore((state) => openConversationFor(state.open, projectId));
}

export function useMintedConversations(projectId: string): readonly string[] {
  return useConversationStore((state) => state.minted[projectId] ?? NONE);
}
