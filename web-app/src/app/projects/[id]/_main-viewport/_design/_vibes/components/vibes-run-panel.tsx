"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import type { VibesBoardProgress, VibesPageState } from "@/lib/vibes/vibes-batch";
import { vibesResumeOffer } from "@/lib/vibes/vibes-resume";
import { reloadBoard } from "../../stores/use-board-reload-store";
import {
  holdBoard,
  releaseBoard,
} from "../../../../_workspace/stores/use-board-hold-store";
import { useOpenBoardStore } from "../../../../_workspace/stores/use-open-board-store";

const VIBES_POLL_MS = 4000;

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-30 flex w-72 flex-col gap-2 rounded-xl border border-current/10 bg-[var(--background)] p-3 text-[var(--foreground)] shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
    >
      {children}
    </div>
  );
}

const PIP: Record<VibesPageState, string> = {
  designed: "bg-current",
  designing: "animate-pulse bg-current/60",
  waiting: "bg-current/15",
  refused: "bg-red-500",
  empty: "bg-amber-500/70",
};

const SAYS: Partial<Record<VibesPageState, string>> = {
  refused: " — not designed",
  empty: " — still empty",
};

const NO_BOARDS: VibesBoardProgress[] = [];

export function VibesRunPanel({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const openBoardId = useOpenBoardStore((state) => state.openId);

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

  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const ending = (board: VibesBoardProgress) => `${board.boardId}@${board.settled}`;
  const shown = boards.filter((board) => board.live || !dismissed.has(ending(board)));

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

  const { data: run } = useQuery(
    trpc.vibes.offer.queryOptions(
      { boardId: openBoardId ?? "" },
      {
        enabled:
          openBoardId !== null && !shown.some((board) => board.boardId === openBoardId),
      },
    ),
  );
  const offer = run ? vibesResumeOffer(run.pages) : null;

  const resume = useMutation(
    trpc.vibes.resume.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.vibes.activeRuns.queryKey() });
        await queryClient.invalidateQueries({ queryKey: trpc.vibes.offer.queryKey() });
      },
    }),
  );
  const stop = useMutation(
    trpc.vibes.stop.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.vibes.activeRuns.queryKey() });
      },
    }),
  );

  if (shown.length === 0)
    return run && offer ? (
      <Card>
        <span className="truncate text-xs font-medium">{run.title}</span>
        <p className="text-[11px] opacity-70">{offer.label}</p>
        {resume.error ? (
          <p className="text-[11px] text-red-500">{resume.error.message}</p>
        ) : null}
        <button
          type="button"
          onClick={() => resume.mutate({ boardId: run.boardId })}
          disabled={resume.isPending}
          className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:border-current/50 disabled:opacity-50"
        >
          {offer.action}
        </button>
      </Card>
    ) : null;

  return (
    <Card>
      {shown.map((board) => (
        <div key={board.boardId} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-medium">{board.title}</span>
            {!board.live ? (
              <button
                type="button"
                onClick={() => setDismissed((held) => new Set([...held, ending(board)]))}
                aria-label="Dismiss"
                className="text-xs opacity-50 hover:opacity-100"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="flex gap-1">
            {board.pages.map((page) => (
              <span
                key={page.index}
                title={`Page ${page.index + 1}${SAYS[page.state] ?? ""}`}
                className={`h-1.5 flex-1 rounded-full ${PIP[page.state]}`}
              />
            ))}
          </div>

          <p className={`text-[11px] ${board.refusal ? "text-red-500" : "opacity-70"}`}>
            {board.label}
          </p>

          {board.live ? (
            <button
              type="button"
              onClick={() => stop.mutate({ boardId: board.boardId })}
              disabled={stop.isPending}
              title="The page being designed finishes; no more are started"
              className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:border-current/50 disabled:opacity-50"
            >
              Stop after this page
            </button>
          ) : null}
        </div>
      ))}
    </Card>
  );
}
