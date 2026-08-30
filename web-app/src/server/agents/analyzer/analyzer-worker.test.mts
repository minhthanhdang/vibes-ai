import { test } from "node:test";
import assert from "node:assert/strict";

import { ANALYZER_LEASE_MS, RUN_ERROR_LIMIT, WORKER_JOB_LIMIT } from "@/lib/analysis/analyzer-queue";
import {
  claimAnalyzerRun,
  drainAnalyzerQueue,
  runAnalyzerRun,
  type AnalyzerWorkerDb,
  type AnalyzerWorkerDeps,
  type ClaimedRun,
} from "./analyzer-worker";

const NOW = new Date("2026-08-16T12:00:00.000Z");
const CLAIMED_AT = new Date("2026-08-16T12:00:01.000Z");

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
type FinishArgs = {
  where: { id: string };
  data: { status: string; error: string | null; output?: unknown };
};
type UpsertArgs = {
  where: { referenceId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};
type FindFirstArgs = {
  where: { id: string; projectId: string };
  select: Record<string, boolean>;
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
      update: record("agentRun", "update", {}),
    },
    reference: { findFirst: record("reference", "findFirst", null) },
    analysis: { upsert: record("analysis", "upsert", {}) },
  } as unknown as AnalyzerWorkerDb;

  return {
    db,
    calls,
    of: <T,>(table: string, op: string) =>
      calls.filter((c) => c.table === table && c.op === op).map((c) => c.args as T),
  };
}

const properties = {
  title: "Man alone in a lit corridor",
  colorPalette: ["#112233"],
  lighting: ["low-key"],
  texture: [],
  composition: [],
  subject: [],
  contrastDepth: [],
  rationale: "moody",
};

const usage = { promptTokens: 1200, outputTokens: 300, totalTokens: 1500 };

function deps(
  db: AnalyzerWorkerDb,
  analyze: AnalyzerWorkerDeps["analyze"] = async () => ({ model: "gemini-pro", properties, usage }),
): AnalyzerWorkerDeps {
  let issued = 0;
  return {
    db,
    analyze,
    now: () => (issued++ === 0 ? NOW : CLAIMED_AT),
    onFailure: () => {},
  };
}

const queuedRun = (id: string, startedAt: Date): ClaimedRun => ({
  id,
  projectId: "project-1",
  input: { referenceId: `ref-${id}` },
  status: "QUEUED" as ClaimedRun["status"],
  startedAt,
});

test("claim looks for queued rows and running rows past their lease, oldest first", async () => {
  const candidate = queuedRun("run-1", new Date(NOW.getTime() - 1000));
  const { db, of } = fakeDb({ "agentRun.findMany": [[candidate]] });

  const claimed = await claimAnalyzerRun(deps(db));

  assert.deepEqual(claimed, candidate);
  const where = of<FindManyArgs>("agentRun", "findMany")[0].where;
  assert.equal(where.agent, "ANALYZER");
  assert.deepEqual(where.OR[0], { status: "QUEUED" });
  assert.equal(where.OR[1].status, "RUNNING");
  assert.equal(
    where.OR[1].startedAt.lte.getTime(),
    NOW.getTime() - ANALYZER_LEASE_MS,
    "an abandoned RUNNING row is only reclaimable a full lease after it was claimed",
  );
  assert.deepEqual(of<FindManyArgs>("agentRun", "findMany")[0].orderBy, { startedAt: "asc" });
});

test("the claim is a compare-and-set on the exact row it read, and restarts the lease", async () => {
  const candidate = queuedRun("run-1", new Date(NOW.getTime() - 1000));
  const { db, of } = fakeDb({ "agentRun.findMany": [[candidate]] });

  await claimAnalyzerRun(deps(db));

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
  const first = queuedRun("run-1", new Date(NOW.getTime() - 2000));
  const second = queuedRun("run-2", new Date(NOW.getTime() - 1000));
  const { db, of } = fakeDb({
    "agentRun.findMany": [[first, second]],
    "agentRun.updateMany": [{ count: 0 }, { count: 1 }],
  });

  const claimed = await claimAnalyzerRun(deps(db));

  assert.equal(claimed?.id, "run-2");
  assert.equal(of<ClaimArgs>("agentRun", "updateMany").length, 2);
});

test("a queue every candidate was taken from claims nothing instead of double-running one", async () => {
  const { db } = fakeDb({
    "agentRun.findMany": [[queuedRun("run-1", NOW), queuedRun("run-2", NOW)]],
    "agentRun.updateMany": [{ count: 0 }, { count: 0 }],
  });

  assert.equal(await claimAnalyzerRun(deps(db)), null);
});

test("an empty queue claims nothing and attempts no write", async () => {
  const { db, of } = fakeDb();

  assert.equal(await claimAnalyzerRun(deps(db)), null);
  assert.equal(of<ClaimArgs>("agentRun", "updateMany").length, 0);
});

test("a successful run upserts the properties and marks the row succeeded", async () => {
  const { db, of } = fakeDb({
    "reference.findFirst": [
      {
        id: "ref-1",
        gcsUri: "gs://bucket/a.jpg",
        title: "Dune",
        origin: "UPLOADED",
        generationPrompt: null,
      },
    ],
  });
  const seen: unknown[] = [];

  const result = await runAnalyzerRun(
    deps(db, async (input) => {
      seen.push(input);
      return { model: "gemini-pro", properties, usage };
    }),
    { ...queuedRun("run-1", NOW), input: { referenceId: "ref-1" } },
  );

  assert.deepEqual(result, { id: "run-1", ok: true });
  assert.deepEqual(seen, [
    {
      gcsUri: "gs://bucket/a.jpg",
      title: "Dune",
      origin: "UPLOADED",
      generationPrompt: null,
    },
  ]);

  const upsert = of<UpsertArgs>("analysis", "upsert")[0];
  assert.deepEqual(upsert.where, { referenceId: "ref-1" });
  assert.deepEqual(upsert.create, { referenceId: "ref-1", model: "gemini-pro", ...properties });
  assert.deepEqual(upsert.update, { model: "gemini-pro", ...properties });

  const done = of<FinishArgs>("agentRun", "update")[0];
  assert.deepEqual(done.where, { id: "run-1" });
  assert.equal(done.data.status, "SUCCEEDED");
  assert.equal(done.data.error, null);
  assert.deepEqual(done.data.output, { referenceId: "ref-1", model: "gemini-pro" });
});

test("a drawn picture reaches the analyzer as one, with the words it was drawn from", async () => {
  const { db, of } = fakeDb({
    "reference.findFirst": [
      {
        id: "ref-1",
        gcsUri: "gs://bucket/a.png",
        title: "A warm grey paper texture",
        origin: "GENERATED",
        generationPrompt: "A warm grey paper texture, lit flat, no grain",
      },
    ],
  });
  const seen: unknown[] = [];

  await runAnalyzerRun(
    deps(db, async (input) => {
      seen.push(input);
      return { model: "gemini-pro", properties, usage };
    }),
    { ...queuedRun("run-1", NOW), input: { referenceId: "ref-1" } },
  );

  assert.deepEqual(seen, [
    {
      gcsUri: "gs://bucket/a.png",
      title: "A warm grey paper texture",
      origin: "GENERATED",
      generationPrompt: "A warm grey paper texture, lit flat, no grain",
    },
  ]);
  assert.deepEqual(
    of<FindFirstArgs>("reference", "findFirst")[0].select,
    { id: true, gcsUri: true, title: true, origin: true, generationPrompt: true },
    "the one reference read that names its columns by hand has to name the two the ask is worded from",
  );
});

test("the reference lookup is scoped to the run's own project", async () => {
  const { db, of } = fakeDb({
    "reference.findFirst": [{ id: "ref-1", gcsUri: "gs://bucket/a.jpg", title: "" }],
  });

  await runAnalyzerRun(deps(db), { ...queuedRun("run-1", NOW), projectId: "project-9" });

  assert.deepEqual(of<FindFirstArgs>("reference", "findFirst")[0].where, {
    id: "ref-run-1",
    projectId: "project-9",
  });
});

test("a job that names no reference fails without paying for a vision call", async () => {
  const { db, of } = fakeDb();
  let analyzed = 0;

  const result = await runAnalyzerRun(
    deps(db, async () => {
      analyzed++;
      return { model: "gemini-pro", properties, usage };
    }),
    { ...queuedRun("run-1", NOW), input: { note: "not a job" } },
  );

  assert.deepEqual(result, { id: "run-1", ok: false });
  assert.equal(analyzed, 0);
  assert.equal(of<FindFirstArgs>("reference", "findFirst").length, 0, "an unrunnable job must not hit the db");
  const failed = of<FinishArgs>("agentRun", "update")[0].data;
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.error, "analyzer job names no reference");
});

test("a reference deleted between queue and claim fails the run rather than throwing", async () => {
  const { db, of } = fakeDb({ "reference.findFirst": [null] });

  const result = await runAnalyzerRun(deps(db), queuedRun("run-1", NOW));

  assert.deepEqual(result, { id: "run-1", ok: false });
  assert.equal(of<FinishArgs>("agentRun", "update")[0].data.error, "reference no longer exists");
});

test("a throttling response's HTML body is flattened and truncated into the run's error", async () => {
  const { db, of } = fakeDb({
    "reference.findFirst": [{ id: "ref-1", gcsUri: "gs://bucket/a.jpg", title: null }],
  });
  const html = `<html>\n  <body>\n${"    <p>rate limited</p>\n".repeat(60)}  </body>\n</html>`;

  const result = await runAnalyzerRun(
    deps(db, async () => {
      throw new Error(html);
    }),
    queuedRun("run-1", NOW),
  );

  assert.equal(result.ok, false);
  const error = of<FinishArgs>("agentRun", "update")[0].data.error ?? "";
  assert.equal(error.length, RUN_ERROR_LIMIT);
  assert.ok(!error.includes("\n"), "a multi-line body must not be stored as a wall of markup");
  assert.equal(of<UpsertArgs>("analysis", "upsert").length, 0, "a failed call must not write empty properties");
});

test("draining runs jobs one at a time until the queue is empty", async () => {
  const { db, of } = fakeDb({
    "agentRun.findMany": [[queuedRun("run-1", NOW)], [queuedRun("run-2", NOW)], []],
    "reference.findFirst": [
      { id: "ref-1", gcsUri: "gs://bucket/a.jpg", title: null },
      null,
    ],
  });

  const result = await drainAnalyzerQueue({ ...deps(db), now: () => NOW });

  assert.deepEqual(result, { processed: 2, succeeded: 1, failed: 1, drained: true });
  assert.equal(of<FindManyArgs>("agentRun", "findMany").length, 3, "the drain stops on the first empty claim");
});

test("a backlog deeper than the cap is left for the next invocation", async () => {
  const findMany = Array.from({ length: WORKER_JOB_LIMIT + 3 }, (_, i) => [
    queuedRun(`run-${i}`, NOW),
  ]);
  const { db, of } = fakeDb({
    "agentRun.findMany": findMany,
    "reference.findFirst": Array.from({ length: WORKER_JOB_LIMIT + 3 }, () => ({
      id: "ref-1",
      gcsUri: "gs://bucket/a.jpg",
      title: null,
    })),
  });

  const result = await drainAnalyzerQueue({ ...deps(db), now: () => NOW });

  assert.equal(result.processed, WORKER_JOB_LIMIT);
  assert.equal(of<FindManyArgs>("agentRun", "findMany").length, WORKER_JOB_LIMIT);
  assert.equal(result.drained, false, "stopping at the cap says nothing about what is left");
});

test("a kick that takes its one job does not report the queue as empty", async () => {
  const { db } = fakeDb({
    "agentRun.findMany": [[queuedRun("run-1", NOW)]],
    "reference.findFirst": [{ id: "ref-1", gcsUri: "gs://bucket/a.jpg", title: null }],
  });

  const result = await drainAnalyzerQueue({ ...deps(db), now: () => NOW }, 1);

  assert.deepEqual(result, { processed: 1, succeeded: 1, failed: 0, drained: false });
});

test("an invocation that finds nothing reports the queue as empty", async () => {
  const { db } = fakeDb({ "agentRun.findMany": [[]] });

  const result = await drainAnalyzerQueue({ ...deps(db), now: () => NOW });

  assert.deepEqual(result, { processed: 0, succeeded: 0, failed: 0, drained: true });
});

test("a caller asking for one job gets one, and asking for more than the cap does not raise it", async () => {
  const claim = () => [queuedRun("run-1", NOW)];
  const one = fakeDb({
    "agentRun.findMany": [claim(), claim()],
    "reference.findFirst": [null, null],
  });
  const many = fakeDb({
    "agentRun.findMany": Array.from({ length: 20 }, claim),
    "reference.findFirst": Array.from({ length: 20 }, () => null),
  });

  assert.equal((await drainAnalyzerQueue({ ...deps(one.db), now: () => NOW }, 1)).processed, 1);
  assert.equal(
    (await drainAnalyzerQueue({ ...deps(many.db), now: () => NOW }, 999)).processed,
    WORKER_JOB_LIMIT,
  );
});
