"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { libraryFingerprint, type LibraryItem } from "@/lib/scene/moodboard-library";
import type { LibraryItems } from "@excalidraw/excalidraw/types";

const LIBRARY_SAVE_DELAY = 600;

export function useBoardLibrary({
  projectId,
  items,
}: {
  projectId: string;
  items: readonly LibraryItem[];
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const stored = useRef(libraryFingerprint(items));
  const latest = useRef<LibraryItems | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const saveAgain = useRef<() => void>(undefined);
  const [failed, setFailed] = useState(false);

  const save = useCallback(() => {
    timer.current = null;
    const outgoing = latest.current;
    if (!outgoing || saving.current) return;

    const fingerprint = libraryFingerprint(outgoing);
    if (fingerprint === stored.current) return;

    saving.current = true;
    let saved = false;
    void client.moodboard.saveLibrary
      .mutate({ projectId, items: outgoing as unknown as unknown[] })
      .then(() => {
        saved = true;
        stored.current = fingerprint;
        setFailed(false);
        void queryClient.invalidateQueries({
          queryKey: trpc.moodboard.library.queryOptions({ projectId }).queryKey,
        });
      })
      .catch(() => setFailed(true))
      .finally(() => {
        saving.current = false;
        if (saved) saveAgain.current?.();
      });
  }, [client, projectId, queryClient, trpc]);

  useEffect(() => {
    saveAgain.current = save;
  }, [save]);

  const onLibraryChange = useCallback(
    (changed: LibraryItems) => {
      latest.current = changed;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, LIBRARY_SAVE_DELAY);
    },
    [save],
  );

  const flush = useRef<() => void>(undefined);
  useEffect(() => {
    flush.current = save;
  }, [save]);

  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      flush.current?.();
    },
    [],
  );

  const retryLibrarySave = useCallback(() => {
    setFailed(false);
    save();
  }, [save]);

  return { onLibraryChange, librarySaveFailed: failed, retryLibrarySave };
}
