import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { fileVersion } = await import("./file-version");
const { AgentKind, ReferenceOrigin, RunStatus } = await import("@/generated/prisma/enums");

type Written = Record<string, unknown>;

function recorder(id = "cut-1") {
  const references: Written[] = [];
  const jobs: Written[] = [];

  const client = {
    reference: {
      create: async (args: { data: Written; select?: Written }) => {
        references.push(args.data);
        return args.select ? { id, title: args.data.title } : { id, ...args.data };
      },
    },
    agentRun: {
      create: async (args: { data: Written }) => {
        jobs.push(args.data);
        return { id: "job-1" };
      },
    },
  };

  return { references, jobs, client: client as never };
}

const box = { ymin: 100, xmin: 200, ymax: 800, xmax: 900 };

test("a cut is filed under the frame's title and box, with its analyzer job beside it", async () => {
  const db = recorder();

  const filed = await fileVersion(db.client, {
    projectId: "p1",
    source: { id: "frame", title: "Kitchen", origin: ReferenceOrigin.UPLOADED },
    gcsUri: "gs://b/cut.jpg",
    thumbGcsUri: "gs://b/cut-thumb.jpg",
    editIntent: "the range and the shelf above it",
    editRationale: "the counter clutter is not the shot",
    cropBox: box,
    editAspect: "4:3",
    width: 1400,
    height: 1050,
    contentHash: "a".repeat(64),
  });

  assert.equal(filed.id, "cut-1");
  assert.deepEqual(db.references[0], {
    projectId: "p1",
    gcsUri: "gs://b/cut.jpg",
    thumbGcsUri: "gs://b/cut-thumb.jpg",
    title: "Kitchen (crop)",
    width: 1400,
    height: 1050,
    contentHash: "a".repeat(64),
    sourceReferenceId: "frame",
    editIntent: "the range and the shelf above it",
    editRationale: "the counter clutter is not the shot",
    cropBox: [100, 200, 800, 900],
    editAspect: "4:3",
    origin: ReferenceOrigin.UPLOADED,
  });

  assert.deepEqual(db.jobs[0], {
    projectId: "p1",
    agent: AgentKind.ANALYZER,
    status: RunStatus.QUEUED,
    input: { referenceId: "cut-1" },
  });
});

test("a cut inherits where the frame's bytes came from", async () => {
  const db = recorder();

  await fileVersion(db.client, {
    projectId: "p1",
    source: { id: "frame", title: "Sketch", origin: ReferenceOrigin.GENERATED },
    gcsUri: "gs://b/cut.jpg",
    cropBox: box,
  });

  assert.equal(db.references[0]!.origin, ReferenceOrigin.GENERATED);
});

test("a cut nobody said anything about is filed with the columns empty, not absent", async () => {
  const db = recorder();

  await fileVersion(db.client, {
    projectId: "p1",
    source: { id: "frame", title: "  Kitchen  " },
    gcsUri: "gs://b/cut.jpg",
    editIntent: "the range   and\nthe shelf",
    cropBox: box,
  });

  const written = db.references[0]!;
  assert.equal(written.title, "Kitchen (crop)");
  assert.equal(written.editIntent, "the range and the shelf");
  assert.equal(written.editRationale, "");
  assert.equal(written.editAspect, "");
  assert.equal(written.origin, ReferenceOrigin.UPLOADED);
});

test("the columns a caller selects are the ones it is answered with", async () => {
  const db = recorder();

  const filed = await fileVersion(
    db.client,
    {
      projectId: "p1",
      source: { id: "frame", title: "Kitchen" },
      gcsUri: "gs://b/cut.jpg",
      cropBox: box,
    },
    { id: true, title: true },
  );

  assert.deepEqual(filed, { id: "cut-1", title: "Kitchen (crop)" });
  assert.equal(db.jobs.length, 1);
});

test("the panel's cut and the assistant's cut of one frame are filed as the same row", async () => {
  const frame = { id: "frame", title: "Kitchen", origin: ReferenceOrigin.IMPORTED };
  const version = {
    projectId: "p1",
    source: frame,
    gcsUri: "gs://b/cut.jpg",
    thumbGcsUri: "gs://b/cut-thumb.jpg",
    editIntent: "the range and the shelf above it",
    editRationale: "the counter clutter is not the shot",
    cropBox: box,
    editAspect: "4:3",
    width: 1400,
    height: 1050,
    contentHash: "b".repeat(64),
  };

  const panel = recorder();
  await fileVersion(panel.client, version);
  const tool = recorder();
  await fileVersion(tool.client, version, { id: true, title: true });

  assert.deepEqual(tool.references[0], panel.references[0]);
  assert.deepEqual(tool.jobs[0], panel.jobs[0]);
});
