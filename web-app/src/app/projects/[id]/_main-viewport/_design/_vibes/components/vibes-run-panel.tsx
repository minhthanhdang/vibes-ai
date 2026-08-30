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

/// The account the user has of a Vibes run while it runs — and no longer the
/// thing running it (multi-vibes-and-preview-prd §II.6). The worker claims and
/// settles the `VIBES` rows; this panel polls `vibes.activeRuns`, which reads
/// the same rows, so what is drawn and what is done cannot disagree. One card,
/// one section per board still walking or settled recently enough that the
/// ending is owed.
///
/// Mounted in the workspace rather than beside the board for the reason the
/// loop was: the first thing a run does is open the new board, which unmounts
/// the editor the form was pressed in, and the card must survive that — and
/// the switch to the references grid too.
///
/// **It sits under `_design/` and is mounted from `_workspace/`, and that
/// inversion is deliberate.** The panel belongs to the design surface —
/// `vibes-form.tsx` beside it is the button that starts it — but a panel
/// mounted inside `_design/` would be unmounted by the very first thing a run
/// does.

/// How often the queue is asked while cards are on screen. Polled rather than
/// streamed because nothing browser-side drives any more; while no card
/// exists, not at all — the form's submit and the offer's press invalidate the
/// query, which is how a new run gets its first tick.
const VIBES_POLL_MS = 4000;

/// One corner for both cards. The offer and the run are the same thing at two
/// moments — a board with pages still owed, before and during — so they stand
/// in the same place and never both at once.
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
  /// Neither designed nor failed: a page that answered and placed nothing
  /// (§IX.5). It reads as a gap rather than a fault, which is what it is — the
  /// resume offer picks it up the moment the card is put away.
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
        /// While any card is up — settled ones included, so a "Stopped" card
        /// leaves on its own as the window closes rather than lingering as a
        /// snapshot nothing refreshes.
        refetchInterval: (query) =>
          (query.state.data?.boards.length ?? 0) > 0 ? VIBES_POLL_MS : false,
      },
    ),
  );
  const boards = data?.boards ?? NO_BOARDS;

  /// Finished cards the user has put away — keyed by the ending they put
  /// away, not the board: a resumed run settles more pages, the key changes,
  /// and the new ending's card is never born hidden.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const ending = (board: VibesBoardProgress) => `${board.boardId}@${board.settled}`;
  const shown = boards.filter((board) => board.live || !dismissed.has(ending(board)));

  /// What each poll owes the rest of the app, off the numbers it brought back.
  /// The walk used to do all of this from inside the loop; now the settled
  /// count rising is the only signal there is, and it is enough.
  const settledBefore = useRef(new Map<string, number>());
  const heldLive = useRef(new Set<string>());
  useEffect(() => {
    const before = settledBefore.current;
    const seen = new Set<string>();
    for (const board of boards) {
      seen.add(board.boardId);
      const prior = before.get(board.boardId) ?? 0;
      if (board.settled > prior) {
        /// The board on screen is a page fuller than the document the editor
        /// was handed. A reload under a hold remounts into a still-held
        /// canvas, which is correct.
        reloadBoard(board.boardId);
      }
      before.set(board.boardId, board.settled);
    }
    /// A card that left the window and comes back later starts its count over,
    /// so the count kept about it must not outlive the card.
    for (const boardId of [...before.keys()]) if (!seen.has(boardId)) before.delete(boardId);

    /// A board the worker is writing to is a board the user must not edit —
    /// the hold the walk used to open around each mutation, now opened around
    /// the live rows the poll reports and dropped when they settle.
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

    /// A chain that just ended changed two answers read before it ran: the tab
    /// row's picture of the board, and whether the board still owes pages.
    if (ended) {
      void queryClient.invalidateQueries({
        queryKey: trpc.moodboard.listByProject.queryKey({ projectId }),
      });
      void queryClient.invalidateQueries({ queryKey: trpc.vibes.offer.queryKey() });
    }
  }, [boards, projectId, queryClient, trpc]);

  /// The holds this panel opened, dropped on its way out — a workspace
  /// unmounting mid-run must not leave the boards locked for the tab's life.
  useEffect(
    () => () => {
      for (const boardId of heldLive.current) releaseBoard(boardId);
      heldLive.current = new Set();
    },
    [],
  );

  /// The board on screen, asked whether it still owes pages (§IX.5) — only
  /// while it has no card, because a card is that question already answered. A
  /// board that was never a Vibes run answers `null`, which is most of them.
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
        /// The queue has a new head; the next read draws its card, which is
        /// also what puts this offer away.
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
              /// The page in flight finishes — nothing can abort a model call
              /// mid-flight — so this is "no more pages", and the button says
              /// so rather than promising a stop it cannot make.
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
