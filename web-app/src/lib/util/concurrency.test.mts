import { test } from "node:test";
import assert from "node:assert/strict";

import { mapWithConcurrency } from "@/lib/util/concurrency";

function tracker() {
  const state = { inFlight: 0, peak: 0, started: [] as number[] };
  return {
    state,
    async run<R>(value: number, body: () => Promise<R>) {
      state.started.push(value);
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      try {
        return await body();
      } finally {
        state.inFlight -= 1;
      }
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

test("never runs more than `limit` workers at once", async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const { state, run } = tracker();

  await mapWithConcurrency(items, 3, (item) => run(item, tick));

  assert.equal(state.peak, 3);
  assert.equal(state.started.length, items.length);
});

test("returns results in input order regardless of completion order", async () => {
  const delays = [30, 1, 20, 2];

  const results = await mapWithConcurrency(delays, 4, async (delay) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return delay;
  });

  assert.deepEqual(
    results.map((result) => (result.status === "fulfilled" ? result.value : null)),
    delays,
  );
});

test("a rejecting worker does not stop its siblings", async () => {
  const results = await mapWithConcurrency([1, 2, 3], 2, async (item) => {
    if (item === 2) throw new Error("nope");
    return item;
  });

  assert.deepEqual(results.map((result) => result.status), [
    "fulfilled",
    "rejected",
    "fulfilled",
  ]);
  assert.equal((results[1] as PromiseRejectedResult).reason.message, "nope");
});

test("spawns no more runners than there are items", async () => {
  const { state, run } = tracker();

  await mapWithConcurrency([1, 2], 10, (item) => run(item, tick));

  assert.equal(state.peak, 2);
});

test("makes progress on a nonsense limit", async () => {
  const { state, run } = tracker();

  const results = await mapWithConcurrency([1, 2, 3], 0, (item) => run(item, tick));

  assert.equal(state.peak, 1);
  assert.equal(results.length, 3);
});

test("handles an empty list without calling the worker", async () => {
  let calls = 0;

  const results = await mapWithConcurrency([], 4, async () => {
    calls += 1;
  });

  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});
