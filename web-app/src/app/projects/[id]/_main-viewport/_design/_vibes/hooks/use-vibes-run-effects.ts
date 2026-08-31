"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import type { VibesBoardProgress } from "@/lib/vibes/vibes-batch";
import { reloadBoard } from "../../stores/use-board-reload-store";
import {
  holdBoard,
  releaseBoard,
} from "../../../../_workspace/stores/use-board-hold-store";

const VIBES_POLL_MS = 4000;

const NO_BOARDS: VibesBoardProgress[] = [];

export function useVibesRunEffects(projectId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data } = useQuery(
    trpc.vibes.activeRuns.queryOptions(
      { projectId },
      {
        refetchInterval: (query) =>
          (query.state.data?.boards.length ?? 0) > 0 ? VIBES_POLL_MS : false,
      },
    ),
  );
  const boards = data?.boards ?? NO_BOARDS;

  const settledBefore = useRef(new Map<string, number>());
  const heldLive = useRef(new Set<string>());
  useEffect(() => {
    const before = settledBefore.current;
    const seen = new Set<string>();
    for (const board of boards) {
      seen.add(board.boardId);
      const prior = before.get(board.boardId) ?? 0;
      if (board.settled > prior) {
        reloadBoard(board.boardId);
      }
      before.set(board.boardId, board.settled);
    }
    for (const boardId of [...before.keys()]) if (!seen.has(boardId)) before.delete(boardId);

    const liveNow = new Set(boards.filter((board) => board.live).map((board) => board.boardId));
    for (const boardId of liveNow) if (!heldLive.current.has(boardId)) holdBoard(boardId);
    let ended = false;
    for (const boardId of heldLive.current) {
      if (!liveNow.has(boardId)) {
        releaseBoard(boardId);
        ended = true;
      }
    }
    heldLive.current = liveNow;

    if (ended) {
      void queryClient.invalidateQueries({
        queryKey: trpc.moodboard.listByProject.queryKey({ projectId }),
      });
      void queryClient.invalidateQueries({ queryKey: trpc.vibes.offer.queryKey() });
    }
  }, [boards, projectId, queryClient, trpc]);

  useEffect(
    () => () => {
      for (const boardId of heldLive.current) releaseBoard(boardId);
      heldLive.current = new Set();
    },
    [],
  );
}
