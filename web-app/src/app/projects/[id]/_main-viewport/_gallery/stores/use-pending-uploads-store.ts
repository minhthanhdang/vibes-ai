"use client";

import { create } from "zustand";
import type { PendingUpload } from "../types";

/// The batch in flight, held where both halves of the gallery can see it.
///
/// The dropzone knows which files were dropped and the grid is what has to draw
/// them, and the two are siblings in different files — the workspace that used
/// to own the state between them has no other reason to know an upload is
/// happening.
type PendingUploadsState = {
  pending: readonly PendingUpload[];
  /// Counts rather than reads `pending.length`, so a key is never reused by a
  /// batch dropped while an earlier one is still finishing.
  nextKey: number;
  start: (files: File[]) => PendingUpload[];
  finish: (entry: PendingUpload) => void;
};

export const usePendingUploadsStore = create<PendingUploadsState>()((set, get) => ({
  pending: [],
  nextKey: 0,
  /// Called from an event handler, never during render — which is also why the
  /// preview URL is minted here and not in the tile: a handler runs exactly
  /// once, where a render or an effect can run twice and leak the extra URL.
  start: (files) => {
    const first = get().nextKey;
    const entries = files.map((file, index) => ({
      pendingKey: `pending-${first + index}`,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    set((state) => ({
      pending: [...state.pending, ...entries],
      nextKey: first + entries.length,
    }));
    return entries;
  },
  finish: (entry) => {
    set((state) => ({
      pending: state.pending.filter((candidate) => candidate.pendingKey !== entry.pendingKey),
    }));
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  },
}));

export function startUploads(files: File[]) {
  return usePendingUploadsStore.getState().start(files);
}

export function finishUpload(entry: PendingUpload) {
  usePendingUploadsStore.getState().finish(entry);
}
