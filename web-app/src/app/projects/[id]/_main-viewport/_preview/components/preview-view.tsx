"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { activeBoardId } from "@/lib/scene/moodboard-boards";
import { boardPages } from "@/lib/pages/board-pages";
import { moveInOrder, orderedPages } from "@/lib/pages/page-order";
import {
  boardOpened,
  openBoard,
  useOpenBoardStore,
} from "../../../_workspace/stores/use-open-board-store";
import { useBoardReloads } from "../../_design/stores/use-board-reload-store";
import { PageCarousel } from "./page-carousel";
import { BoardStrip } from "./board-strip";
import { DeckExportPanel } from "./deck-export-panel";

function resumedDeckBoardId(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const boardId = url.searchParams.get("deck");
  if (!boardId) return null;
  url.searchParams.delete("deck");
  window.history.replaceState(null, "", url.toString());
  return boardId;
}

export function PreviewView({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const { data: boards, isPending } = useQuery(trpc.moodboard.listByProject.queryOptions({ projectId }));

  const [resumed] = useState(resumedDeckBoardId);
  useEffect(() => {
    if (resumed) openBoard(resumed);
  }, [resumed]);

  const requestedId = useOpenBoardStore((state) => state.requestedId);
  const openId = useOpenBoardStore((state) => state.openId);
  const activeId = activeBoardId(boards, requestedId ?? openId);

  useEffect(() => boardOpened(activeId), [activeId]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        {activeId ? (
          <BoardPreview key={activeId} boardId={activeId} resumeDeck={activeId === resumed} />
        ) : (
          <PreviewNotice>
            {isPending ? "Loading boards…" : "No boards yet — make one in Design."}
          </PreviewNotice>
        )}
      </div>

      <BoardStrip boards={boards} activeId={activeId} onOpen={openBoard} />
    </div>
  );
}

function BoardPreview({ boardId, resumeDeck }: { boardId: string; resumeDeck: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(resumeDeck);
  const { data: scene, refetch } = useQuery(
    trpc.moodboard.scene.queryOptions(
      { id: boardId },
      { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: "always" },
    ),
  );
  const sceneKey = trpc.moodboard.scene.queryOptions({ id: boardId }).queryKey;

  const reorder = useMutation(
    trpc.moodboard.setPreviewOrder.mutationOptions({
      onMutate: async ({ order }) => {
        await queryClient.cancelQueries({ queryKey: sceneKey });
        const previous = queryClient.getQueryData(sceneKey);
        queryClient.setQueryData(sceneKey, (current) =>
          current ? { ...current, previewOrder: order } : current,
        );
        return { previous };
      },
      onError: (_error, _input, snapshot) => {
        if (snapshot?.previous) queryClient.setQueryData(sceneKey, snapshot.previous);
      },
      onSuccess: ({ order }) => {
        queryClient.setQueryData(sceneKey, (current) =>
          current ? { ...current, previewOrder: order } : current,
        );
      },
    }),
  );

  const reloads = useBoardReloads(boardId);
  const served = useRef(reloads);
  useEffect(() => {
    if (served.current === reloads) return;
    served.current = reloads;
    void refetch();
  }, [reloads, refetch]);

  const pages = useMemo(
    () => (scene ? orderedPages(boardPages(scene.elements), scene.previewOrder) : []),
    [scene],
  );

  if (!scene) return <PreviewNotice>Loading board…</PreviewNotice>;
  if (pages.length === 0) return <PreviewNotice>No pages on this board yet.</PreviewNotice>;
  return (
    <div className="absolute inset-0">
      <PageCarousel
        scene={scene}
        pages={pages}
        onReorder={(from, to) =>
          reorder.mutate({ id: boardId, order: moveInOrder(pages.map(({ id }) => id), from, to) })
        }
      />

      <button
        type="button"
        onClick={() => setExporting(true)}
        className="absolute top-3 right-3 z-10 h-8 rounded-lg border border-[var(--default-border-color)] bg-[var(--island-bg-color)] px-3 text-xs text-[var(--text-primary-color)] shadow-sm hover:bg-[var(--button-hover-bg)]"
      >
        Export
      </button>

      <DeckExportPanel
        scene={scene}
        pages={pages}
        open={exporting}
        autoStart={resumeDeck}
        onClose={() => setExporting(false)}
      />
    </div>
  );
}

function PreviewNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-sm opacity-60">
      {children}
    </div>
  );
}
