import { test } from "node:test";
import assert from "node:assert/strict";

import { keyedQueue } from "@/lib/util/keyed-queue";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/// A task whose completion the test decides, so "did these two overlap" is an
/// exact question rather than a timing one.
function held(log: string[], name: string) {
  let release: (() => void) | undefined;
  return {
    task: () => {
      log.push(`${name} started`);
      return new Promise<string>((resolve) => {
        release = () => {
          log.push(`${name} finished`);
          resolve(name);
        };
      });
    },
    finish: () => release?.(),
  };
}

test("two tasks on one key do not overlap", async () => {
  const queue = keyedQueue();
  const log: string[] = [];
  const first = held(log, "swap");
  const second = held(log, "reword");

  const a = queue.run("board-1", first.task);
  const b = queue.run("board-1", second.task);
  await settle();

  assert.deepEqual(log, ["swap started"]);

  first.finish();
  await settle();
  assert.deepEqual(log, ["swap started", "swap finished", "reword started"]);

  second.finish();
  assert.equal(await a, "swap");
  assert.equal(await b, "reword");
});

test("tasks on different keys run side by side", async () => {
  const queue = keyedQueue();
  const log: string[] = [];
  const first = held(log, "board-1");
  const second = held(log, "board-2");

  queue.run("board-1", first.task);
  queue.run("board-2", second.task);
  await settle();

  assert.deepEqual(log, ["board-1 started", "board-2 started"]);
  first.finish();
  second.finish();
});

test("a task with no key waits for nothing", async () => {
  const queue = keyedQueue();
  const log: string[] = [];
  const first = held(log, "compose");
  const second = held(log, "new board");

  queue.run("", first.task);
  queue.run("", second.task);
  await settle();

  assert.deepEqual(log, ["compose started", "new board started"]);
  assert.equal(queue.size(), 0);
  first.finish();
  second.finish();
});

test("a task that throws does not stop the next one on that key", async () => {
  const queue = keyedQueue();
  const ran: string[] = [];

  const failed = queue.run("board-1", async () => {
    ran.push("first");
    throw new Error("the board was changed");
  });
  const after = queue.run("board-1", async () => {
    ran.push("second");
    return "done";
  });

  await assert.rejects(failed, /the board was changed/);
  assert.equal(await after, "done");
  assert.deepEqual(ran, ["first", "second"]);
});

test("a key is forgotten once its chain has settled", async () => {
  const queue = keyedQueue();

  const first = queue.run("board-1", async () => "a");
  const second = queue.run("board-1", async () => "b");
  assert.equal(queue.size(), 1);

  await Promise.all([first, second]);
  await settle();

  assert.equal(queue.size(), 0);
});
