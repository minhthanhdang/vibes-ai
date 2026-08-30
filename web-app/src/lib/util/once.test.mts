import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOnce } from "@/lib/util/once";

function controllable() {
  const state = { starts: 0 };
  let settle: ((outcome: { value?: string; error?: Error }) => void) | undefined;
  const started = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(settle, "the build was expected to have begun by now");
  };
  return {
    state,
    started,
    build: () =>
      new Promise<string>((resolve, reject) => {
        state.starts += 1;
        settle = (outcome) => (outcome.error ? reject(outcome.error) : resolve(outcome.value!));
      }),
    succeed: async (value: string) => {
      await started();
      settle!({ value });
    },
    fail: async (error: Error) => {
      await started();
      settle!({ error });
    },
  };
}

test("the build runs once and every later caller gets that same value", async () => {
  const { state, build, succeed } = controllable();
  const value = buildOnce(build);

  const first = value();
  await succeed("pool");

  assert.equal(await first, "pool");
  assert.equal(await value(), "pool");
  assert.equal(await value(), "pool");
  assert.equal(state.starts, 1);
});

test("callers arriving while a build is in flight share it rather than starting their own", async () => {
  const { state, build, succeed, started } = controllable();
  const value = buildOnce(build);

  const waiting = [value(), value(), value()];
  await started();
  assert.equal(state.starts, 1);

  await succeed("pool");
  assert.deepEqual(await Promise.all(waiting), ["pool", "pool", "pool"]);
  assert.equal(state.starts, 1);
});

test("a failed build is not kept — the next caller starts a fresh one and gets the value", async () => {
  const { state, build, succeed, fail } = controllable();
  const value = buildOnce(build);

  const first = value();
  await fail(new Error("admin API unreachable"));
  await assert.rejects(first, /admin API unreachable/);

  const second = value();
  await succeed("pool");
  assert.equal(await second, "pool");
  assert.equal(state.starts, 2);
});

test("everyone waiting on a failing build sees the failure, and it costs one build not one each", async () => {
  const { state, build, fail } = controllable();
  const value = buildOnce(build);

  const waiting = [value(), value()];
  await fail(new Error("admin API unreachable"));

  for (const pending of waiting) await assert.rejects(pending, /admin API unreachable/);
  assert.equal(state.starts, 1);
});

test("a build that throws synchronously is a failed build, not an escaped throw", async () => {
  let starts = 0;
  const value = buildOnce<string>(() => {
    starts += 1;
    if (starts === 1) throw new Error("CLOUD_SQL_INSTANCE is missing");
    return Promise.resolve("pool");
  });

  await assert.rejects(value(), /CLOUD_SQL_INSTANCE is missing/);
  assert.equal(await value(), "pool");
  assert.equal(starts, 2);
});

test("a value that succeeded stays — a later caller never rebuilds it", async () => {
  let starts = 0;
  const value = buildOnce(() => Promise.resolve(`built ${(starts += 1)}`));

  assert.equal(await value(), "built 1");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await value(), "built 1");
  assert.equal(starts, 1);
});
