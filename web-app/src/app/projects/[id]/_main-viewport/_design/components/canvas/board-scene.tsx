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

const DesignCanvas = dynamic(
  async () => (await import("./design-canvas")).DesignCanvas,
  { ssr: false, loading: () => <Placeholder>Loading canvas…</Placeholder> },
);

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

  const { data: library, error: libraryError } = useQuery(
    trpc.moodboard.library.queryOptions(
      { projectId },
      { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false },
    ),
  );

  const reload = useCallback(async () => {
    await refetch();
    setReloads((count) => count + 1);
  }, [refetch]);

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