"use client";

import { useSyncExternalStore } from "react";
import {
  SIDEBAR_DEFAULT_STATE,
  clampSidebarWidth,
  parseSidebarState,
  serializeSidebarState,
  type SidebarState,
} from "@/lib/ui/sidebar";

const STORAGE_KEY = "director-assistant:sidebar";

const listeners = new Set<() => void>();
let state = SIDEBAR_DEFAULT_STATE;
let storedRaw: string | null | undefined;

/// An external store rather than useState + an effect: the server has no
/// localStorage, so the stored width can only be read after hydration, and
/// useSyncExternalStore is the one way to do that without either a hydration
/// mismatch or a setState inside an effect (this project's eslint forbids it).
function readState(): SidebarState {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return state;
  }
  // The same object has to come back until the value actually changes, or
  // useSyncExternalStore re-renders on every check.
  if (raw !== storedRaw) {
    storedRaw = raw;
    state = parseSidebarState(raw);
  }
  return state;
}

function writeState(next: SidebarState, persist: boolean) {
  state = next;
  if (persist) {
    storedRaw = serializeSidebarState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, storedRaw);
    } catch {
      // A blocked storage still gets the in-memory state; only the reload is lost.
    }
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toggleSidebar() {
  writeState({ ...state, isOpen: !state.isOpen }, true);
}

/// The sidebar holds the properties panel, so anything outside it that opens a
/// reference's properties has to make sure there is a column to open them in —
/// a collapsed sidebar renders no strip and therefore no panel.
export function openSidebar() {
  if (!state.isOpen) writeState({ ...state, isOpen: true }, true);
}

/// A drag reports a width per pointer event; only the released width is worth a
/// synchronous localStorage write.
export function setSidebarWidth(width: number, { persist = true } = {}) {
  writeState({ ...state, width: clampSidebarWidth(width) }, persist);
}

export function useSidebarState() {
  return useSyncExternalStore(subscribe, readState, () => SIDEBAR_DEFAULT_STATE);
}
