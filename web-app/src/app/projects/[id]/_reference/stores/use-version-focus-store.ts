"use client";

import { create } from "zustand";

/// Which cut the properties panel is being sent to, when what was clicked is a
/// version rather than a photograph.
///
/// `use-inspection-store.ts` opens the frame, and that is as far as an id gets:
/// a version has no tile and no panel of its own — it is a row in the list under
/// its frame — so pointing at one from outside takes a second fact. tech-spec
/// §IV asks for exactly that, the original's properties "with that version
/// highlighted", and this is the fact.
///
/// It carries the frame as well as the cut, because every mounted versions list
/// reads the same store and only the one showing the right frame may take it.
///
/// Taken once. The list clears it the moment it has scrolled to the row, so a
/// user who walks away and opens the frame again an hour later is not
/// dragged back to a cut they already read.
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

/// The cut waiting on *this* frame, or null.
export function useFocusedVersion(frameId: string) {
  return useVersionFocusStore((state) =>
    state.focused?.frameId === frameId ? state.focused.versionId : null,
  );
}

export function takeVersionFocus() {
  if (!useVersionFocusStore.getState().focused) return;
  useVersionFocusStore.setState({ focused: null });
}
