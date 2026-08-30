"use client";

import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

export function useViewportWidth() {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    () => 0,
  );
}
