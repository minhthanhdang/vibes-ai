import { test } from "node:test";
import assert from "node:assert/strict";

import { RUN_ERROR_LIMIT } from "@/lib/analysis/analyzer-queue";
import { VIBES_LEASE_MS } from "@/lib/vibes/vibes-queue";
import { vibesBrief } from "@/lib/vibes/vibes-brief";
import { vibesBoard } from "@/lib/vibes/vibes-start";
import { boardPages } from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";
import type { VibesOutcome } from "@/server/agents/vibes/run-vibes-page";
import {
  claimVibesRun,
  drainVibesQueue,
  runClaimedVibesJob,
  type ClaimedVibesRun,
  type VibesWorkerDb,
  type VibesWorkerDeps,
} from "./vibes-worker";

const NOW = new Date("2026-08-28T12:00:00.000Z");
const CLAIMED_AT = new Date("2026-08-28T12:00:01.000Z");

type Call = { table: string; op: string; args: unknown };

type FindManyArgs = {
  where: {
    agent: string;
    OR: [{ status: string }, { status: string; startedAt: { lte: Date } }];
  };
  orderBy: { startedAt: string };
};
type ClaimArgs = {
  where: { id: string; status: string; startedAt: Date };
  data: { status: string; startedAt: Date; error: null };
};
type SettleArgs = {
  where: { id: string; status: string; startedAt: Date };
  data: { status: string; output?: unknown; error: string | null };
};
type EnqueueArgs = {
  data: { projectId: string; agent: string; status: string; input: unknown };
};

function fakeDb(answers: Partial<Record<string, unknown[]>> = {}) {
  const calls: Call[] = [];
  const queues: Partial<Record<string, unknown[]>> = { ...answers };
  const answer = (key: string, fallback: unknown) =>
    queues[key]?.length ? queues[key].shift() : fallback;

  const record = (table: string, op: string, fallback: unknown) => (args: unknown) => {
    calls.push({ table, op, args });
    const value = answer(`${table}.${op}`, fallback);
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };

  const db = {
    agentRun: {
      findMany: record("agentRun", "findMany", []),
      updateMany: record("agentRun", "updateMany", { count: 1 }),
      create: record("agentRun", "create", { id: "chained" }),
    },
    moodboard: { findUnique: record("moodboard", "findUnique", null) },
    $transaction: (work: (tx: unknown) => Promise<unknown>) =>
      work({
        agentRun: {
          updateMany: record("tx.agentRun", "updateMany", { count: 1 }),
          create: record("tx.agentRun", "create", { id: "chained" }),
        },
      }),
  } as unknown as VibesWorkerDb;

  return {
    db,
    calls,
    of: <T,>(table: string, op: string) =>
      calls.filter((c) => c.table === table && c.op === op).map((c) => c.args as T),
  };
}

const brief = vibesBrief({
  purpose: "Launch deck",
  pages: 3,
  palette: ["#112233"],
  vibes: "",
  width: 2048,
  height: 2048,
})!;

let issuedIds = 0;
const board = vibesBoard({ brief, makeId: () => `el-${issuedIds++}` });
const [pageOne, pageTwo, pageThree] = board.pageIds;

const markOn = (pageId: string): SceneElement => {
  const page = boardPages(board.elements).find((candidate) => candidate.id === pageId)!;
  return {
    id: `mark-${pageId}`,
    type: "rectangle",
    x: page.x + 10,
    y: page.y + 10,
    width: 40,
    height: 40,
  } as unknown as SceneElement;
};

const blankBoardRow = { elements: board.elements, vibesBrief: brief };
const pageOneDesignedRow = { elements: [...board.elements, markOn(pageOne!)], vibesBrief: brief };

const designedAnswer: VibesOutcome = {
  pageId: pageOne!,
  line: "Done — a title spread.",
  empty: false,
  calls: ["put_on_canvas"],
  runId: "designer-run-1",
};

function deps(
  db: VibesWorkerDb,
  runPage: VibesWorkerDeps["runPage"] = async () => designedAnswer,
): VibesWorkerDeps {
  let issued = 0;
  return {
    db,
    runPage,
    now: () => (issued++ === 0 ? NOW : CLAIMED_AT),
    onFailure: () => {},
  };
}

const queuedRow = (id: string, startedAt: Date) => ({
  id,
  projectId: "project-1",
  input: { boardId: "board-1", pageId: pageOne, index: 0 },
  status: "QUEUED",
  startedAt,
});

const claimed = (input: unknown): ClaimedVibesRun => ({
  id: "run-1",
  projectId: "project-1",
  input,
  claimedAt: CLAIMED_AT,
});

test("claim looks for queued VIBES rows and running rows past their lease, oldest first", async () => {
  const candidate = queuedRow("run-1", new Date(NOW.getTime() - 1000));
  const { db, of } = fakeDb({ "agentRun.findMany": [[candidate]] });

  const won = await claimVibesRun(deps(db));

  assert.deepEqual(won, {
    id: "run-1",
    projectId: "project-1",
    input: candidate.input,
    claimedAt: CLAIMED_AT,
  });
  const where = of<FindManyArgs>("agentRun", "findMany")[0].where;
  assert.equal(where.agent, "VIBES");
  assert.deepEqual(where.OR[0], { status: "QUEUED" });
  assert.equal(where.OR[1].status, "RUNNING");
  assert.equal(
    where.OR[1].startedAt.lte.getTime(),
    NOW.getTime() - VIBES_LEASE_MS,
    "an abandoned RUNNING row is only reclaimable a full lease after it was claimed",
  );
  assert.deepEqual(of<FindManyArgs>("agentRun", "findMany")[0].orderBy, { startedAt: "asc" });
});

test("the claim is a compare-and-set on the exact row it read, and restarts the lease", async () => {
  const candidate = queuedRow("run-1", new Date(NOW.getTime() - 1000));
  const { db, of } = fakeDb({ "agentRun.findMany": [[candidate]] });

  await claimVibesRun(deps(db));

  const claim = of<ClaimArgs>("agentRun", "updateMany")[0];
  assert.deepEqual(claim.where, {
    id: "run-1",
    status: "QUEUED",
    startedAt: candidate.startedAt,
  });
  assert.equal(claim.data.status, "RUNNING");
  assert.equal(claim.data.startedAt.getTime(), CLAIMED_AT.getTime());
  assert.equal(claim.data.error, null, "a reclaimed row must not keep the dead worker's error");
});

test("losing the race on one row moves to the next candidate rather than giving up", async () => {
  const first = queuedRow("run-1", new Date(NOW.getTime() - 2000));
  const second = queuedRow("run-2", new Date(NOW.getTime() - 1000));
  const { db, of } = fakeDb({
    "agentRun.findMany": [[first, second]],
    "agentRun.updateMany": [{ count: 0 }, { count: 1 }],
  });

  const won = await claimVibesRun(deps(db));

  assert.equal(won?.id, "run-2");
  assert.equal(of<ClaimArgs>("agentRun", "updateMany").length, 2);
});

test("an empty queue claims nothing and attempts no write", async () => {
  const { db, of } = fakeDb();

  assert.equal(await claimVibesRun(deps(db)), null);
  assert.equal(of<ClaimArgs>("agentRun", "updateMany").length, 0);
});

test("a designed page settles SUCCEEDED and chain-enqueues the next page in the same transaction", async () => {
  const { db, of } = fakeDb({ "moodboard.findUnique": [blankBoardRow] });

  const result = await runClaimedVibesJob(
    deps(db),
    claimed({ boardId: "board-1", pageId: pageOne, index: 0 }),
  );

  assert.deepEqual(result, { id: "run-1", ok: true, chained: true });
  const settle = of<SettleArgs>("tx.agentRun", "updateMany")[0];
  assert.deepEqual(
    settle.where,
    { id: "run-1", status: "RUNNING", startedAt: CLAIMED_AT },
    "only the worker that still owns the row against its own claim stamp may settle it",
  );
  assert.equal(settle.data.status, "SUCCEEDED");
  assert.deepEqual(settle.data.output, { outcome: "designed", runId: "designer-run-1" });

  const next = of<EnqueueArgs>("tx.agentRun", "create")[0];
  assert.equal(next.data.agent, "VIBES");
  assert.equal(next.data.status, "QUEUED");
  assert.deepEqual(next.data.input, { boardId: "board-1", pageId: pageTwo, index: 1 });
});

test("an empty answer settles as empty and the chain still walks on", async () => {
  const { db, of } = fakeDb({ "moodboard.findUnique": [blankBoardRow] });

  await runClaimedVibesJob(
    deps(db, async () => ({ ...designedAnswer, empty: true })),
    claimed({ boardId: "board-1", pageId: pageOne, index: 0 }),
  );

  assert.deepEqual(of<SettleArgs>("tx.agentRun", "updateMany")[0].data.output, {
    outcome: "empty",
    runId: "designer-run-1",
  });
  assert.equal(of<EnqueueArgs>("tx.agentRun", "create").length, 1);
});

test("a refusal settles SUCCEEDED as refused, with its reason, and does not extend the chain", async () => {
  const { db, of } = fakeDb({ "moodboard.findUnique": [blankBoardRow] });

  const result = await runClaimedVibesJob(
    deps(db, async () => ({
      pageId: pageOne!,
      error: "that brief asks for a logo I cannot draw",
    })),
    claimed({ boardId: "board-1", pageId: pageOne, index: 0 }),
  );

  assert.deepEqual(result, { id: "run-1", ok: true, chained: false });
  const settle = of<SettleArgs>("tx.agentRun", "updateMany")[0];
  assert.equal(settle.data.status, "SUCCEEDED");
  assert.deepEqual(settle.data.output, {
    outcome: "refused",
    reason: "that brief asks for a logo I cannot draw",
  });
  assert.equal(
    of<EnqueueArgs>("tx.agentRun", "create").length,
    0,
    "whatever refused page N is almost always still true for page N+1",
  );
});

test("the board's last page settles without enqueueing anything", async () => {
  const { db, of } = fakeDb({ "moodboard.findUnique": [blankBoardRow] });

  const result = await runClaimedVibesJob(
    deps(db, async () => ({ ...designedAnswer, pageId: pageThree! })),
    claimed({ boardId: "board-1", pageId: pageThree, index: 2 }),
  );

  assert.deepEqual(result, { id: "run-1", ok: true, chained: false });
  assert.equal(of<EnqueueArgs>("tx.agentRun", "create").length, 0);
});

test("a page already designed settles with no model call — the reclaim-after-crash case", async () => {
  const { db, of } = fakeDb({ "moodboard.findUnique": [pageOneDesignedRow] });
  let designs = 0;

  const result = await runClaimedVibesJob(
    deps(db, async () => {
      designs++;
      return designedAnswer;
    }),
    claimed({ boardId: "board-1", pageId: pageOne, index: 0 }),
  );

  assert.deepEqual(result, { id: "run-1", ok: true, chained: true });
  assert.equal(designs, 0, "the page is on the board already; a second design call would land on top of it");
  assert.deepEqual(of<SettleArgs>("tx.agentRun", "updateMany")[0].data.output, {
    outcome: "designed",
    alreadyDesigned: true,
  });
  assert.deepEqual(of<EnqueueArgs>("tx.agentRun", "create")[0].data.input, {
    boardId: "board-1",
    pageId: pageTwo,
    index: 1,
  });
});

test("a settle that lost its lease enqueues nothing — the reclaimer's own settle will chain", async () => {
  const { db, of } = fakeDb({
    "moodboard.findUnique": [blankBoardRow],
    "tx.agentRun.updateMany": [{ count: 0 }],
  });

  const result = await runClaimedVibesJob(
    deps(db),
    claimed({ boardId: "board-1", pageId: pageOne, index: 0 }),
  );

  assert.deepEqual(result, { id: "run-1", ok: true, chained: false });
  assert.equal(
    of<EnqueueArgs>("tx.agentRun", "create").length,
    0,
    "two settles both chaining is two jobs spending two design calls on one page",
  );
});

test("a job that names no page fails without reading the board or paying for a design", async () => {
  const { db, of } = fakeDb();
  let designs = 0;

  const result = await runClaimedVibesJob(
    deps(db, async () => {
      designs++;
      return designedAnswer;
    }),
    claimed({ note: "not a job" }),
  );

  assert.deepEqual(result, { id: "run-1", ok: false, chained: false });
  assert.equal(designs, 0);
  assert.equal(of("moodboard", "findUnique").length, 0, "an unrunnable job must not hit the db");
  const failed = of<SettleArgs>("agentRun", "updateMany")[0];
  assert.deepEqual(failed.where, { id: "run-1", status: "RUNNING", startedAt: CLAIMED_AT });
  assert.equal(failed.data.status, "FAILED");
  assert.equal(failed.data.error, "vibes job names no page");
});

test("a board deleted between enqueue and claim fails the run rather than throwing", async () => {
  const { db, of } = fakeDb({ "moodboard.findUnique": [null] });

  const result = await runClaimedVibesJob(
    deps(db),
    claimed({ boardId: "board-1", pageId: pageOne, index: 0 }),
  );

  assert.deepEqual(result, { id: "run-1", ok: false, chained: false });
  assert.match(String(of<SettleArgs>("agentRun", "updateMany")[0].data.error), /board is gone/);
});

test("a board that was never a Vibes run fails the job — this door must not invent a brief", async () => {
  const { db, of } = fakeDb({
    "moodboard.findUnique": [{ elements: board.elements, vibesBrief: null }],
  });

  const result = await runClaimedVibesJob(
    deps(db),
    claimed({ boardId: "board-1", pageId: pageOne, index: 0 }),
  );

  assert.equal(result.ok, false);
  assert.match(
    String(of<SettleArgs>("agentRun", "updateMany")[0].data.error),
    /not started from a Vibes brief/,
  );
});

test("a throwing page run becomes a FAILED row with a flattened, truncated error, and no chain", async () => {
  const { db, of } = fakeDb({ "moodboard.findUnique": [blankBoardRow] });
  const html = `<html>\n  <body>\n${"    <p>rate limited</p>\n".repeat(60)}  </body>\n</html>`;

  const result = await runClaimedVibesJob(
    deps(db, async () => {
      throw new Error(html);
    }),
    claimed({ boardId: "board-1", pageId: pageOne, index: 0 }),
  );

  assert.deepEqual(result, { id: "run-1", ok: false, chained: false });
  const error = String(of<SettleArgs>("agentRun", "updateMany")[0].data.error);
  assert.equal(error.length, RUN_ERROR_LIMIT);
  assert.ok(!error.includes("\n"), "a multi-line body must not be stored as a wall of markup");
  assert.equal(of<EnqueueArgs>("tx.agentRun", "create").length, 0);
});

test("one invocation takes one job — a second design page cannot share its maxDuration", async () => {
  const { db, of } = fakeDb({
    "agentRun.findMany": [[queuedRow("run-1", NOW)], [queuedRow("run-2", NOW)]],
    "moodboard.findUnique": [blankBoardRow],
  });

  const result = await drainVibesQueue({ ...deps(db), now: () => NOW });

  assert.deepEqual(result, { processed: 1, succeeded: 1, failed: 0, drained: false });
  assert.equal(
    of<FindManyArgs>("agentRun", "findMany").length,
    1,
    "the cap is one, so taking a job says nothing about what is left — drained stays false",
  );
});

test("an invocation that finds nothing reports the queue as empty", async () => {
  const { db } = fakeDb({ "agentRun.findMany": [[]] });

  const result = await drainVibesQueue({ ...deps(db), now: () => NOW });

  assert.deepEqual(result, { processed: 0, succeeded: 0, failed: 0, drained: true });
});
