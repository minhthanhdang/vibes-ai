"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { libraryFingerprint, type LibraryItem } from "@/lib/scene/moodboard-library";
import type { LibraryItems } from "@excalidraw/excalidraw/types";

/// Excalidraw's element library is in-memory: the editor keeps the items, hands
/// the whole list to `onLibraryChange` after every change, and forgets it when
/// the tab closes. Persisting it is the host app's job — without this, "Add to
/// library" is a button whose result survives until the next reload, which is
/// the same silent loss a pasted image had before adoption.
///
/// One save per change would write on every open, because mounting the editor
/// with stored items fires the same callback. The fingerprint is what makes a
/// save mean "the director changed the library".

/// Long enough to collect a drag-reorder or a multi-item import into one write,
/// short enough that closing the tab straight after adding an item is not a
/// race. Library changes are deliberate and occasional, unlike the scene's
/// per-frame stream.
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

  /// What the server holds, as the value a change is compared against.
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
        /// A new item can name a reference the cached library has no file entry
        /// for, and the next board opened is initialised from that cache — so
        /// without this the item's preview would be a blank tile until reload.
        void queryClient.invalidateQueries({
          queryKey: trpc.moodboard.library.queryOptions({ projectId }).queryKey,
        });
      })
      /// Counted, not swallowed: the item is in the panel and gone after a
      /// reload, and nothing else on screen would say so.
      .catch(() => setFailed(true))
      .finally(() => {
        saving.current = false;
        /// Only after a save that landed — a failed one would otherwise retry
        /// itself forever against a server that is refusing it.
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

  /// Switching boards unmounts the editor mid-debounce; the item the director
  /// just saved has to be written rather than dropped. The request outlives the
  /// component on purpose.
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
