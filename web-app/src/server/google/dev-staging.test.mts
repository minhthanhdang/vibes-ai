import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { STAGING_PREFIX, stageContents, stagedCache, stagedObjectPath } = await import(
  "@/server/google/dev-staging"
);

type Contents = Parameters<typeof stageContents>[0];

const LOCAL = "vibes-dev-local";
const STAGING = "mtd-hackathons-artifacts";

const GCS = `gs://${LOCAL}/projects/p1/references/a.png`;
const SECOND = `gs://${LOCAL}/projects/p1/boards/b1/render.png`;
const FOREIGN = "gs://someone-elses/seed/a.png";

function picture(fileUri: string, mimeType = "image/png"): Contents[number] {
  return { role: "user", parts: [{ text: "look" }, { fileData: { fileUri, mimeType } }] };
}

function fakeStaging(overrides: { generation?: (uri: string) => string | null } = {}) {
  const staged = new Set<string>();
  const uploads: { objectPath: string; contentType: string; bytes: number }[] = [];

  return {
    uploads,
    staged,
    from: LOCAL,
    to: STAGING,
    source: {
      async generation(uri: string) {
        return overrides.generation ? overrides.generation(uri) : "1:1";
      },
      async bytes() {
        return new Uint8Array([1, 2, 3]);
      },
    },
    sink: {
      async staged(objectPath: string) {
        return staged.has(objectPath);
      },
      async stage(objectPath: string, bytes: Uint8Array, contentType: string) {
        uploads.push({ objectPath, contentType, bytes: bytes.length });
        staged.add(objectPath);
      },
    },
  };
}

test.beforeEach(() => stagedCache().clear());

test("a staged path is content-addressed on the uri and its generation, and keeps the extension", () => {
  const path = stagedObjectPath(GCS, "1:1");
  assert.equal(path.startsWith(STAGING_PREFIX), true);
  assert.equal(path.endsWith(".png"), true);
  assert.equal(stagedObjectPath(GCS, "1:1"), path);
  assert.notEqual(stagedObjectPath(GCS, "2:2"), path);
  assert.notEqual(stagedObjectPath(SECOND, "1:1"), path);
});

test("contents carrying no picture come back as the very array they went in as", async () => {
  const staging = fakeStaging();
  const contents: Contents = [{ role: "user", parts: [{ text: "no pictures here" }] }];

  assert.equal(await stageContents(contents, staging), contents);
  assert.equal(staging.uploads.length, 0);
});

test("a local picture reaches the model as a uri in the staging bucket, keeping its mime type", async () => {
  const staging = fakeStaging();
  const [resolved] = await stageContents([picture(GCS, "image/jpeg")], staging);

  assert.equal(resolved.parts[1].fileData?.fileUri?.startsWith(`gs://${STAGING}/${STAGING_PREFIX}`), true);
  assert.equal(resolved.parts[1].fileData?.mimeType, "image/jpeg");
  assert.deepEqual(
    staging.uploads.map(({ contentType, bytes }) => ({ contentType, bytes })),
    [{ contentType: "image/jpeg", bytes: 3 }],
  );
});

test("the contents handed in are never touched, because the transcript is written from them", async () => {
  const staging = fakeStaging();
  const contents = [picture(GCS)];
  const before = JSON.parse(JSON.stringify(contents)) as unknown;

  const resolved = await stageContents(contents, staging);

  assert.deepEqual(contents, before);
  assert.notEqual(resolved[0], contents[0]);
  assert.equal(contents[0].parts[1].fileData?.fileUri, GCS);
});

test("a uri already in the staging bucket passes through, so the pass is idempotent", async () => {
  const staging = fakeStaging();
  const once = await stageContents([picture(GCS)], staging);
  const twice = await stageContents(once, staging);

  assert.equal(twice, once);
  assert.equal(staging.uploads.length, 1);
});

test("a bucket this deployment does not own is left for the model to read itself", async () => {
  const staging = fakeStaging();
  const contents = [picture(FOREIGN)];

  assert.equal(await stageContents(contents, staging), contents);
  assert.equal(staging.uploads.length, 0);
});

test("the same picture twice in one request is staged once, and so is one asked for a turn later", async () => {
  const staging = fakeStaging();
  await stageContents([picture(GCS), picture(GCS)], staging);
  assert.equal(staging.uploads.length, 1);

  await stageContents([picture(GCS)], staging);
  assert.equal(staging.uploads.length, 1);
});

test("two different pictures are two objects, not one entry standing in for both", async () => {
  const staging = fakeStaging();
  await stageContents([picture(GCS), picture(SECOND)], staging);
  assert.equal(staging.uploads.length, 2);
});

test("a render overwritten in place is staged again, because the path carries the generation", async () => {
  let generation = "1:1";
  const staging = fakeStaging({ generation: () => generation });

  await stageContents([picture(SECOND)], staging);
  generation = "2:2";
  await stageContents([picture(SECOND)], staging);

  assert.equal(staging.uploads.length, 2);
  assert.notEqual(staging.uploads[0].objectPath, staging.uploads[1].objectPath);
});

test("an object the bucket already holds is not uploaded again after a restart", async () => {
  const staging = fakeStaging();
  staging.staged.add(stagedObjectPath(GCS, "1:1"));

  const [resolved] = await stageContents([picture(GCS)], staging);
  assert.equal(staging.uploads.length, 0);
  assert.equal(
    resolved.parts[1].fileData?.fileUri,
    `gs://${STAGING}/${stagedObjectPath(GCS, "1:1")}`,
  );
});

test("a failed upload is not left in the cache to fail every later turn the same way", async () => {
  const good = fakeStaging();
  let attempts = 0;
  const staging = {
    ...good,
    sink: {
      ...good.sink,
      async stage(objectPath: string, bytes: Uint8Array, contentType: string) {
        attempts += 1;
        if (attempts === 1) throw new Error("the network went away");
        return good.sink.stage(objectPath, bytes, contentType);
      },
    },
  };

  await assert.rejects(() => stageContents([picture(GCS)], staging), /network went away/);
  const [resolved] = await stageContents([picture(GCS)], staging);
  assert.equal(resolved.parts[1].fileData?.fileUri?.startsWith(`gs://${STAGING}/`), true);
});
