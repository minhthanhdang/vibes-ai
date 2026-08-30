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
    if (queued) return queued;
    if (!running) return start();

    const next: Promise<void> = running.then(startQueued, startQueued);
    function startQueued() {
      if (queued === next) queued = null;
      return start();
    }
    queued = next;
    return next;
  };
}
