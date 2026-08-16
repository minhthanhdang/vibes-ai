"use client";

import { useRef, useState } from "react";

/// A file the browser is still uploading. The gallery renders one placeholder
/// tile per entry, so the director sees a dropped batch immediately instead of
/// after the first signed PUT and database write have both come back.
export type PendingUpload = { pendingKey: string; file: File; previewUrl?: string };

export function usePendingUploads() {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const nextKey = useRef(0);

  /// Called from an event handler, never during render — which is also why the
  /// preview URL is minted here and not in the tile: a handler runs exactly
  /// once, where a render or an effect can run twice and leak the extra URL.
  function start(files: File[]) {
    const entries = files.map((file) => ({
      pendingKey: `pending-${nextKey.current++}`,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setPending((current) => [...current, ...entries]);
    return entries;
  }

  function finish(entry: PendingUpload) {
    setPending((current) => current.filter((candidate) => candidate.pendingKey !== entry.pendingKey));
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  }

  return { pending, start, finish };
}
