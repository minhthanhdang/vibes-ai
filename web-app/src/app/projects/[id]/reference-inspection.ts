"use client";

import { useSyncExternalStore } from "react";

/// Which reference the properties panel is open on, published for whatever asked
/// for it.
///
/// The panel is rendered by the sidebar's reference strip, and the gallery grid
/// is in the other column — the same split `board-placement.ts` crosses, and the
/// same answer: a prop would have to be threaded through the workspace and two
/// components that have no other reason to know about each other.
///
/// The gallery needs to be able to open it because a frame's crops are shown
/// only there. The grid says how many a photo has; this is the way from that
/// number to the list it counts.
const listeners = new Set<() => void>();
let inspectedId: string | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readInspected() {
  return inspectedId;
}

export function inspectReference(id: string | null) {
  if (inspectedId === id) return;
  inspectedId = id;
  for (const listener of listeners) listener();
}

export function useInspectedReference() {
  return useSyncExternalStore(subscribe, readInspected, () => null);
}
