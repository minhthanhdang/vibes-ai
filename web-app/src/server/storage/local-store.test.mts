import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SKIP_ENV_VALIDATION = "1";

const { headObjectAt, localObjectStore, objectLocation, readObjectAt, writeObjectAt } = await import(
  "@/server/storage/local-store"
);

const BUCKET = "vibes-dev-local";
const OBJECT = "projects/p1/references/a.png";
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

async function root() {
  const dir = await mkdtemp(join(tmpdir(), "blobstore-"));
  test.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function store(dir: string) {
  return localObjectStore(dir, BUCKET, "http://localhost:12000", "a-dev-signing-secret");
}

test("an object comes back as the bytes and the content type it was saved with", async () => {
  const dir = await root();
  await store(dir).save(OBJECT, BYTES, { contentType: "image/png" });

  const head = await store(dir).head(OBJECT);
  assert.equal(head?.contentType, "image/png");
  assert.equal(head?.size, BYTES.length);
  assert.deepEqual([...(await store(dir).download(BUCKET, OBJECT))], [...BYTES]);
});

test("an object lives under its own bucket, so a foreign URI is an honest miss", async () => {
  const dir = await root();
  await store(dir).save(OBJECT, BYTES, { contentType: "image/png" });

  assert.equal(await store(dir).headIn("mtd-hackathons-uploads", OBJECT), null);
  assert.equal(await readObjectAt(dir, "mtd-hackathons-uploads", OBJECT), null);
  await assert.rejects(() => store(dir).download("mtd-hackathons-uploads", OBJECT), /no such object/);
});

test("the custom metadata a render carries survives the round trip", async () => {
  const dir = await root();
  const undrawn = JSON.stringify([{ id: "el1", type: "image" }]);
  await store(dir).save(OBJECT, BYTES, { contentType: "image/png", metadata: { undrawn } });

  assert.equal((await store(dir).head(OBJECT))?.metadata.undrawn, undrawn);
});

test("a head is taken of the object, not of the sidecar — a stranded sidecar reads as absent", async () => {
  const dir = await root();
  const at = objectLocation(dir, BUCKET, OBJECT);
  await writeObjectAt(dir, BUCKET, OBJECT, BYTES, { contentType: "image/png", metadata: {} });
  await rm(at.file);

  assert.equal(await headObjectAt(dir, BUCKET, OBJECT), null);
});

test("the sidecar is written before the object, so metadata is never the missing half", async () => {
  const dir = await root();
  const at = objectLocation(dir, BUCKET, OBJECT);
  await writeObjectAt(dir, BUCKET, OBJECT, BYTES, { contentType: "image/png", metadata: {} });

  const object = await stat(at.file);
  const sidecar = await stat(at.sidecar);
  assert.ok(sidecar.mtimeMs <= object.mtimeMs);
});

test("the generation moves when the bytes do, which is what a picture cache is keyed on", async () => {
  const dir = await root();
  await store(dir).save(OBJECT, BYTES, { contentType: "image/png" });
  const before = (await store(dir).head(OBJECT))?.generation;

  await store(dir).save(OBJECT, new Uint8Array([...BYTES, 0x0d]), { contentType: "image/png" });
  assert.notEqual((await store(dir).head(OBJECT))?.generation, before);
});

test("a copy carries the sidecar with it, and a removal takes both halves", async () => {
  const dir = await root();
  await store(dir).save(OBJECT, BYTES, {
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable",
  });
  await store(dir).copy(OBJECT, "projects/p1/references/b.png");

  const copied = await store(dir).head("projects/p1/references/b.png");
  assert.equal(copied?.cacheControl, "public, max-age=31536000, immutable");

  await store(dir).remove(OBJECT);
  assert.equal(await store(dir).head(OBJECT), null);
  await assert.rejects(() => readFile(objectLocation(dir, BUCKET, OBJECT).sidecar));
});

test("setting cache-control keeps the content type and the custom metadata already there", async () => {
  const dir = await root();
  await store(dir).save(OBJECT, BYTES, { contentType: "image/png", metadata: { undrawn: "[]" } });
  await store(dir).setCacheControl(OBJECT, "public, max-age=31536000, immutable");

  const head = await store(dir).head(OBJECT);
  assert.equal(head?.cacheControl, "public, max-age=31536000, immutable");
  assert.equal(head?.contentType, "image/png");
  assert.equal(head?.metadata.undrawn, "[]");
});

test("a path that climbs, or is absolute, or carries a NUL, never reaches the filesystem", async () => {
  const dir = await root();
  for (const object of [
    "../../etc/passwd",
    "projects/../../escaped.png",
    "/etc/passwd",
    "projects//a.png",
    "projects/./a.png",
    "a\0.png",
    "",
  ]) {
    assert.throws(() => objectLocation(dir, BUCKET, object), /UnsafeObjectPath|not an object path/, object);
  }
});

test("a bucket name that is not one is refused before it becomes a directory", async () => {
  const dir = await root();
  for (const bucket of ["..", "/etc", "A-Bucket", "b", "", "a bucket"]) {
    assert.throws(() => objectLocation(dir, bucket, OBJECT), /not a bucket name/, bucket);
  }
});

test("a sidecar that is not JSON reads as no metadata rather than failing the request", async () => {
  const dir = await root();
  await store(dir).save(OBJECT, BYTES, { contentType: "image/png" });
  await writeFile(objectLocation(dir, BUCKET, OBJECT).sidecar, "{half-written");

  const head = await store(dir).head(OBJECT);
  assert.deepEqual(head?.metadata, {});
  assert.equal(head?.contentType, undefined);
});

test("a write URL is absolute, because the app fetches its own store over loopback", async () => {
  const dir = await root();
  const url = await store(dir).writeUrl(OBJECT, {
    contentType: "image/png",
    expiresAt: Date.now() + 900_000,
  });
  assert.ok(url.startsWith("http://localhost:12000/api/dev-storage/"));
});
