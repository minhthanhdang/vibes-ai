"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import {
  vibesLoop,
  vibesLoopNext,
  vibesLoopPages,
  vibesLoopProgress,
  vibesLoopSettled,
  vibesLoopStopped,
  vibesLoopWatched,
  type VibesLoop,
  type VibesPageOutcome,
  type VibesPageState,
} from "@/lib/vibes/vibes-loop";
import { vibesResumeOffer } from "@/lib/vibes/vibes-resume";
import { reloadBoard } from "../../stores/use-board-reload-store";
import {
  holdBoard,
  releaseBoard,
} from "../../../../_workspace/stores/use-board-hold-store";
import { useOpenBoardStore } from "../../../../_workspace/stores/use-open-board-store";
import { announceVibesRun, onVibesRun } from "../../../../_events/vibes-run";
import { useChatCacheReset } from "../../../../_chat-sidebar/_conversation/hooks/use-chat-cache";

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
///
/// **It therefore sits under `_design/` and is mounted from `_workspace/`, and
/// that inversion is deliberate.** The panel belongs to the design surface —
/// `vibes-form.tsx` beside it is the button that starts it — but a panel
/// mounted inside `_design/` would be unmounted by the very first thing a run
/// does. Moving the mount down to "fix" the import direction breaks the loop.

/// A page that never answered — a dropped connection, a tab asleep, a request
/// the server never finished. To the run it is the same event as a refusal the
/// mutation returned: the page was not designed, the pages before it stand, and
/// the reason belongs on screen rather than in a console.
function refusal(error: unknown) {
  return error instanceof Error && error.message ? error.message : "the request did not finish";
}

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

/// How many of the page's steps the panel shows at once. Smaller than the chat
/// column's window because this card sits over the canvas and the run's own
/// sentence is the thing that must stay readable.
const VIBES_LIVE_STEPS = 3;

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

export function VibesRunPanel({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const resetChatCache = useChatCacheReset();

  const [loop, setLoop] = useState<VibesLoop | null>(null);
  const openBoardId = useOpenBoardStore((state) => state.openId);
  /// The loop the walk below reads between pages, which is what makes Stop
  /// mean something: a press writes here and the next turn of the walk sees it.
  /// React state alone would be a snapshot the running function closed over
  /// before the button existed.
  const held = useRef<VibesLoop | null>(null);
  const walking = useRef(false);

  /// The board on screen, asked whether it still owes pages (§IX.5). A closed
  /// tab stops a run and nothing on the server is watching for that, so the way
  /// a half-finished board gets finished is that opening it says so — and the
  /// question is only asked while nothing is running, because a live run is
  /// that question already answered. A board that was never a Vibes run answers
  /// `null`, which is most of them.
  const { data: run } = useQuery(
    trpc.vibes.resume.queryOptions(
      { boardId: openBoardId ?? "" },
      { enabled: openBoardId !== null && !loop },
    ),
  );
  const offer = run ? vibesResumeOffer(run.pages) : null;

  const hold = useCallback((next: VibesLoop) => {
    held.current = next;
    setLoop(next);
  }, []);

  /// The board this run is holding, so the user cannot edit a page agent 8 is
  /// laying out. The designer runs for the whole walk rather than per page, so
  /// the hold spans the run — but a run announced mid-walk is picked up by the
  /// walk already going and may name a different board, so what is held is
  /// tracked rather than assumed, and moved when the walk moves.
  const holding = useRef<string | null>(null);
  const holdOnly = useCallback((boardId: string | null) => {
    if (holding.current === boardId) return;
    if (holding.current) releaseBoard(holding.current);
    holding.current = boardId;
    if (boardId) holdBoard(boardId);
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
        holdOnly(current.boardId);

        let outcome: VibesPageOutcome | null = null;
        /// The run's thread, which only a page that *answered* can name — a
        /// request that never finished has no id to give back. Held beside the
        /// outcome rather than on it, because the loop's own type is about pages
        /// and knows nothing about conversations.
        let thread: string | null = null;
        try {
          const events = await client.vibes.designPage.mutate({
            boardId: current.boardId,
            pageId: next.pageId,
            index: next.index,
          });
          /// Drained to the end and never broken out of: `for await` on an
          /// abandoned iterator aborts the request the page is riding, and a
          /// page is two to three minutes the project has already paid for.
          for await (const event of events) {
            if (event.kind === "page") {
              thread = event.conversationId || null;
              outcome = event.outcome;
              continue;
            }
            hold(vibesLoopWatched(held.current ?? current, event));
          }
        } catch (error) {
          /// A stream that died after four rounds is the same event to the run
          /// as a mutation that never answered — the throw can now arrive
          /// mid-iteration rather than from the await, and it folds the same way.
          outcome = { pageId: next.pageId, error: refusal(error) };
        }
        /// A stream that ended without saying what happened to the page is a
        /// page the run cannot count, which is a refusal by any other name.
        outcome ??= { pageId: next.pageId, error: "the page ended without an outcome" };

        /// The board on screen is now a page fuller than the document the editor
        /// was handed. Asked for before the state is settled so the page appears
        /// while the next one is already being designed.
        reloadBoard(current.boardId);

        /// And the run's own thread is a row fuller. `designPage` writes it on
        /// the server and nothing else would tell this browser — so a user who
        /// took the switcher's invitation into the run mid-walk would sit
        /// looking at two rows of seven until a hard reload
        /// (orchestrator-tool-reference §VII.9). The row is written for a
        /// refusal as much as for a design, because a page that was *not*
        /// designed is exactly the row worth reading.
        if (thread) resetChatCache(thread);
        hold(vibesLoopSettled(held.current ?? current, outcome));
      }

      /// The tab row's picture of the board, which is a render of a board that
      /// was empty when the run started — and the offer above, which was read
      /// before any of these pages existed. Both are answers to questions this
      /// walk has just changed.
      await queryClient.invalidateQueries({
        queryKey: trpc.moodboard.listByProject.queryKey({ projectId }),
      });
      await queryClient.invalidateQueries({ queryKey: trpc.vibes.resume.queryKey() });
    } finally {
      walking.current = false;
      /// The walk's single exit, which is where the board comes back to the
      /// user. The per-page `reloadBoard` above stays: a reload under a hold
      /// remounts into a still-held canvas, which is correct.
      holdOnly(null);
    }
  }, [client, hold, holdOnly, projectId, queryClient, resetChatCache, trpc]);

  useEffect(
    () =>
      onVibesRun((request) => {
        hold(vibesLoop(request));
        void walk();
      }),
    [hold, walk],
  );

  if (!loop)
    return run && offer ? (
      <Card>
        <span className="truncate text-xs font-medium">{run.title}</span>
        <p className="text-[11px] opacity-70">{offer.label}</p>
        <button
          type="button"
          /// Announced rather than started here, so a run picked up and a run
          /// started from the form are the same run to everything downstream —
          /// one door into the loop, and the pages walked are the blank ones the
          /// query just named rather than the whole ask.
          onClick={() =>
            announceVibesRun({
              boardId: run.boardId,
              title: run.title,
              total: offer.total,
              steps: run.pending.map(({ pageId, index }) => ({ pageId, index })),
            })
          }
          className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:border-current/50"
        >
          {offer.action}
        </button>
      </Card>
    ) : null;

  const progress = vibesLoopProgress(loop);

  return (
    <Card>
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
            title={`Page ${page.index + 1}${SAYS[page.state] ?? ""}`}
            className={`h-1.5 flex-1 rounded-full ${PIP[page.state]}`}
          />
        ))}
      </div>

      <p className={`text-[11px] ${progress.refusal ? "text-red-500" : "opacity-70"}`}>
        {progress.label}
      </p>

      {/* What the page in flight is doing. Under the run's own sentence rather
          than replacing it: "Designing page 4 of 6" is the fact and this is the
          step, and the step goes when the page settles. */}
      {loop.live ? (
        <div className="flex flex-col gap-0.5">
          {loop.live.thought ? (
            <p role="status" aria-live="polite" className="line-clamp-2 text-[11px] opacity-50">
              {loop.live.thought}
            </p>
          ) : null}
          {loop.live.steps.slice(-VIBES_LIVE_STEPS).map((step) => (
            <p key={step.callId} className="truncate text-[11px] opacity-40">
              <span aria-hidden>{step.ok === undefined ? "·" : step.ok ? "✓" : "✕"}</span>{" "}
              {step.name.replace(/_/g, " ")}
            </p>
          ))}
        </div>
      ) : null}

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
    </Card>
  );
}
