import { VIBES_PAGE_LIMIT } from "@/lib/vibes/vibes-brief";
import type { VibesRunPage } from "@/lib/vibes/vibes-resume";

export const VIBES_LEASE_MS = 20 * 60 * 1000;

export const VIBES_WORKER_JOB_LIMIT = 1;

export type VibesJob = { boardId: string; pageId: string; index: number };

export function vibesJob(input: unknown): VibesJob | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const { boardId, pageId, index } = input as Record<string, unknown>;
  if (typeof boardId !== "string" || boardId.trim().length === 0) return null;
  if (typeof pageId !== "string" || pageId.trim().length === 0) return null;
  if (typeof index !== "number" || !Number.isInteger(index)) return null;
  if (index < 0 || index >= VIBES_PAGE_LIMIT) return null;
  return { boardId: boardId.trim(), pageId: pageId.trim(), index };
}

export function vibesLeaseExpiryCutoff(now: Date, leaseMs = VIBES_LEASE_MS) {
  return new Date(now.getTime() - leaseMs);
}

export function isVibesLeaseExpired(startedAt: Date, now: Date, leaseMs = VIBES_LEASE_MS) {
  return startedAt.getTime() <= vibesLeaseExpiryCutoff(now, leaseMs).getTime();
}

export function nextChainPage(
  run: readonly VibesRunPage[],
  settledIndex: number,
): VibesRunPage | null {
  return run.find((page) => page.index === settledIndex + 1) ?? null;
}
