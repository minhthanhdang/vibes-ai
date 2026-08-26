import { test } from "node:test";
import assert from "node:assert/strict";

import { STREAM_BACKLOG, eventStream } from "./event-stream";

/// The queue between an agent that emits and a procedure that yields — and, in
/// the last case, the one invariant of the whole feature that a test in this
/// repo can actually hold.

const drained = async <T,>(read: AsyncGenerator<T>) => {
  const got: T[] = [];
  for await (const event of read) got.push(event);
  return got;
};

test("events emitted before anyone reads are still there to read", async () => {
  const stream = eventStream<number>();
  stream.emit(1);
  stream.emit(2);
  stream.close();
  assert.deepEqual(await drained(stream.read()), [1, 2]);
});

test("a reader ahead of the producer parks, and is woken by the next emit", async () => {
  const stream = eventStream<string>();
  const reading = drained(stream.read());

  /// Two turns of the event loop with nothing queued: the reader is parked on
  /// a promise, not spinning on a poll.
  await new Promise((resolve) => setTimeout(resolve, 5));
  stream.emit("a");
  await new Promise((resolve) => setTimeout(resolve, 5));
  stream.emit("b");
  stream.close();

  assert.deepEqual(await reading, ["a", "b"]);
});

test("closing drains what is queued before it ends", async () => {
  const stream = eventStream<number>();
  const reading = drained(stream.read());
  stream.emit(1);
  stream.emit(2);
  stream.close();
  assert.deepEqual(await reading, [1, 2]);
});

test("an emit after the end is dropped rather than thrown on", async () => {
  const stream = eventStream<number>();
  stream.close();
  assert.doesNotThrow(() => stream.emit(1));
  assert.deepEqual(await drained(stream.read()), []);
});

test("past the bound the oldest goes, and the loss is counted", async () => {
  const stream = eventStream<number>();
  for (let n = 0; n < STREAM_BACKLOG + 3; n += 1) stream.emit(n);
  stream.close();

  const got = await drained(stream.read());
  assert.equal(got.length, STREAM_BACKLOG);
  assert.equal(stream.dropped(), 3);
  /// The newest survive, because what a watcher wants is what is happening now.
  assert.equal(got[0], 3);
  assert.equal(got.at(-1), STREAM_BACKLOG + 2);
});

test("abandoning the reader does not touch the work behind it", async () => {
  /// The guarantee the whole feature is built around, and the only place it can
  /// be asserted: `src/server/api/` has no tests and no way to have any.
  ///
  /// tRPC calls `.return()` on the iterator when the response is cancelled
  /// (`readableStreamFrom`'s `cancel`), so a turn whose persistence sat inside
  /// the generator would be a turn a closed tab silently threw away. Here the
  /// work is a promise the reader is not in the call chain of.
  const stream = eventStream<string>();
  const done: string[] = [];

  const work = (async () => {
    stream.emit("round one");
    await new Promise((resolve) => setTimeout(resolve, 20));
    /// The write that must happen whether or not anybody is still listening.
    done.push("stored");
    stream.close();
    return "answered";
  })();

  const reader = stream.read();
  const first = await reader.next();
  assert.equal(first.value, "round one");

  /// The tab closes.
  await reader.return(undefined);
  assert.deepEqual(done, [], "the work has not finished yet — that is the point");

  assert.equal(await work, "answered");
  assert.deepEqual(done, ["stored"], "the work ran to the end with nobody reading");
});

test("emitting into an abandoned stream is a no-op, not a leak", async () => {
  const stream = eventStream<number>();
  const reader = stream.read();
  stream.emit(1);
  await reader.next();
  await reader.return(undefined);

  for (let n = 0; n < 10_000; n += 1) stream.emit(n);
  assert.equal(stream.dropped(), 0, "nothing was queued, so nothing was dropped");
});
