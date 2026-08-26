/// A callback on one side and an async generator on the other.
///
/// The agents `emit` rather than yield, because an agent that yields forces
/// every caller below it to yield too — and agent 8's loop is reached from
/// inside a `Promise.all` in agent 6's tool executor. So the crossing happens
/// once, at the procedure, and this is it.
///
/// Pure and browser-loadable on purpose, though only the server uses it: the
/// invariant this file exists to defend — that abandoning the reader does not
/// touch the work — is the one thing in the whole feature a test can actually
/// hold, and `src/server/api/` has no tests and no way to have any.

/// How many events may wait for a reader before the oldest is dropped.
///
/// Not backpressure — a bound. `emit` is `void`-returning so a producer cannot
/// await it, which is deliberate: the moment an emit could apply backpressure,
/// a browser that closed its tab could stall the model loop and the guarantee
/// this design is built around would be gone. Instead the queue is lossy, and
/// `dropped()` says so. A turn emits on the order of ten events per round
/// against a writer that consumes instantly, so this is roughly fifty rounds of
/// headroom against a reader that has stopped reading entirely.
export const STREAM_BACKLOG = 512;

export function eventStream<T>(): {
  /// Push. Never throws, never blocks, never awaited by anyone.
  emit: (event: T) => void;
  /// No more are coming. The reader drains what is queued and then ends.
  close: () => void;
  /// The reader. Abandoning it stops the queue growing and does nothing else —
  /// in particular it does not touch whatever is producing.
  read: () => AsyncGenerator<T>;
  /// What the bound cost, for a caller that wants to say so.
  dropped: () => number;
} {
  let queued: T[] = [];
  /// Resolved by the next `emit` or by `close`. A real wake-up rather than a
  /// poll: a `setInterval` here would be a busy loop on every turn in the app.
  let wake: (() => void) | null = null;
  let closed = false;
  let gone = false;
  let dropped = 0;

  const nudge = () => {
    const waiting = wake;
    wake = null;
    waiting?.();
  };

  return {
    emit(event) {
      /// After the end, or after the reader walked away, an event is dropped
      /// rather than thrown on: a `report` from a detached promise must not
      /// become an unhandled error on a stream that is already over.
      if (closed || gone) return;
      if (queued.length >= STREAM_BACKLOG) {
        queued.shift();
        dropped += 1;
      }
      queued.push(event);
      nudge();
    },
    close() {
      closed = true;
      nudge();
    },
    async *read() {
      try {
        for (;;) {
          /// Drained by swapping the array rather than shifting it, so an emit
          /// landing while the loop is yielding is picked up on the next pass
          /// instead of mutating the array being walked.
          while (queued.length) {
            const batch = queued;
            queued = [];
            for (const event of batch) yield event;
          }
          if (closed) return;
          /// No `await` between the check above and the assignment below — the
          /// executor runs synchronously — so a `close()` cannot land in the
          /// gap and leave this parked forever.
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        gone = true;
        queued = [];
      }
    },
    dropped: () => dropped,
  };
}
