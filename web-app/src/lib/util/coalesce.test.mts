import { test } from "node:test";
import assert from "node:assert/strict";

import { coalesceRuns } from "@/lib/util/coalesce";

function controllable() {
  const state = { starts: 0, finishes: 0 };
  let release: (() => void) | undefined;
  return {
    state,
    run: () => {
      state.starts += 1;
      return new Promise<void>((resolve) => {
        release = () => {
          state.finishes += 1;
          resolve();
        };
      });
    },
    finish: () => release?.(),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a request made while idle starts a run", async () => {
  const { state, run, finish } = controllable();
  const request = coalesceRuns(run);

  const done = request();
  await settle();
  assert.equal(state.starts, 1);

  finish();
  await done;
});

test("requests piling up during a run collapse into one follow-up run", async () => {
  const { state, run, finish } = controllable();
  const request = coalesceRuns(run);

  const first = request();
  await settle();
  const queued = Array.from({ length: 20 }, () => request());
  finish();
  await first;
  await settle();

  assert.equal(state.starts, 2);
  finish();
  await Promise.all(queued);
  assert.equal(state.starts, 2);
});

test("a request never settles on a run that started before it", async () => {
  const { state, run, finish } = controllable();
  const request = coalesceRuns(run);

  const first = request();
  await settle();
  const late = request();
  let lateSettledAfter = -1;
  void late.then(() => (lateSettledAfter = state.finishes));

  finish();
  await first;
  await settle();
  assert.equal(lateSettledAfter, -1, "settled on the run it was queued behind");

  finish();
  await late;
  assert.equal(lateSettledAfter, 2);
});

test("requests that never overlap each run on their own", async () => {
  const { state, run, finish } = controllable();
  const request = coalesceRuns(run);

  for (let i = 0; i < 3; i++) {
    const done = request();
    await settle();
    finish();
    await done;
  }

  assert.equal(state.starts, 3);
});

test("a failing run rejects its callers without wedging the queue", async () => {
  let starts = 0;
  const request = coalesceRuns(() => {
    starts += 1;
    return starts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve();
  });

  await assert.rejects(request(), /offline/);
  await request();

  assert.equal(starts, 2);
});

test("a run failing under a queued request still runs the follow-up", async () => {
  let starts = 0;
  let fail: ((error: Error) => void) | undefined;
  const request = coalesceRuns(() => {
    starts += 1;
    return starts === 1 ? new Promise<void>((_, reject) => (fail = reject)) : Promise.resolve();
  });

  const first = request();
  await settle();
  const queued = request();

  fail?.(new Error("offline"));
  await assert.rejects(first, /offline/);
  await queued;

  assert.equal(starts, 2);
});
