import { callKey, type AgentEvent, type EventCall } from "@/lib/agent/shared/turn-events";

const DESIGN_PAGE = "design_page";

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

export type BoardHold = { callId: string; boardId: string };

export type BoardWatch = { held: readonly BoardHold[]; touched: readonly string[] };

export const NO_BOARD_WATCH: BoardWatch = { held: [], touched: [] };

function boardIdOf(call: EventCall): string | null {
  const boardId = call.args.boardId;
  return typeof boardId === "string" && boardId ? boardId : null;
}

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
    return held.length === watch.held.length ? watch : { ...watch, held };
  }

  return watch;
}

export function boardIsHeld(watch: BoardWatch, boardId: string): boolean {
  return watch.held.some((hold) => hold.boardId === boardId);
}
