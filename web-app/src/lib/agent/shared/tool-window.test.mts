import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TOOL_CHAR_BUDGET,
  TOOL_ROUND_LIMIT,
  roundsDroppedSaid,
  toolWindow,
} from "./tool-window";
import type { Content } from "@/server/google/vertex";

const said = (text: string): Content => ({ role: "user", parts: [{ text }] });

const round = (name: string, response: Record<string, unknown> = {}): Content[] => [
  { role: "model", parts: [{ functionCall: { name, args: {} } }] },
  { role: "user", parts: [{ functionResponse: { name, response } }] },
];

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

test("the window evicts whole rounds, never half of one", () => {
  const { contents, dropped } = toolWindow(turn(TOOL_ROUND_LIMIT + 8));

  assert.equal(dropped, 8);
  assert.equal(contents.length, 1 + TOOL_ROUND_LIMIT * 2);
  for (let at = 1; at < contents.length; at += 2) {
    assert.ok(contents[at]!.parts.every((part) => part.functionCall), `call at ${at}`);
    assert.ok(
      contents[at + 1]!.parts.every((part) => part.functionResponse),
      `result at ${at + 1}`,
    );
  }
  assert.deepEqual(
    namesIn(contents),
    Array.from({ length: TOOL_ROUND_LIMIT }, (_, at) => `cut-${at + 9}`),
  );
});

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
  const spent = window.contents.slice(1).reduce((total, { parts }) => total + JSON.stringify(parts).length, 0);
  assert.ok(spent <= TOOL_CHAR_BUDGET, String(spent));
});

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

test("the summary names the calls that were dropped and the ids they filed", () => {
  const { contents } = toolWindow(turn(TOOL_ROUND_LIMIT + 3));
  const summary = contents[0]!.parts.at(-1)!;

  assert.ok(summary.text);
  const text = summary.text ?? "";
  assert.match(text, /3 earlier rounds/);
  assert.match(text, /crop_reference → cut-1/);
  assert.match(text, /crop_reference → cut-3/);
  assert.match(text, /Do not make them again/);
  assert.deepEqual(contents[0]!.parts[0], { text: "crop them all" });
});

test("the summary rides on the existing user turn rather than adding one", () => {
  const { contents } = toolWindow(turn(TOOL_ROUND_LIMIT + 3));

  assert.equal(contents.filter(({ parts }) => parts.some((part) => part.text)).length, 1);
  assert.equal(contents[0]!.parts.length, 2);
});

test("a summary of a round that filed nothing names the call alone", () => {
  const [, result] = round("show_references");
  const summary = roundsDroppedSaid([{ result: result! }]);

  assert.match(summary, /1 earlier round/);
  assert.match(summary, /show_references/);
  assert.ok(!summary.includes("→"));
});

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

test("a conversation the window cannot read in pairs is passed through whole", () => {
  const odd = [said("hi"), ...round("a"), { role: "model" as const, parts: [{ functionCall: { name: "b", args: {} } }] }];
  assert.deepEqual(toolWindow(odd), { contents: odd, dropped: 0 });

  const noUserTurn = [...round("a"), ...round("b")];
  assert.deepEqual(toolWindow(noUserTurn), { contents: noUserTurn, dropped: 0 });
});
