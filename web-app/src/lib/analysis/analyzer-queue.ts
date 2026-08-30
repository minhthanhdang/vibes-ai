import type { AnalysisRunStatus } from "@/lib/analysis/analysis-view";

export const ANALYZER_LEASE_MS = 10 * 60 * 1000;

export const WORKER_JOB_LIMIT = 5;

export const RUN_ERROR_LIMIT = 500;

export type AnalyzerJob = { referenceId: string };

export function analyzerJob(input: unknown): AnalyzerJob | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const referenceId = (input as Record<string, unknown>).referenceId;
  if (typeof referenceId !== "string" || referenceId.trim().length === 0) return null;
  return { referenceId: referenceId.trim() };
}

export function leaseExpiryCutoff(now: Date, leaseMs = ANALYZER_LEASE_MS) {
  return new Date(now.getTime() - leaseMs);
}

export function isLeaseExpired(startedAt: Date, now: Date, leaseMs = ANALYZER_LEASE_MS) {
  return startedAt.getTime() <= leaseExpiryCutoff(now, leaseMs).getTime();
}

export function workerJobLimit(requested?: number) {
  if (requested === undefined || !Number.isFinite(requested)) return WORKER_JOB_LIMIT;
  return Math.min(WORKER_JOB_LIMIT, Math.max(1, Math.trunc(requested)));
}

export function requestedJobLimit(param: string | null | undefined) {
  if (param === undefined || param === null || param.trim().length === 0) return undefined;
  const parsed = Number(param);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function shouldEnqueueAnalysis(run: { status: AnalysisRunStatus } | null) {
  if (!run) return true;
  return run.status !== "QUEUED" && run.status !== "RUNNING";
}

export function runErrorMessage(cause: unknown, limit = RUN_ERROR_LIMIT) {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const message = raw.replace(/\s+/g, " ").trim();
  if (!message) return "analysis failed";
  return message.length > limit ? `${message.slice(0, limit - 1)}…` : message;
}
