import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANALYZER_LEASE_MS,
  RUN_ERROR_LIMIT,
  WORKER_JOB_LIMIT,
  analyzerJob,
  isLeaseExpired,
  leaseExpiryCutoff,
  requestedJobLimit,
  runErrorMessage,
  shouldEnqueueAnalysis,
  workerJobLimit,
} from "@/lib/analysis/analyzer-queue";

test("a job names its reference", () => {
  assert.deepEqual(analyzerJob({ referenceId: "ref_1" }), { referenceId: "ref_1" });
  assert.deepEqual(analyzerJob({ referenceId: " ref_1 ", extra: 3 }), { referenceId: "ref_1" });
});

test("input that cannot name a reference is not a job", () => {
  for (const input of [
    {},
    { referenceId: "" },
    { referenceId: "   " },
    { referenceId: 7 },
    { referenceId: null },
    ["ref_1"],
    "ref_1",
    null,
    undefined,
  ]) {
    assert.equal(analyzerJob(input), null, `${JSON.stringify(input)} should not be a job`);
  }
});

test("a lease expires only once it is older than the window", () => {
  const now = new Date("2026-08-16T12:00:00Z");
  const justInside = new Date(now.getTime() - ANALYZER_LEASE_MS + 1000);
  const justOutside = new Date(now.getTime() - ANALYZER_LEASE_MS - 1000);

  assert.equal(isLeaseExpired(justInside, now), false);
  assert.equal(isLeaseExpired(justOutside, now), true);
  /// A worker that started this instant must never be reclaimed by the next
  /// invocation, which is the whole point of the lease.
  assert.equal(isLeaseExpired(now, now), false);
});

test("the cutoff a query filters on matches the predicate", () => {
  const now = new Date("2026-08-16T12:00:00Z");
  const cutoff = leaseExpiryCutoff(now, 60_000);
  assert.equal(cutoff.getTime(), now.getTime() - 60_000);
  assert.equal(isLeaseExpired(cutoff, now, 60_000), true);
});

test("a worker never takes more than the cap, or fewer than one job", () => {
  assert.equal(workerJobLimit(), WORKER_JOB_LIMIT);
  assert.equal(workerJobLimit(2), 2);
  assert.equal(workerJobLimit(WORKER_JOB_LIMIT + 50), WORKER_JOB_LIMIT);
  assert.equal(workerJobLimit(0), 1);
  assert.equal(workerJobLimit(-4), 1);
  assert.equal(workerJobLimit(2.9), 2);
  assert.equal(workerJobLimit(Number.NaN), WORKER_JOB_LIMIT);
});

/// The scheduler posts the bare URL, so the absent param is the common case and
/// it has to reach `workerJobLimit` as "no preference". Anything that arrives as
/// 0 there is read as a request for a single job, which would drain a backlog
/// one image per tick.
test("a missing or unreadable limit param is no preference, not a request for none", () => {
  for (const param of [null, undefined, "", "   ", "abc", "Infinity"]) {
    assert.equal(requestedJobLimit(param), undefined, `${String(param)} should express no preference`);
    assert.equal(workerJobLimit(requestedJobLimit(param)), WORKER_JOB_LIMIT);
  }
});

test("a limit param the caller did write is honoured within the cap", () => {
  assert.equal(requestedJobLimit("2"), 2);
  assert.equal(workerJobLimit(requestedJobLimit("2")), 2);
  assert.equal(workerJobLimit(requestedJobLimit("999")), WORKER_JOB_LIMIT);
  assert.equal(workerJobLimit(requestedJobLimit("0")), 1);
});

test("a run error is one readable line whatever was thrown", () => {
  assert.equal(runErrorMessage(new Error("analyzer returned no content")), "analyzer returned no content");
  assert.equal(runErrorMessage("plain string"), "plain string");
  assert.equal(runErrorMessage({ code: 500 }), "[object Object]");
  assert.equal(runErrorMessage(new Error("  spaced\n\tout  ")), "spaced out");
});

test("an HTML throttling body is truncated rather than stored whole", () => {
  const html = `<html>${"<p>overloaded</p>".repeat(200)}</html>`;
  const message = runErrorMessage(html);
  assert.equal(message.length, RUN_ERROR_LIMIT);
  assert.ok(message.endsWith("…"));
});

test("an empty failure still says something", () => {
  assert.equal(runErrorMessage(new Error("")), "analysis failed");
  assert.equal(runErrorMessage("   "), "analysis failed");
});

test("a re-analysis is only a new job when no job is already in flight", () => {
  assert.ok(shouldEnqueueAnalysis(null));
  assert.ok(shouldEnqueueAnalysis({ status: "FAILED" }));
  assert.ok(shouldEnqueueAnalysis({ status: "SUCCEEDED" }));
});

/// Clicking twice while the queue is busy must not buy a second vision call —
/// and a RUNNING row whose worker died is reclaimed by `claimAnalyzerRun`, not
/// replaced, so it is not re-queued either.
test("a job already queued or running is the job", () => {
  assert.ok(!shouldEnqueueAnalysis({ status: "QUEUED" }));
  assert.ok(!shouldEnqueueAnalysis({ status: "RUNNING" }));
});
