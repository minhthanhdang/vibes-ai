export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const runners = Math.min(Math.max(1, Math.trunc(limit) || 1), items.length);
  await Promise.all(Array.from({ length: runners }, run));
  return results;
}
