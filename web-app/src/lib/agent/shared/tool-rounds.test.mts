import { test } from "node:test";
import assert from "node:assert/strict";

import { roundsIn } from "./tool-rounds";
import type { Content } from "@/server/google/vertex";

const said = (text: string): Content => ({ role: "user", parts: [{ text }] });

const round = (name = "crop_reference"): Content[] => [
  { role: "model", parts: [{ functionCall: { name, args: {} } }] },
  { role: "user", parts: [{ functionResponse: { name, response: {} } }] },
];

const turn = (rounds: number) => [said("crop them all"), ...Array.from({ length: rounds }, () => round()).flat()];

test("a clean run of pairs reads as rounds, and head is where they begin", () => {
  const parsed = roundsIn(turn(3));
  assert.equal(parsed?.head, 1);
  assert.equal(parsed?.rounds.length, 3);
});

test("each round carries the index of its result content", () => {
  const contents = turn(2);
  const parsed = roundsIn(contents);
  for (const { result, at } of parsed?.rounds ?? []) assert.equal(contents[at], result);
});

test("an odd tail is not a run of pairs and is refused", () => {
  assert.equal(roundsIn([...turn(1), { role: "model", parts: [{ functionCall: { name: "x", args: {} } }] }]), null);
});

test("a pair that is not a call and then a result is refused", () => {
  const orphaned: Content[] = [
    said("crop them all"),
    { role: "user", parts: [{ functionResponse: { name: "crop_reference", response: {} } }] },
    { role: "model", parts: [{ functionCall: { name: "crop_reference", args: {} } }] },
  ];
  assert.equal(roundsIn(orphaned), null);
});

test("a conversation with no tool traffic reads as no rounds at all", () => {
  const parsed = roundsIn([said("hello")]);
  assert.deepEqual(parsed, { head: 1, rounds: [] });
});

test("head is 0 when the tool traffic reaches the top", () => {
  assert.equal(roundsIn(round())?.head, 0);
});

test("the walk stops at the user's turn rather than counting forward", () => {
  const parsed = roundsIn([said("first"), said("second"), ...round(), ...round()]);
  assert.equal(parsed?.head, 2);
  assert.equal(parsed?.rounds.length, 2);
});
