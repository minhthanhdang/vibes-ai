"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { useBoardReloads } from "../../stores/use-board-reload-store";

export function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center rounded-xl border border-dashed border-current/15 text-sm opacity-60">
      {children}
    </div>
  );
}

/// The editor is 1.5 MB of canvas code that cannot render on the server — it
/// reaches for `window` on import — so the whole canvas module is loaded only
/// once a board is on screen. Deferred here rather than inside the canvas so
/// that module can reach for excalidraw's coordinate and element helpers
/// directly: a static import of those from a file the page always loads would
/// pull the editor back into the first payload.
const DesignCanvas = dynamic(
  async () => (await import("./design-canvas")).DesignCanvas,
  { ssr: false, loading: () => <Placeholder>Loading canvas…</Placeholder> },
);

/// The board's scene, fetched once and handed to the editor as its initial
/// document. Not refetched on focus or on mount: excalidraw owns the scene from
/// the moment it mounts, so a background refetch replacing `data` under it
/// would be a silent revert of whatever the user has drawn since.
export function BoardScene({
  projectId,
  boardId,
  saveGateRef,
}: {
  projectId: string;
  boardId: string;
  saveGateRef: React.RefObject<(() => Promise<void>) | null>;
}) {
  const trpc = useTRPC();
  const [reloads, setReloads] = useState(0);
  const { data, error, refetch } = useQuery(
    trpc.moodboard.scene.queryOptions(
      { id: boardId },
      { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false },
    ),
  );

  /// The element library belongs to the project, so it outlives this board and
  /// is fetched beside the scene rather than with it. Pinned for the same reason
  /// the scene is: excalidraw owns the library from the moment it mounts, and it
  /// is only refetched by a save of our own, which the mounted editor ignores.
  const { data: library, error: libraryError } = useQuery(
    trpc.moodboard.library.queryOptions(
      { projectId },
      { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false },
    ),
  );

  /// Remounting is the point: the editor is initialised from a document, so
  /// the only way to show a newer one is to give it a new instance.
  const reload = useCallback(async () => {
    await refetch();
    setReloads((count) => count + 1);
  }, [refetch]);

  /// And the other caller: something in this browser has written to the board
  /// on screen and wants it seen — a Vibes run filling its pages in
  /// (`compositor-v2.md` §IX.2). The save gate runs first, because a remount
  /// discards whatever the editor has not sent yet, and the user may have been
  /// drawing on page one while page four was being designed.
  ///
  /// Only on a *change* of the count: a request made against this board before
  /// this instance mounted has already been served by the fetch that mounted it.
  const asked = useBoardReloads(boardId);
  const served = useRef(asked);
  useEffect(() => {
    if (asked === served.current) return;
    served.current = asked;
    void (async () => {
      await saveGateRef.current?.();
      await reload();
    })();
  }, [asked, reload, saveGateRef]);

  if (error || libraryError) return <Placeholder>Could not open this board.</Placeholder>;
  if (!data || !library) return <Placeholder>Opening board…</Placeholder>;

  return (
    <DesignCanvas
      key={`${boardId}:${reloads}`}
      projectId={projectId}
      scene={data}
      library={library}
      onReload={reload}
      saveGateRef={saveGateRef}
    />
  );
}