"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import type { VibesBoardProgress, VibesPageState } from "@/lib/vibes/vibes-batch";
import { vibesResumeOffer } from "@/lib/vibes/vibes-resume";
import { vibesDismissKey, visibleVibesBoards } from "@/lib/vibes/vibes-panel";
import {
  dismissVibesBoard,
  useVibesDismissedStore,
} from "../stores/use-vibes-dismissed-store";
import { useOpenBoardStore } from "../../../../_workspace/stores/use-open-board-store";

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

  const { data } = useQuery(trpc.vibes.activeRuns.queryOptions({ projectId }));
  const boards = data?.boards ?? NO_BOARDS;

  const dismissed = useVibesDismissedStore((state) => state.dismissed);
  const shown = visibleVibesBoards(boards, dismissed);

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

  if (shown.length === 0) {
    if (!run || !offer) return <p className="text-[11px] opacity-45">No vibes run right now.</p>;

    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-0 flex-col gap-3 overflow-y-auto"
      >
        <div className="flex flex-col gap-2">
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
        </div>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      {shown.map((board) => (
        <div key={board.boardId} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-medium">{board.title}</span>
            {!board.live ? (
              <button
                type="button"
                onClick={() => dismissVibesBoard(vibesDismissKey(board))}
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
    </div>
  );
}
