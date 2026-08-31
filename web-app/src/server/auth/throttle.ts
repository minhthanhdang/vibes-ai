import "server-only";

export const PASSWORD_ATTEMPT_LIMIT = 10;
export const PASSWORD_WINDOW_MS = 15 * 60 * 1000;
export const JUDGE_ATTEMPT_LIMIT = 5;
export const JUDGE_WINDOW_MS = 10 * 60 * 1000;

type Window = { failures: number; until: number };

const windows = new Map<string, Window>();

function evictStale(now: number) {
  for (const [key, held] of windows) {
    if (held.until <= now) windows.delete(key);
  }
}

function open(key: string, limit: number, now: number): boolean {
  const held = windows.get(key);
  if (!held || held.until <= now) return true;
  return held.failures < limit;
}

function fail(key: string, windowMs: number, now: number) {
  const held = windows.get(key);
  if (!held || held.until <= now) {
    windows.set(key, { failures: 1, until: now + windowMs });
    return;
  }
  held.failures += 1;
}

export function passwordAttemptsOpen(
  keys: readonly (string | null | undefined)[],
  now = Date.now(),
): boolean {
  evictStale(now);
  return keys
    .filter((key): key is string => Boolean(key))
    .every((key) => open(`password:${key}`, PASSWORD_ATTEMPT_LIMIT, now));
}

export function recordPasswordFailure(
  keys: readonly (string | null | undefined)[],
  now = Date.now(),
) {
  for (const key of keys) {
    if (key) fail(`password:${key}`, PASSWORD_WINDOW_MS, now);
  }
}

export function judgeAttemptsOpen(ip: string | null | undefined, now = Date.now()): boolean {
  evictStale(now);
  if (!ip) return true;
  return open(`judge:${ip}`, JUDGE_ATTEMPT_LIMIT, now);
}

export function recordJudgeFailure(ip: string | null | undefined, now = Date.now()) {
  console.warn(`judges code rejected from ${ip ?? "an unknown address"}`);
  if (ip) fail(`judge:${ip}`, JUDGE_WINDOW_MS, now);
}

export function throttleKeyEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function requestIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip") || null;
}

export function forgetThrottles() {
  windows.clear();
}
