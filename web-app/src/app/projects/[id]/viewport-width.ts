"use client";

import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

/// The server has no window, so the snapshot there is 0 — every consumer has to
/// treat an unmeasured width as "not known yet" rather than as a real value.
export function useViewportWidth() {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    () => 0,
  );
}
