import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { attachReferenceThumbnail } = await import("./thumbnail-queue");
const { THUMBNAIL_CONTENT_TYPE } = await import("@/lib/intake/thumbnail");

type Row = { width: number | null; height: number | null; thumbGcsUri: string | null };

const THUMB_URI = "gs://test-bucket/projects/p1/references/thumb.jpg";
const BYTES = new Uint8Array([1, 2, 3]);

function harness({
  row,
  updated = 1,
  made = {
    thumbnail: { bytes: new Uint8Array([9, 9]), contentType: THUMBNAIL_CONTENT_TYPE },
    width: 4000,
    height: 2000,
  },
}: {
  row: Row | null;
  updated?: number;
  made?: Awaited<ReturnType<(typeof import("./cut"))["thumbnailOf"]>>;
}) {
  const calls: { thumbnailed: Uint8Array[]; stored: unknown[]; updates: unknown[]; deleted: string[] } =
    { thumbnailed: [], stored: [], updates: [], deleted: [] };

  const deps = {
    db: {
      reference: {
        findFirst: async () => row,
        updateMany: async (args: unknown) => {
          calls.updates.push(args);
          return { count: updated };
        },
      },
    } as never,
    thumbnailOf: async (bytes: Uint8Array) => {
      calls.thumbnailed.push(bytes);
      return made;
    },
    storeUpload: async (projectId: string, contentType: string, bytes: Uint8Array) => {
      calls.stored.push({ projectId, contentType, bytes });
      return THUMB_URI;
    },
    deleteUpload: async (projectId: string, gcsUri: string) => {
      calls.deleted.push(gcsUri);
      return true;
    },
  };

  return { calls, deps: deps as never as Parameters<typeof attachReferenceThumbnail>[0] };
}

const kick = { projectId: "p1", referenceId: "r1", bytes: BYTES };

test("a row with no thumbnail gets one stored and written under the null guard", async () => {
  const { calls, deps } = harness({ row: { width: null, height: null, thumbGcsUri: null } });

  assert.equal(await attachReferenceThumbnail(deps, kick), "attached");
  assert.deepEqual(calls.thumbnailed, [BYTES]);
  assert.equal(calls.stored.length, 1);

  const [written] = calls.updates as [{ where: Record<string, unknown>; data: Record<string, unknown> }];
  assert.deepEqual(written.where, { id: "r1", projectId: "p1", thumbGcsUri: null });
  assert.deepEqual(written.data, { width: 4000, height: 2000, thumbGcsUri: THUMB_URI });
  assert.deepEqual(calls.deleted, []);
});

test("a row that already has a thumbnail is left alone", async () => {
  const { calls, deps } = harness({
    row: { width: 4000, height: 2000, thumbGcsUri: THUMB_URI },
  });

  assert.equal(await attachReferenceThumbnail(deps, kick), "unneeded");
  assert.deepEqual(calls.thumbnailed, []);
  assert.deepEqual(calls.updates, []);
});

test("losing the write race discards the orphaned copy", async () => {
  const { calls, deps } = harness({
    row: { width: null, height: null, thumbGcsUri: null },
    updated: 0,
  });

  assert.equal(await attachReferenceThumbnail(deps, kick), "unneeded");
  assert.deepEqual(calls.deleted, [THUMB_URI]);
});

test("a small image still fills in missing dimensions without storing a copy", async () => {
  const { calls, deps } = harness({
    row: { width: null, height: null, thumbGcsUri: null },
    made: { thumbnail: null, width: 400, height: 200 },
  });

  assert.equal(await attachReferenceThumbnail(deps, kick), "attached");
  assert.deepEqual(calls.stored, []);

  const [written] = calls.updates as [{ data: Record<string, unknown> }];
  assert.deepEqual(written.data, { width: 400, height: 200 });
});

test("a small image whose row already has its size needs nothing", async () => {
  const { calls, deps } = harness({
    row: { width: 400, height: 200, thumbGcsUri: null },
    made: { thumbnail: null, width: 400, height: 200 },
  });

  assert.equal(await attachReferenceThumbnail(deps, kick), "unneeded");
  assert.deepEqual(calls.updates, []);
});

test("a reference that is gone is lost", async () => {
  const { calls, deps } = harness({ row: null });

  assert.equal(await attachReferenceThumbnail(deps, kick), "lost");
  assert.deepEqual(calls.thumbnailed, []);
});
