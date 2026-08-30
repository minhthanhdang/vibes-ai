import { test } from "node:test";
import assert from "node:assert/strict";

import { VIBES_PAGE_LIMIT } from "@/lib/vibes/vibes-brief";
import type { VibesRunPage } from "@/lib/vibes/vibes-resume";
import {
  VIBES_LEASE_MS,
  VIBES_WORKER_JOB_LIMIT,
  isVibesLeaseExpired,
  nextChainPage,
  vibesJob,
  vibesLeaseExpiryCutoff,
} from "./vibes-queue";

const NOW = new Date("2026-08-28T12:00:00.000Z");

test("a well-formed job comes back trimmed, as designPage's own arguments", () => {
  assert.deepEqual(vibesJob({ boardId: " board-1 ", pageId: "page-1", index: 0 }), {
    boardId: "board-1",
    pageId: "page-1",
    index: 0,
  });
  assert.deepEqual(vibesJob({ boardId: "b", pageId: "p", index: VIBES_PAGE_LIMIT - 1 }), {
    boardId: "b",
    pageId: "p",
    index: VIBES_PAGE_LIMIT - 1,
  });
});

test("a row that cannot name its page is unrunnable, not retryable", () => {
  assert.equal(vibesJob(null), null);
  assert.equal(vibesJob("a string"), null);
  assert.equal(vibesJob(["board-1", "page-1", 0]), null);
  assert.equal(vibesJob({ pageId: "p", index: 0 }), null);
  assert.equal(vibesJob({ boardId: "  ", pageId: "p", index: 0 }), null);
  assert.equal(vibesJob({ boardId: "b", pageId: "", index: 0 }), null);
  assert.equal(vibesJob({ boardId: "b", pageId: "p" }), null);
  assert.equal(vibesJob({ boardId: "b", pageId: "p", index: 1.5 }), null);
  assert.equal(vibesJob({ boardId: "b", pageId: "p", index: -1 }), null);
  assert.equal(vibesJob({ boardId: "b", pageId: "p", index: VIBES_PAGE_LIMIT }), null);
  assert.equal(vibesJob({ boardId: "b", pageId: "p", index: "0" }), null);
});

test("the lease restarts from the claim's own stamp, with the margin a design page needs", () => {
  assert.equal(VIBES_LEASE_MS, 20 * 60 * 1000);
  assert.equal(
    vibesLeaseExpiryCutoff(NOW).getTime(),
    NOW.getTime() - VIBES_LEASE_MS,
  );
  assert.equal(isVibesLeaseExpired(new Date(NOW.getTime() - VIBES_LEASE_MS), NOW), true);
  assert.equal(
    isVibesLeaseExpired(new Date(NOW.getTime() - VIBES_LEASE_MS + 1), NOW),
    false,
    "a row still inside its lease belongs to the worker that claimed it",
  );
});

test("one job per invocation, so two design pages can never share one maxDuration", () => {
  assert.equal(VIBES_WORKER_JOB_LIMIT, 1);
});

const runOf = (...designed: boolean[]): VibesRunPage[] =>
  designed.map((done, index) => ({ pageId: `page-${index + 1}`, index, designed: done }));

test("the chain hands over the next page of the run, designed or not", () => {
  const run = runOf(true, false, true);
  assert.deepEqual(nextChainPage(run, 0), run[1]);
  assert.deepEqual(nextChainPage(run, 1), run[2]);
});

test("the board's last page ends the chain", () => {
  const run = runOf(false, false);
  assert.equal(nextChainPage(run, 1), null);
  assert.equal(nextChainPage(run, 5), null);
  assert.equal(nextChainPage([], 0), null);
});
