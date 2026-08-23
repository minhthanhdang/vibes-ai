"use client";

import { useSyncExternalStore } from "react";
import {
  NO_OPEN_CONVERSATIONS,
  openConversationFor,
  parseOpenConversations,
  serializeOpenConversations,
  withOpenConversation,
  type OpenConversations,
} from "@/lib/ui/open-conversation";

const STORAGE_KEY = "director-assistant:open-conversation";

const listeners = new Set<() => void>();
let state = NO_OPEN_CONVERSATIONS;
let storedRaw: string | null | undefined;

/// Which thread each project is open on, persisted — the house's persisted-store
/// split, exactly as `sidebar-state.ts` sits beside `sidebar.ts`
/// (orchestrator-tool-reference §VII.2).
///
/// An external store rather than useState + an effect: the server has no
/// localStorage, so the stored selection can only be read after hydration, and
/// `useSyncExternalStore` is the one way to do that without either a hydration
/// mismatch or a setState inside an effect (this project's eslint forbids it).
///
/// **Nothing subscribes to the `storage` event, and that is the design.**
/// `localStorage` is shared across every tab of one origin, so a second tab
/// choosing a thread writes into the same entry this one reads — listening for
/// it would swap this window's column out from under a half-written message.
/// Read at mount, written on every choice, and never told about anyone else's.
function readState(): OpenConversations {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return state;
  }
  /// The same object has to come back until the value actually changes, or
  /// `useSyncExternalStore` re-renders on every check.
  if (raw !== storedRaw) {
    storedRaw = raw;
    state = parseOpenConversations(raw);
  }
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function chooseConversation(projectId: string, conversationId: string) {
  const next = withOpenConversation(state, projectId, conversationId);
  if (next === state) return;
  state = next;
  storedRaw = serializeOpenConversations(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, storedRaw);
  } catch {
    /// A blocked storage still gets the in-memory selection; only the reload is
    /// lost, and a reload landing on the most recent thread is the fallback
    /// this feature already has.
  }
  for (const listener of listeners) listener();
}

export function useOpenConversation(projectId: string): string | null {
  const open = useSyncExternalStore(subscribe, readState, () => NO_OPEN_CONVERSATIONS);
  return openConversationFor(open, projectId);
}
