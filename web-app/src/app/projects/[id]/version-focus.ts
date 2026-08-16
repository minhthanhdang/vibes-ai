"use client";

import { useSyncExternalStore } from "react";

/// Which cut the properties panel is being sent to, when what was clicked is a
/// version rather than a photograph.
///
/// `reference-inspection.ts` opens the frame, and that is as far as an id gets:
/// a version has no tile and no panel of its own — it is a row in the list under
/// its frame — so pointing at one from outside takes a second fact. tech-spec
/// §IV asks for exactly that, the original's properties "with that version
/// highlighted", and this is the fact.
///
/// It carries the frame as well as the cut, because every mounted versions list
/// reads the same store and only the one showing the right frame may take it —
/// the same rule `crop-offer.ts` follows, for the same reason.
///
/// Taken once. The list clears it the moment it has scrolled to the row, so a
/// director who walks away and opens the frame again an hour later is not
/// dragged back to a cut they already read.
const listeners = new Set<() => void>();
let focused: { frameId: string; versionId: string } | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readFocused() {
  return focused;
}

export function focusVersion(focus: { frameId: string; versionId: string } | null) {
  if (focused === focus) return;
  focused = focus;
  for (const listener of listeners) listener();
}

/// The cut waiting on *this* frame, or null.
export function useFocusedVersion(frameId: string) {
  const current = useSyncExternalStore(subscribe, readFocused, () => null);
  return current?.frameId === frameId ? current.versionId : null;
}

export function takeVersionFocus() {
  if (!focused) return;
  focused = null;
  for (const listener of listeners) listener();
}
