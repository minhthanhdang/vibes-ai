import { test } from "node:test";
import assert from "node:assert/strict";

import { designRunOutput, designRunsRead, type DesignRun } from "@/lib/agent/designer/design-runs";

const LIMITS = { rounds: 12, pictures: 8 };

/// A row the way `design.ts` writes one, with only the keys that iteration
/// wrote — the absences are the point, so nothing is filled in here that a real
/// row would omit.
const run = (output: Record<string, unknown>, status = "SUCCEEDED"): DesignRun => ({
  status,
  output,
});

test("a row's counts come back as they were written", () => {
  assert.deepEqual(
    designRunOutput({
      line: "done",
      calls: ["get_skill", "read_canvas"],
      rounds: 7,
      modelCalls: 8,
      pictures: 6,
      picturesDropped: 2,
      roundsDropped: 2,
      renders: { made: 2, cached: 1, failed: 0 },
    }),
    {
      rounds: 7,
      modelCalls: 8,
      pictures: 6,
      picturesRefused: 0,
      picturesDropped: 2,
      roundsDropped: 2,
      stopped: null,
      renders: { made: 2, cached: 1, failed: 0 },
      calls: ["get_skill", "read_canvas"],
      skills: [],
    },
  );
});

test("a row this cannot make sense of reads as a design that said nothing", () => {
  /// Every design ever run is in this ledger, including the ones written before
  /// a key existed. A census that throws on the oldest row is a census nobody
  /// can take.
  for (const value of [null, undefined, "an answer", 7, [], { renders: "some" }]) {
    const output = designRunOutput(value);
    assert.equal(output.rounds, null);
    assert.equal(output.renders, null);
    assert.deepEqual(output.calls, []);
    assert.deepEqual(output.skills, []);
  }
});

test("a partial render tally is no tally", () => {
  /// A hit rate over a denominator missing its misses is a hit rate that reads
  /// better than the cache is.
  assert.equal(designRunOutput({ renders: { made: 2, cached: 1 } }).renders, null);
  assert.equal(designRunOutput({ renders: { made: 2, cached: 1, failed: -1 } }).renders, null);
});

test("the hit rate counts a cache hit against the draws, and failures against neither", () => {
  const read = designRunsRead(
    [
      run({ renders: { made: 3, cached: 1, failed: 0 } }),
      run({ renders: { made: 0, cached: 2, failed: 2 } }),
    ],
    LIMITS,
  );
  assert.deepEqual(read.renders, { runs: 2, made: 3, cached: 3, failed: 2, hitRate: 0.5 });
});

test("a design that never looked is filtered out of the render read, not summed in", () => {
  const read = designRunsRead(
    [run({ rounds: 4 }), run({ renders: { made: 2, cached: 0, failed: 0 } })],
    LIMITS,
  );
  assert.equal(read.renders.runs, 1);
  assert.equal(read.renders.hitRate, 0);
});

test("nothing drawn anywhere is an unknown hit rate rather than a zero one", () => {
  assert.equal(designRunsRead([run({ rounds: 4 })], LIMITS).renders.hitRate, null);
});

test("a ceiling read is over the rows that answered", () => {
  /// The two FAILED rows on the real ledger carry a render tally and no rounds.
  /// A mean over the whole ledger would divide the designs' rounds by the rows.
  const read = designRunsRead(
    [
      run({ rounds: 4, pictures: 2 }),
      run({ rounds: 12, pictures: 5 }),
      run({ renders: { made: 0, cached: 1, failed: 0 } }, "FAILED"),
    ],
    LIMITS,
  );
  assert.deepEqual(read.rounds, { limit: 12, runs: 2, max: 12, mean: 8, atLimit: 1 });
  assert.deepEqual(read.pictures, { limit: 8, runs: 2, max: 5, mean: 3.5, atLimit: 0 });
});

test("the rounds ceiling is reported as reached only where the loop stopped the model", () => {
  /// A design that finishes on its twelfth round finished. Only `stopped` says
  /// the ceiling took the work away.
  const read = designRunsRead(
    [run({ rounds: 12 }), run({ rounds: 12, stopped: "rounds" })],
    LIMITS,
  );
  assert.equal(read.rounds.atLimit, 2);
  assert.equal(read.stoppedOnRounds, 1);
});

test("refused and dropped pictures are counted apart", () => {
  /// A drop is the ordinary case and the whole cost lever; a refusal is the
  /// model asking to look and being answered in words.
  const read = designRunsRead(
    [
      run({ pictures: 8, picturesDropped: 5, picturesRefused: 2 }),
      run({ pictures: 3, picturesDropped: 1 }),
    ],
    LIMITS,
  );
  assert.equal(read.picturesRefused, 2);
  assert.equal(read.picturesDropped, 6);
  assert.equal(read.pictures.atLimit, 1);
});

test("statuses are counted, commonest first", () => {
  const read = designRunsRead([run({}, "FAILED"), run({}), run({}), run({}, "RUNNING")], LIMITS);
  assert.deepEqual(read.byStatus, [
    { status: "SUCCEEDED", runs: 2 },
    { status: "FAILED", runs: 1 },
    { status: "RUNNING", runs: 1 },
  ]);
  assert.equal(read.runs, 4);
});

test("a tool called twice in one design is two calls in one run", () => {
  const read = designRunsRead(
    [run({ calls: ["get_page", "get_page", "put_on_canvas"] }), run({ calls: ["get_page"] })],
    LIMITS,
  );
  assert.deepEqual(read.calls, [
    { name: "get_page", calls: 3, runs: 2 },
    { name: "put_on_canvas", calls: 1, runs: 1 },
  ]);
});

test("an empty ledger reads as empty rather than as NaN", () => {
  const read = designRunsRead([], LIMITS);
  assert.deepEqual(read.rounds, { limit: 12, runs: 0, max: 0, mean: 0, atLimit: 0 });
  assert.equal(read.renders.hitRate, null);
  assert.deepEqual(read.calls, []);
});

/// Which skills a design really read. The skill is one of the three
/// guards the spec leaves standing against an ugly page, and it is the only one
/// no row named until this key — so the reading has to be over the designs that
/// recorded it rather than over the whole ledger, or every row written before
/// it drags the share of every skill down.

test("the skills a design read come back as they were written", () => {
  const output = designRunOutput({ skills: ["wedding-designer", "typography", 7] });
  assert.deepEqual(output.skills, ["wedding-designer", "typography"]);
});

test("a design is counted once per skill, however often the name appears", () => {
  const { skills } = designRunsRead(
    [run({ skills: ["typography", "typography"] }), run({ skills: ["typography"] })],
    LIMITS,
  );

  assert.deepEqual(skills.read, [{ name: "typography", runs: 2 }]);
});

test("the skills read are ranked, commonest first", () => {
  const { skills } = designRunsRead(
    [
      run({ skills: ["typography", "composition"] }),
      run({ skills: ["typography", "grid-systems"] }),
      run({ skills: ["typography"] }),
    ],
    LIMITS,
  );

  assert.deepEqual(skills.read, [
    { name: "typography", runs: 3 },
    { name: "composition", runs: 1 },
    { name: "grid-systems", runs: 1 },
  ]);
});

test("a row from before the key is a design that said nothing about skills", () => {
  /// Not a design that read none: the denominator is the rows that answered,
  /// exactly as the render tally filters out the designs that never looked.
  const { skills, runs } = designRunsRead(
    [run({ rounds: 4 }), run({ rounds: 5 }), run({ skills: ["banner-designer"] })],
    LIMITS,
  );

  assert.equal(runs, 3);
  assert.equal(skills.runs, 1);
  assert.deepEqual(skills.read, [{ name: "banner-designer", runs: 1 }]);
});
