"use client";

import { create } from "zustand";

type VibesDismissedState = { dismissed: ReadonlySet<string> };

export const useVibesDismissedStore = create<VibesDismissedState>()(() => ({
  dismissed: new Set<string>(),
}));

export function dismissVibesBoard(key: string) {
  useVibesDismissedStore.setState((state) => ({
    dismissed: new Set([...state.dismissed, key]),
  }));
}
