"use client";

import { create } from "zustand";
import type { PendingUpload } from "../types";

type PendingUploadsState = {
  pending: readonly PendingUpload[];
  nextKey: number;
  start: (files: File[]) => PendingUpload[];
  finish: (entry: PendingUpload) => void;
};

export const usePendingUploadsStore = create<PendingUploadsState>()((set, get) => ({
  pending: [],
  nextKey: 0,
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
