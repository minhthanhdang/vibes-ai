import { test } from "node:test";
import assert from "node:assert/strict";

import * as boardTools from "@/lib/agent/orchestrator/board-tools";
import * as canvasTools from "@/lib/agent/shared/canvas-tools";
import { DESIGN_PAGE } from "@/lib/agent/orchestrator/handoff-tools";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import type { AgentEvent, EventCall } from "@/lib/agent/shared/turn-events";
import {
  BOARD_WRITING_TOOLS,
  boardIsHeld,
  boardWatchAfter,
  NO_BOARD_WATCH,
  type BoardWatch,
} from "@/lib/boards/board-hold";

/// The hold is a UI courtesy with a real cost when it is wrong: a board held and
/// never released is a canvas the user cannot edit until they reload the page,
/// and a board released early is a drag landing on a page agent 8 is still
/// writing. Everything below is one of those two failures.

const ORCHESTRATOR = { agent: "orchestrator", under: [] as string[], seq: 0 };
const DESIGNER = { agent: "designer", under: ["orchestrator"], seq: 0 };

function calling(
  from: typeof ORCHESTRATOR,
  calls: readonly (Partial<EventCall> & { name: string })[],
): AgentEvent {
  return {
    ...from,
    kind: "calling",
    calls: calls.map((call, at) => ({
      callId: call.callId ?? `1.${at + 1}`,
      name: call.name,
      args: call.args ?? {},
    })),
  };
}

function called(from: typeof ORCHESTRATOR, ids: readonly string[], ok = true): AgentEvent {
  return {
    ...from,
    kind: "called",
    results: ids.map((callId) => ({ callId, name: "design_page", ok })),
  };
}

function fold(events: readonly AgentEvent[], from: BoardWatch = NO_BOARD_WATCH): BoardWatch {
  return events.reduce(boardWatchAfter, from);
}

test("a design_page call holds the board it names and marks it written to", () => {
  const watch = fold([
    calling(ORCHESTRATOR, [{ callId: "1.1", name: "design_page", args: { boardId: "board-a" } }]),
  ]);
  assert.deepEqual(watch.held, [{ callId: "1.1", boardId: "board-a" }]);
  assert.deepEqual(watch.touched, ["board-a"]);
  assert.equal(boardIsHeld(watch, "board-a"), true);
  assert.equal(boardIsHeld(watch, "board-b"), false);
});

test("the result of that call releases it, and the board stays written to", () => {
  const watch = fold([
    calling(ORCHESTRATOR, [{ callId: "1.1", name: "design_page", args: { boardId: "board-a" } }]),
    called(ORCHESTRATOR, ["1.1"]),
  ]);
  assert.deepEqual(watch.held, []);
  assert.deepEqual(watch.touched, ["board-a"]);
});

test("a call that failed releases the board as surely as one that worked", () => {
  const watch = fold([
    calling(ORCHESTRATOR, [{ callId: "1.1", name: "design_page", args: { boardId: "board-a" } }]),
    called(ORCHESTRATOR, ["1.1"], false),
  ]);
  assert.deepEqual(watch.held, []);
});

test("two designs of one board are two holds, and the first to finish releases neither", () => {
  const opened = fold([
    calling(ORCHESTRATOR, [
      { callId: "1.1", name: "design_page", args: { boardId: "board-a" } },
      { callId: "1.2", name: "design_page", args: { boardId: "board-a" } },
    ]),
  ]);
  assert.equal(opened.held.length, 2);
  assert.deepEqual(opened.touched, ["board-a"], "one board, named twice");

  const half = boardWatchAfter(opened, called(ORCHESTRATOR, ["1.1"]));
  assert.equal(boardIsHeld(half, "board-a"), true);
  assert.equal(boardIsHeld(boardWatchAfter(half, called(ORCHESTRATOR, ["1.2"])), "board-a"), false);
});

test("the designer's own call ids cannot close the orchestrator's hold", () => {
  /// Two agents number their calls independently, so agent 8's `1.1` and agent
  /// 6's `1.1` are different calls — `callKey`'s whole reason, and here a bare
  /// id would release a board mid-design.
  const watch = fold([
    calling(ORCHESTRATOR, [{ callId: "1.1", name: "design_page", args: { boardId: "board-a" } }]),
    called(DESIGNER, ["1.1"]),
  ]);
  assert.equal(boardIsHeld(watch, "board-a"), true);
});

test("a cheap board write marks the board and holds nothing", () => {
  /// Sub-second calls: a scrim that flashes for 400 ms is worse than none.
  const watch = fold([
    calling(ORCHESTRATOR, [{ name: "swap_on_board", args: { boardId: "board-a" } }]),
  ]);
  assert.deepEqual(watch.held, []);
  assert.deepEqual(watch.touched, ["board-a"]);
});

test("a read, an offer and a duplicate leave the board alone", () => {
  for (const name of ["inspect_board", "read_canvas", "discard_board", "duplicate_board"]) {
    const watch = fold([calling(ORCHESTRATOR, [{ name, args: { boardId: "board-a" } }])]);
    assert.equal(watch, NO_BOARD_WATCH, `${name} touched a board`);
  }
});

test("nothing changed is the same object", () => {
  const opened = fold([
    calling(ORCHESTRATOR, [{ callId: "1.1", name: "design_page", args: { boardId: "board-a" } }]),
  ]);
  /// The same round arriving twice, a result nobody announced, a kind that is
  /// neither — each is a re-render per round if it allocates.
  assert.equal(
    boardWatchAfter(opened, calling(ORCHESTRATOR, [
      { callId: "1.1", name: "design_page", args: { boardId: "board-a" } },
    ])),
    opened,
  );
  assert.equal(boardWatchAfter(opened, called(ORCHESTRATOR, ["9.9"])), opened);
  assert.equal(
    boardWatchAfter(opened, { ...ORCHESTRATOR, kind: "thinking", text: "hm" }),
    opened,
  );
  assert.equal(boardWatchAfter(opened, { ...ORCHESTRATOR, kind: "delta", text: "hi" }), opened);
});

test("a call with no board id is not a hold", () => {
  /// `boardId` is required on `design_page`, but the args come off the wire as
  /// whatever the model sent — a missing one must not open a hold on undefined.
  const watch = fold([
    calling(ORCHESTRATOR, [{ name: "design_page", args: {} }]),
    calling(ORCHESTRATOR, [{ name: "design_page", args: { boardId: 7 } }]),
  ]);
  assert.equal(watch, NO_BOARD_WATCH);
});

/// The pin. `BOARD_WRITING_TOOLS` is a copy of a fact that lives in the
/// declarations, kept because the declarations are kilobytes of description
/// string with no business in the client bundle — so the copy has to be checked
/// against the original.
///
/// The price, stated: a board-writing tool added later and not added to the
/// constant will quietly not be counted, exactly as `stepsOf` says of a tool
/// added and not taught to the column (`Conversation.md` §II.4). This test turns
/// that into a failure at the moment the tool is declared.
const NOT_A_BOARD_WRITE = new Set([
  /// Reads.
  "get_board_brief",
  "inspect_board",
  "read_canvas",
  /// Offers: the tool asks, and the user's own click is what removes anything.
  "discard_board",
  "discard_page",
  /// Names the board it copies *from*; what it writes is a board this browser
  /// has never seen.
  "duplicate_board",
]);

function declarationsIn(module: Record<string, unknown>): ToolDeclaration[] {
  return Object.values(module).filter(
    (value): value is ToolDeclaration =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as ToolDeclaration).name === "string" &&
      typeof (value as ToolDeclaration).parameters === "object",
  );
}

function takesBoardId(declaration: ToolDeclaration): boolean {
  const properties = (declaration.parameters as { properties?: Record<string, unknown> }).properties;
  return Boolean(properties && "boardId" in properties);
}

test("BOARD_WRITING_TOOLS is every declaration that writes to a board it names", () => {
  const named = [...declarationsIn(boardTools), ...declarationsIn(canvasTools), DESIGN_PAGE]
    .filter(takesBoardId)
    .map((declaration) => declaration.name)
    .filter((name) => !NOT_A_BOARD_WRITE.has(name));

  assert.deepEqual(
    [...new Set(named)].sort(),
    [...BOARD_WRITING_TOOLS, "design_page"].sort(),
  );
});

test("every name in the constant is a tool that exists", () => {
  const declared = new Set(
    [...declarationsIn(boardTools), ...declarationsIn(canvasTools)].map(({ name }) => name),
  );
  for (const name of BOARD_WRITING_TOOLS) {
    assert.ok(declared.has(name), `${name} is not declared anywhere`);
  }
});
