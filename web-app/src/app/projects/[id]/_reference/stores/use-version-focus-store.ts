"use client";

import { create } from "zustand";

type VersionFocus = { frameId: string; versionId: string };

type VersionFocusState = {
  focused: VersionFocus | null;
  focusVersion: (focus: VersionFocus | null) => void;
};

export const useVersionFocusStore = create<VersionFocusState>()((set) => ({
  focused: null,
  focusVersion: (focus) => set({ focused: focus }),
}));

export function focusVersion(focus: VersionFocus | null) {
  useVersionFocusStore.getState().focusVersion(focus);
}

export function useFocusedVersion(frameId: string) {
  return useVersionFocusStore((state) =>
    state.focused?.frameId === frameId ? state.focused.versionId : null,
  );
}

export function takeVersionFocus() {
  if (!useVersionFocusStore.getState().focused) return;
  useVersionFocusStore.setState({ focused: null });
}
