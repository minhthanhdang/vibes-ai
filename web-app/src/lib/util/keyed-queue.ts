export function keyedQueue() {
  const tails = new Map<string, Promise<void>>();

  return {
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

      return started;
    },

    size() {
      return tails.size;
    },
  };
}
