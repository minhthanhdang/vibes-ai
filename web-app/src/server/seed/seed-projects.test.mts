import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { SEEDS, analysisColumns, referenceColumns, seedJudgeProjects, seedProjectsFor } =
  await import("./seed-projects");

function client({ held }: { held: number }) {
  const calls = { projects: [] as unknown[], references: [] as { gcsUri: string }[], analyses: [] as unknown[] };
  const db = {
    project: {
      count: async () => held,
      create: async ({ data }: { data: unknown }) => {
        calls.projects.push(data);
        return { id: `p${calls.projects.length}` };
      },
    },
    reference: {
      createMany: async ({ data }: { data: { gcsUri: string }[] }) => {
        calls.references.push(...data);
        return { count: data.length };
      },
      findMany: async () => calls.references.map((row, at) => ({ id: `r${at}`, gcsUri: row.gcsUri })),
    },
    analysis: {
      createMany: async ({ data }: { data: unknown[] }) => {
        calls.analyses.push(...data);
        return { count: data.length };
      },
    },
  };
  return { calls, db: db as never };
}

test("every seed carries a title, a brief and analysed references", () => {
  assert.ok(SEEDS.length > 0);
  for (const seed of SEEDS) {
    assert.ok(seed.title.length > 0, `${seed.slug} has no title`);
    assert.ok(seed.brief.length > 0, `${seed.slug} has no brief`);
    assert.ok(seed.references.length > 0, `${seed.slug} has no references`);
    for (const reference of seed.references) {
      assert.ok(reference.object.startsWith("seeds/"), reference.object);
      assert.ok(reference.analysis, `${reference.object} was never analysed`);
    }
  }
});

test("a reference points at the shared seed object, never at a project upload", () => {
  const columns = referenceColumns(SEEDS[0].references[0], "p1");
  assert.ok(columns.gcsUri.startsWith("gs://test-bucket/seeds/"));
  assert.ok(!columns.gcsUri.includes("/projects/"));
});

test("an analysis is matched to the row filed for its own object", () => {
  const seed = SEEDS[0];
  const filed = seed.references.map((reference, at) => ({
    id: `r${at}`,
    gcsUri: referenceColumns(reference, "p1").gcsUri,
  }));
  const analyses = analysisColumns(seed, filed.toReversed());
  assert.equal(analyses.length, seed.references.length);
  assert.equal(analyses[0].referenceId, "r0");
  assert.equal(analyses[0].title, seed.references[0].analysis?.title);
});

test("a row the database did not file takes no analysis with it", () => {
  assert.deepEqual(analysisColumns(SEEDS[0], []), []);
});

test("an account holding nothing is seeded every project on the list", async () => {
  const { calls, db } = client({ held: 0 });
  const seeded = await seedProjectsFor(db, "u1");
  assert.equal(seeded.length, SEEDS.length);
  assert.equal(calls.references.length, SEEDS[0].references.length);
  assert.equal(calls.analyses.length, SEEDS[0].references.length);
});

test("an account that already holds a project is left alone", async () => {
  const { calls, db } = client({ held: 1 });
  assert.deepEqual(await seedProjectsFor(db, "u1"), []);
  assert.equal(calls.projects.length, 0);
});

test("a seed that cannot be written does not take the signup down with it", async () => {
  const db = {
    project: {
      count: async () => 0,
      create: async () => {
        throw new Error("the database said no");
      },
    },
  };
  assert.deepEqual(await seedJudgeProjects(db as never, "u1"), []);
});
