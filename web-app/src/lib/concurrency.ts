/// Runs `worker` over every item with at most `limit` in flight at once, in a
/// shared-cursor loop rather than fixed chunks — a slow item holds one slot
/// instead of stalling a whole batch behind it.
///
/// Never rejects: a thrown worker is recorded in that item's slot and its
/// siblings keep going, so one bad file cannot abort the rest of an upload.
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
