import { test } from "node:test";
import assert from "node:assert/strict";

import {
  historyWindow,
  HISTORY_CHAR_BUDGET,
  HISTORY_TEXT_LIMIT,
  HISTORY_TURN_LIMIT,
  type ChatTurn,
} from "@/lib/agent/orchestrator/history";

function exchange(pairs: number, text = "ok"): ChatTurn[] {
  return Array.from({ length: pairs }, (_, index) => [
    { role: "user" as const, text: `ask ${index} ${text}` },
    { role: "model" as const, text: `answer ${index} ${text}` },
  ]).flat();
}

test("a short conversation goes up whole", () => {
  const messages = exchange(3);

  assert.deepEqual(historyWindow(messages), messages);
});

test("a conversation past the turn limit keeps the recent end", () => {
  const window = historyWindow(exchange(HISTORY_TURN_LIMIT));

  assert.equal(window.length, HISTORY_TURN_LIMIT);
  assert.equal(window[0]!.text, `ask ${HISTORY_TURN_LIMIT / 2} ok`);
  assert.equal(window.at(-1)!.text, `answer ${HISTORY_TURN_LIMIT - 1} ok`);
});

test("a conversation the router used to reject is answered rather than refused", () => {
  const window = historyWindow(exchange(40));

  assert.equal(window.length, HISTORY_TURN_LIMIT);
  assert.equal(window.at(-1)!.text, "answer 39 ok");
});

test("long messages are dropped from the front until the budget is met", () => {
  const long = "x".repeat(900);
  const window = historyWindow(exchange(HISTORY_TURN_LIMIT / 2, long));

  const spent = window.reduce((total, { text }) => total + text.length, 0);
  assert.ok(spent <= HISTORY_CHAR_BUDGET, `${spent} over budget`);
  assert.ok(window.length < HISTORY_TURN_LIMIT);
  assert.equal(window.at(-1)!.text, `answer ${HISTORY_TURN_LIMIT / 2 - 1} ${long}`);
});

test("one message longer than the limit is cut rather than dropped", () => {
  const window = historyWindow([
    { role: "user", text: "and the wide one?" },
    { role: "model", text: "y".repeat(HISTORY_TEXT_LIMIT * 3) },
  ]);

  assert.equal(window.length, 2);
  assert.equal(window[1]!.text.length, HISTORY_TEXT_LIMIT);
  assert.ok(window[1]!.text.endsWith("…"));
});

test("a message exactly at the limit is left alone", () => {
  const exact = "y".repeat(HISTORY_TEXT_LIMIT);
  const window = historyWindow([{ role: "user", text: exact }]);

  assert.deepEqual(window, [{ role: "user", text: exact }]);
});

test("the window begins with the user", () => {
  const messages = [
    ...exchange(HISTORY_TURN_LIMIT / 2),
    { role: "user" as const, text: "I took the cut" },
  ];
  const window = historyWindow(messages);

  assert.equal(window[0]!.role, "user");
  assert.equal(window[0]!.text, "ask 1 ok");
  assert.equal(window.length, HISTORY_TURN_LIMIT - 1);
});

test("consecutive model turns at the front are all dropped", () => {
  const window = historyWindow([
    { role: "model", text: "one" },
    { role: "model", text: "two" },
    { role: "user", text: "three" },
  ]);

  assert.deepEqual(window, [{ role: "user", text: "three" }]);
});

test("a conversation of nothing but the assistant sends nothing", () => {
  assert.deepEqual(historyWindow([{ role: "model", text: "hello" }]), []);
});

test("blank messages are not messages", () => {
  const window = historyWindow([
    { role: "user", text: "  " },
    { role: "user", text: " the hall shot " },
    { role: "model", text: "" },
  ]);

  assert.deepEqual(window, [{ role: "user", text: "the hall shot" }]);
});

test("an empty conversation is an empty window", () => {
  assert.deepEqual(historyWindow([]), []);
});

test("the per-message limit fits inside the budget", () => {
  assert.ok(HISTORY_TEXT_LIMIT <= HISTORY_CHAR_BUDGET);
});
