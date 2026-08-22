"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import {
  vibesLoop,
  vibesLoopNext,
  vibesLoopPages,
  vibesLoopProgress,
  vibesLoopSettled,
  vibesLoopStopped,
  type VibesLoop,
  type VibesPageOutcome,
  type VibesPageState,
} from "@/lib/vibes/vibes-loop";
import { reloadBoard } from "./board-reload";
import { onVibesRun } from "./vibes-run";

/// The loop that designs a Vibes board, and the only account of it the user has
/// while it runs (compositor-v2.md §IX.2).
///
/// Mounted in the workspace rather than beside the board: the run outlives the
/// editor the form was pressed in — the first thing `vibes.start` causes is the
/// panel opening the *new* board, which unmounts that editor — and it outlives
/// the switch to the references grid too. A loop in either place would stop on
/// its own first page, and the user would find a board of empty pages with
/// nothing saying why.
///
/// What runs here is the awaiting and nothing else. `vibes-loop.ts` holds which
/// page is next, what the last one came back with and the sentence being shown;
/// this file is the mutation call and the card.

/// A page that never answered — a dropped connection, a tab asleep, a request
/// the server never finished. To the run it is the same event as a refusal the
/// mutation returned: the page was not designed, the pages before it stand, and
/// the reason belongs on screen rather than in a console.
function refusal(error: unknown) {
  return error instanceof Error && error.message ? error.message : "the request did not finish";
}

const PIP: Record<VibesPageState, string> = {
  designed: "bg-current",
  designing: "animate-pulse bg-current/60",
  waiting: "bg-current/15",
  refused: "bg-red-500",
};

export function VibesRunPanel({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const [loop, setLoop] = useState<VibesLoop | null>(null);
  /// The loop the walk below reads between pages, which is what makes Stop
  /// mean something: a press writes here and the next turn of the walk sees it.
  /// React state alone would be a snapshot the running function closed over
  /// before the button existed.
  const held = useRef<VibesLoop | null>(null);
  const walking = useRef(false);

  const hold = useCallback((next: VibesLoop) => {
    held.current = next;
    setLoop(next);
  }, []);

  const walk = useCallback(async () => {
    /// One walk at a time. A run started while another is going is picked up by
    /// the walk already running, because it reads the held loop each turn — two
    /// walks would be two pages designed at once, which is the one thing the
    /// sequential decision rules out.
    if (walking.current) return;
    walking.current = true;
    try {
      for (;;) {
        const current = held.current;
        if (!current) return;
        const next = vibesLoopNext(current);
        if (!next) break;

        let outcome: VibesPageOutcome;
        try {
          outcome = await client.vibes.designPage.mutate({
            boardId: current.boardId,
            pageId: next.pageId,
            index: next.index,
          });
        } catch (error) {
          outcome = { pageId: next.pageId, error: refusal(error) };
        }

        /// The board on screen is now a page fuller than the document the editor
        /// was handed. Asked for before the state is settled so the page appears
        /// while the next one is already being designed.
        reloadBoard(current.boardId);
        hold(vibesLoopSettled(held.current ?? current, outcome));
      }

      /// The tab row's picture of the board, which is a render of a board that
      /// was empty when the run started.
      await queryClient.invalidateQueries({
        queryKey: trpc.moodboard.listByProject.queryKey({ projectId }),
      });
    } finally {
      walking.current = false;
    }
  }, [client, hold, projectId, queryClient, trpc]);

  useEffect(
    () =>
      onVibesRun((run) => {
        hold(vibesLoop(run));
        void walk();
      }),
    [hold, walk],
  );

  if (!loop) return null;

  const progress = vibesLoopProgress(loop);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-30 flex w-72 flex-col gap-2 rounded-xl border border-current/10 bg-[var(--background)] p-3 text-[var(--foreground)] shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium">{loop.title}</span>
        {/* Only once nothing is in flight: a run put away while it is still
            designing is a loop with nothing on screen saying it is spending
            model calls. */}
        {progress.finished ? (
          <button
            type="button"
            onClick={() => setLoop(null)}
            aria-label="Dismiss"
            className="text-xs opacity-50 hover:opacity-100"
          >
            ×
          </button>
        ) : null}
      </div>

      {/* One mark per page of the ask, which is what `vibes.start` made up
          front — the user watches known pages fill in rather than a bar
          guessing at how much is left. */}
      <div className="flex gap-1">
        {vibesLoopPages(loop).map((page) => (
          <span
            key={page.index}
            title={`Page ${page.index + 1}`}
            className={`h-1.5 flex-1 rounded-full ${PIP[page.state]}`}
          />
        ))}
      </div>

      <p className={`text-[11px] ${progress.refusal ? "text-red-500" : "opacity-70"}`}>
        {progress.label}
      </p>

      {progress.running ? (
        <button
          type="button"
          onClick={() => hold(vibesLoopStopped(held.current ?? loop))}
          /// The page in flight finishes — a mutation has no abort that reaches
          /// the model — so this is "no more pages", and the button says so
          /// rather than promising a stop it cannot make.
          title="The page being designed finishes; no more are started"
          className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:border-current/50"
        >
          Stop after this page
        </button>
      ) : null}
    </div>
  );
}
