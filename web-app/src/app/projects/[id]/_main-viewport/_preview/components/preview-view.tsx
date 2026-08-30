"use client";

import { useEffect, useMemo, useRef } from "react";
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

/// The Preview tab (PRD §III): the open board's pages as a slide carousel, a
/// board-picker strip along the bottom.
///
/// Board selection is Design's, through the same store — one selection, two
/// views of it (§III.1). Picking a board here files it as `requestedId`, the
/// same request the chat's board tiles make, so switching back to Design opens
/// on it; and the settled board is announced back as `openId` exactly the way
/// `design-view.tsx` does, so the chat's page picker and the next mount of
/// either view keep pointing at the board being looked at.
export function PreviewView({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const { data: boards, isPending } = useQuery(trpc.moodboard.listByProject.queryOptions({ projectId }));

  const requestedId = useOpenBoardStore((state) => state.requestedId);
  const openId = useOpenBoardStore((state) => state.openId);
  const activeId = activeBoardId(boards, requestedId ?? openId);

  useEffect(() => boardOpened(activeId), [activeId]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        {activeId ? (
          <BoardPreview key={activeId} boardId={activeId} />
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

/// One board's slides, off its stored scene. Unlike the editor's pinned copy,
/// this re-reads on every mount: nothing here owns the scene, and the board was
/// very possibly just edited in the tab the user switched away from.
function BoardPreview({ boardId }: { boardId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: scene, refetch } = useQuery(
    trpc.moodboard.scene.queryOptions(
      { id: boardId },
      { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: "always" },
    ),
  );
  const sceneKey = trpc.moodboard.scene.queryOptions({ id: boardId }).queryKey;

  /// Optimistic (§III.6): the rail and the carousel reorder on the click, and
  /// only an error puts the old order back. Settling is `setQueryData` off the
  /// echoed column rather than an invalidation — the write touched neither
  /// elements nor files, and a scene refetch over it would be paying for the
  /// whole board to confirm a list of ids.
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

  /// The same request `board-scene.tsx` serves: something outside this tab — a
  /// Vibes settle, a chat turn — wrote to the board and asked for a re-read.
  /// Compared against what was served rather than acted on at mount, because
  /// the counter may have been raised long before Preview was opened.
  const reloads = useBoardReloads(boardId);
  const served = useRef(reloads);
  useEffect(() => {
    if (served.current === reloads) return;
    served.current = reloads;
    void refetch();
  }, [reloads, refetch]);

  /// Memoised because the bitmaps hook keys an effect on this list — a fresh
  /// array per render would re-run it forever.
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
        /// The full explicit list is written on every move (§III.5): pages
        /// added later then land after the arrangement, not interleaved.
        onReorder={(from, to) =>
          reorder.mutate({ id: boardId, order: moveInOrder(pages.map(({ id }) => id), from, to) })
        }
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
