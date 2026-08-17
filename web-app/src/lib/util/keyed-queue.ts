/// One thing at a time, per key.
///
/// The orchestrator runs every tool a model asked for in one round with
/// `Promise.all` — which is right for the reads and for two crops of two
/// different frames, and wrong the moment two of those calls name the *same
/// board*. Each board edit is a read, a decision and a revision-guarded write,
/// so two of them running side by side both read the same revision, one write
/// wins and the other is told the board "was changed while I was editing it —
/// the user has it open". Nobody had it open: the turn did that to itself,
/// the second edit is lost, and the sentence the user is handed is untrue.
///
/// Serialising by board id rather than serialising the round is what keeps the
/// expensive calls parallel: two crops are two vision calls with nothing between
/// them, and a turn that takes twice as long to answer is a real cost.
///
/// The revision guard stays exactly where it is. It is for the *user's* own
/// tab, which this cannot see and must not pretend to; this is only for the
/// conflicts a turn creates with itself, and removing those is what makes the
/// guard's message true when it does fire.
export function keyedQueue() {
  /// The end of each key's chain, as a promise that never rejects — a task that
  /// throws must not poison the queue for the next one.
  const tails = new Map<string, Promise<void>>();

  return {
    /// Run `task` once everything already queued under `key` has settled. An
    /// empty key is not a key: a call that names no board is not contending with
    /// anything, so it runs straight away.
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      if (!key) return task();

      const prior = tails.get(key);
      const started = prior ? prior.then(task) : task();

      const settled: Promise<void> = started.then(
        () => {
          if (tails.get(key) === settled) tails.delete(key);
        },
        () => {
          if (tails.get(key) === settled) tails.delete(key);
        },
      );
      tails.set(key, settled);

      /// The caller gets the task's own promise, rejection and all — the queue
      /// decides when a task runs and nothing else about it.
      return started;
    },

    /// How many keys are still in flight. Here so a test can assert the map does
    /// not grow for the lifetime of a turn, which is the one thing a queue built
    /// out of a map of promises gets wrong quietly.
    size() {
      return tails.size;
    },
  };
}
