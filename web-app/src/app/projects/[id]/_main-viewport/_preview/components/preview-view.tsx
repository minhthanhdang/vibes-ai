"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { activeBoardId } from "@/lib/scene/moodboard-boards";
import { boardPages } from "@/lib/pages/board-pages";
import { orderedPages } from "@/lib/pages/page-order";
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
      {/* Positioned, not stretched, for the reason `design-view.tsx` gives:
          the carousel sizes its slides from its container, and a flex basis is
          not a height a percentage can resolve against. */}
      <div className="relative min-h-0 flex-1">
        {activeId ? (
          /* Keyed so switching boards starts over on slide 1 (§III.4). */
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
  const { data: scene, refetch } = useQuery(
    trpc.moodboard.scene.queryOptions(
      { id: boardId },
      { staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: "always" },
    ),
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
      <PageCarousel scene={scene} pages={pages} />
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
