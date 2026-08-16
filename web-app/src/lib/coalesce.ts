/// Collapses repeated requests for the same refresh into at most one run in
/// flight plus one queued behind it. A twenty-file drop asks for the gallery to
/// be refetched twenty times — once per landing row — and each of those
/// refetches costs a round trip over a list that is itself growing, so the
/// naive version spends more time refetching the longer the batch runs.
///
/// The contract callers depend on: the promise a request hands back settles
/// only after a run that *started after that request was made*, so awaiting it
/// means the work you just did is included in the result.
export function coalesceRuns(run: () => Promise<unknown>) {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  function start() {
    const started: Promise<void> = Promise.resolve()
      .then(run)
      .then(() => undefined)
      .finally(() => {
        if (running === started) running = null;
      });
    running = started;
    return started;
  }

  return function request(): Promise<void> {
    /// A run that has not started yet already answers for anything asked now,
    /// which is what makes twenty requests during one run cost one follow-up.
    if (queued) return queued;
    if (!running) return start();

    /// Chained on both settlements: a failed run still owes the requests that
    /// piled up behind it a fresh one.
    const next: Promise<void> = running.then(startQueued, startQueued);
    function startQueued() {
      if (queued === next) queued = null;
      return start();
    }
    queued = next;
    return next;
  };
}
