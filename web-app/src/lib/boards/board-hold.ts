import { callKey, type AgentEvent, type EventCall } from "@/lib/agent/shared/turn-events";

/// Which board an agent is holding, and which boards it has written to, read
/// off the turn's own events.
///
/// The browser never learned either. So a chat turn that rewrote the open board
/// left the canvas in front of the user showing the board as it was — the tab
/// deliberately keeps its scene rather than have one dropped under the user's
/// hands (`conversation-body.tsx`) — and nothing stopped a drag landing on a
/// page agent 8 was half-way through laying out.
///
/// Both are the same missing fact, and the fact is already on the wire:
/// `EventCall.args` reaches the client verbatim and `design_page` takes a
/// required `boardId`, so a `calling` names the board before the work starts and
/// its `called` names the moment it ends. No polling, and no stale lock — the
/// stream ending *is* the release.
///
/// They are also the same change in the other direction. The reason a turn never
/// reloaded an open board is that it might destroy unsaved work; under a hold
/// there is no unsaved work, so the hold is what makes the reload safe.
///
/// Pure and browser-loadable, like everything else in this directory.

/// Agent 8's door, which is the one call long enough to be worth locking a board
/// for: two to three minutes of a second agent rewriting a page.
const DESIGN_PAGE = "design_page";

/// Every other tool that writes to the board it names in `boardId`.
///
/// A named constant rather than an import of the declarations: `canvas-tools.ts`
/// and `board-tools.ts` are kilobytes of description string with no business in
/// the client bundle. `board-hold.test.mts` pins this against the real
/// declarations so the two cannot drift — and states the price `stepsOf` already
/// states in `Conversation.md` §II.4: a board-writing tool added later and not
/// added here will quietly not be counted.
///
/// The reads (`get_board_brief`, `inspect_board`, `read_canvas`) are not here
/// because they change nothing, the offers (`discard_board`, `discard_page`) are
/// not because the user's own click is what removes anything, and
/// `duplicate_board` is not because the board it names is the one it copies
/// *from* — the board it writes is a board this browser has never seen.
export const BOARD_WRITING_TOOLS: readonly string[] = [
  "add_page",
  "duplicate_page",
  "resize_page",
  "move_to_page",
  "swap_on_board",
  "reword_on_board",
  "set_canvas_background",
  "set_page_background",
  "put_on_canvas",
  "remove_from_canvas",
  "transform_on_canvas",
  "restyle_on_canvas",
  "reorder_on_canvas",
];

/// One `design_page` in flight. Keyed by the call rather than by the board,
/// because two of them on one board must not be released by whichever finishes
/// first.
export type BoardHold = { callId: string; boardId: string };

/// What a turn has done to the project's boards so far: which are being held
/// now, and which have been written to and so owe a reload.
///
/// `touched` accumulates and is never emptied — the fold is the whole turn's
/// account, and the caller resets it by starting again from `NO_BOARD_WATCH`.
export type BoardWatch = { held: readonly BoardHold[]; touched: readonly string[] };

export const NO_BOARD_WATCH: BoardWatch = { held: [], touched: [] };

function boardIdOf(call: EventCall): string | null {
  const boardId = call.args.boardId;
  return typeof boardId === "string" && boardId ? boardId : null;
}

/// One event of a live turn, folded in.
///
/// Returns the **same object** when nothing changed, which is `stepsAfter`'s
/// rule and `chatProgressed`'s and `chatPagesListed`'s, for their reason: this
/// runs tens of times a turn, and a new object each time is a re-render per
/// round.
export function boardWatchAfter(watch: BoardWatch, event: AgentEvent): BoardWatch {
  if (event.kind === "calling") {
    const held = [...watch.held];
    const touched = [...watch.touched];
    for (const call of event.calls) {
      const designing = call.name === DESIGN_PAGE;
      if (!designing && !BOARD_WRITING_TOOLS.includes(call.name)) continue;
      const boardId = boardIdOf(call);
      if (!boardId) continue;
      if (!touched.includes(boardId)) touched.push(boardId);
      /// A cheap tool marks the board written to and holds nothing: those calls
      /// are sub-second, and a scrim that flashes for 400 ms is worse than none.
      if (!designing) continue;
      const key = callKey(event, call.callId);
      if (!held.some((hold) => hold.callId === key)) held.push({ callId: key, boardId });
    }
    return held.length === watch.held.length && touched.length === watch.touched.length
      ? watch
      : { held, touched };
  }

  if (event.kind === "called") {
    const closed = new Set(event.results.map((result) => callKey(event, result.callId)));
    const held = watch.held.filter((hold) => !closed.has(hold.callId));
    /// A result for a call nobody announced changes nothing — `stepsAfter`'s
    /// rule, for its stated reason.
    return held.length === watch.held.length ? watch : { ...watch, held };
  }

  return watch;
}

/// Whether this board is being held by anything in the turn so far.
export function boardIsHeld(watch: BoardWatch, boardId: string): boolean {
  return watch.held.some((hold) => hold.boardId === boardId);
}
