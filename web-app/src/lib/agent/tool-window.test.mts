import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TOOL_CHAR_BUDGET,
  TOOL_ROUND_LIMIT,
  roundsDroppedSaid,
  toolWindow,
} from "./tool-window";
import type { Content } from "@/server/google/vertex";

/// `chat-history.test.mts` one level down. What is asserted here is the two
/// things the window alone decides: what a hundred rounds of tool traffic is cut
/// down to, and whether what is left is a request Vertex will still accept.

const said = (text: string): Content => ({ role: "user", parts: [{ text }] });

const round = (name: string, response: Record<string, unknown> = {}): Content[] => [
  { role: "model", parts: [{ functionCall: { name, args: {} } }] },
  { role: "user", parts: [{ functionResponse: { name, response } }] },
];

/// A turn as the loop builds it: the user's message, then a pair per round.
const turn = (rounds: number, message = "crop them all") => [
  said(message),
  ...Array.from({ length: rounds }, (_, at) =>
    round("crop_reference", { referenceId: `cut-${at + 1}` }),
  ).flat(),
];

const namesIn = (contents: readonly Content[]) =>
  contents.flatMap(({ parts }) =>
    parts.flatMap((part) =>
      part.functionResponse ? [String(part.functionResponse.response?.referenceId)] : [],
    ),
  );

test("a turn inside the count limit is sent exactly as it stands", () => {
  const contents = turn(TOOL_ROUND_LIMIT);
  const window = toolWindow(contents);

  assert.equal(window.dropped, 0);
  assert.deepEqual(window.contents, contents);
});

test("a turn with no tool rounds at all is untouched", () => {
  const contents = [said("hello")];
  assert.deepEqual(toolWindow(contents), { contents, dropped: 0 });
});

/// The rule Vertex enforces and the one a smaller window would break: a
/// `functionResponse` whose call was evicted above it is not a cheaper request,
/// it is a rejected one.
test("the window evicts whole rounds, never half of one", () => {
  const { contents, dropped } = toolWindow(turn(TOOL_ROUND_LIMIT + 8));

  assert.equal(dropped, 8);
  /// The user's turn and then pairs, all the way down.
  assert.equal(contents.length, 1 + TOOL_ROUND_LIMIT * 2);
  for (let at = 1; at < contents.length; at += 2) {
    assert.ok(contents[at]!.parts.every((part) => part.functionCall), `call at ${at}`);
    assert.ok(
      contents[at + 1]!.parts.every((part) => part.functionResponse),
      `result at ${at + 1}`,
    );
  }
  /// The recent end, oldest dropped first.
  assert.deepEqual(
    namesIn(contents),
    Array.from({ length: TOOL_ROUND_LIMIT }, (_, at) => `cut-${at + 9}`),
  );
});

/// What the user attached rides in their turn — the layout sketch the whole
/// session was about. A window that could reach it would make the last round of
/// a long turn blind to the picture the turn is about.
test("the user's own turn is never evicted, however long the turn runs", () => {
  const attached: Content = {
    role: "user",
    parts: [{ fileData: { fileUri: "gs://b/sketch.png", mimeType: "image/png" } }, { text: "this one" }],
  };
  const { contents } = toolWindow([attached, ...turn(TOOL_ROUND_LIMIT + 40).slice(1)]);

  assert.equal(contents[0]!.role, "user");
  assert.deepEqual(contents[0]!.parts[0], attached.parts[0]);
  assert.deepEqual(contents[0]!.parts[1], attached.parts[1]);
});

/// Count first, then characters — `historyWindow`'s ordering. Twelve rounds
/// carrying a catalog each are not twelve short rounds' worth of money, so the
/// size pass runs after the count pass has already bounded what it walks.
test("rounds inside the count limit are still dropped when they are too big", () => {
  const fat = "x".repeat(TOOL_CHAR_BUDGET / 2);
  const contents = [
    said("what have I got?"),
    ...Array.from({ length: TOOL_ROUND_LIMIT }, (_, at) =>
      round("list_references", { referenceId: `cut-${at + 1}`, catalog: fat }),
    ).flat(),
  ];

  const window = toolWindow(contents);
  assert.ok(window.dropped > 0);
  assert.ok(window.contents.length < contents.length);
  /// Under the budget once the pass has run, measured the way the pass measures.
  const spent = window.contents.slice(1).reduce((total, { parts }) => total + JSON.stringify(parts).length, 0);
  assert.ok(spent <= TOOL_CHAR_BUDGET, String(spent));
});

/// A single round bigger than the whole budget is still sent. It is the answer to
/// the call the model made a moment ago, and a request that dropped it asks the
/// model to reason about a tool it can no longer see the result of — which is the
/// one shape that reliably produces the same call again.
test("the newest round survives even when it alone is over budget", () => {
  const enormous = "x".repeat(TOOL_CHAR_BUDGET * 3);
  const contents = [
    said("read it"),
    ...round("inspect_board", { boardId: "board-1" }),
    ...round("inspect_board", { boardId: "board-2", page: enormous }),
  ];

  const window = toolWindow(contents);
  assert.equal(window.dropped, 1);
  assert.equal(window.contents.length, 3);
  assert.deepEqual(
    window.contents.at(-1)!.parts,
    contents.at(-1)!.parts,
  );
});

/// Without this, round 40 cannot see that round 5 already cropped the earrings —
/// and it crops them again, which is a real row in the user's project and a
/// thumbnail they have to discard.
test("the summary names the calls that were dropped and the ids they filed", () => {
  const { contents } = toolWindow(turn(TOOL_ROUND_LIMIT + 3));
  const summary = contents[0]!.parts.at(-1)!;

  assert.ok(summary.text);
  const text = summary.text ?? "";
  assert.match(text, /3 earlier rounds/);
  assert.match(text, /crop_reference → cut-1/);
  assert.match(text, /crop_reference → cut-3/);
  assert.match(text, /Do not make them again/);
  /// Appended to the message rather than replacing it.
  assert.deepEqual(contents[0]!.parts[0], { text: "crop them all" });
});

/// One user turn in, one user turn out. A summary sent as a turn of its own would
/// be a second user turn in a row, which is a shape this loop has never produced
/// and Vertex's function calling has never been asked to read.
test("the summary rides on the existing user turn rather than adding one", () => {
  const { contents } = toolWindow(turn(TOOL_ROUND_LIMIT + 3));

  assert.equal(contents.filter(({ parts }) => parts.some((part) => part.text)).length, 1);
  assert.equal(contents[0]!.parts.length, 2);
});

test("a summary of a round that filed nothing names the call alone", () => {
  const [, result] = round("show_references");
  /// The result alone: the summary is built off what a round *filed*, and the
  /// call above it says nothing this sentence carries.
  const summary = roundsDroppedSaid([{ result: result! }]);

  assert.match(summary, /1 earlier round/);
  assert.match(summary, /show_references/);
  assert.ok(!summary.includes("→"));
});

/// Sentences arrive at id-shaped keys — `nudgeOf` on a crop answer is a
/// paragraph — and a summary that quoted one back would be a second copy of the
/// answer it exists in place of.
test("the summary reads ids as ids and leaves prose behind", () => {
  const name = "crop_reference";
  const filed = {
    referenceId: "cut-9",
    nudgeOf: `cut-8 is untouched — this is that cut moved, filed as a second cut of ref-1. ${"and so on ".repeat(20)}`,
    keeps: "the middle sunflower",
  };
  const summary = roundsDroppedSaid([
    { result: { role: "user", parts: [{ functionResponse: { name, response: filed } }] } },
  ]);

  assert.match(summary, /crop_reference → cut-9/);
  assert.ok(!summary.includes("is untouched"));
  assert.ok(!summary.includes("the middle sunflower"));
});

/// Anything that is not a clean run of pairs is left exactly as it is rather than
/// guessed at. A conversation this module cannot read is one it must not cut.
test("a conversation the window cannot read in pairs is passed through whole", () => {
  const odd = [said("hi"), ...round("a"), { role: "model" as const, parts: [{ functionCall: { name: "b", args: {} } }] }];
  assert.deepEqual(toolWindow(odd), { contents: odd, dropped: 0 });

  const noUserTurn = [...round("a"), ...round("b")];
  assert.deepEqual(toolWindow(noUserTurn), { contents: noUserTurn, dropped: 0 });
});
