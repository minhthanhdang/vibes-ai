import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { EXPIRY_MARGIN_MS, pictureCache, resolveContents } = await import(
  "@/server/google/dev-pictures"
);

type Contents = Parameters<typeof resolveContents>[0];

const NOW = Date.UTC(2026, 7, 30, 12);
const LATER = new Date(NOW + 48 * 3_600_000).toISOString();

const GCS = "gs://vibes-dev-local/projects/p1/references/a.png";
const SECOND = "gs://vibes-dev-local/projects/p1/boards/b1/render.png";

function picture(fileUri: string, mimeType = "image/png"): Contents[number] {
  return { role: "user", parts: [{ text: "look" }, { fileData: { fileUri, mimeType } }] };
}

function fakePictures(overrides: { generation?: (uri: string) => string | null } = {}) {
  const uploads: { mimeType: string; bytes: number }[] = [];
  let issued = 0;

  return {
    uploads,
    files: {
      async upload(bytes: Uint8Array, mimeType: string) {
        uploads.push({ mimeType, bytes: bytes.length });
        issued += 1;
        return {
          name: `files/${issued}`,
          uri: `https://generativelanguage.googleapis.com/v1beta/files/${issued}`,
          state: "ACTIVE",
          expirationTime: LATER,
        };
      },
      async get(name: string) {
        return { name, uri: `https://generativelanguage.googleapis.com/v1beta/${name}`, state: "ACTIVE" };
      },
    },
    source: {
      async generation(uri: string) {
        return overrides.generation ? overrides.generation(uri) : "1:1";
      },
      async bytes() {
        return new Uint8Array([1, 2, 3]);
      },
    },
  };
}

test.beforeEach(() => pictureCache().clear());

test("contents carrying no picture come back as the very array they went in as", async () => {
  const pictures = fakePictures();
  const contents: Contents = [{ role: "user", parts: [{ text: "no pictures here" }] }];

  assert.equal(await resolveContents(contents, pictures, NOW), contents);
  assert.equal(pictures.uploads.length, 0);
});

test("a gs:// picture reaches the model as a Files API uri, carrying its own mime type", async () => {
  const pictures = fakePictures();
  const [resolved] = await resolveContents([picture(GCS, "image/jpeg")], pictures, NOW);

  assert.equal(resolved.parts[1].fileData?.fileUri?.startsWith("https://"), true);
  assert.equal(resolved.parts[1].fileData?.mimeType, "image/jpeg");
  assert.deepEqual(pictures.uploads, [{ mimeType: "image/jpeg", bytes: 3 }]);
});

test("the contents handed in are never touched, because the transcript is written from them", async () => {
  const pictures = fakePictures();
  const contents = [picture(GCS)];
  const before = JSON.parse(JSON.stringify(contents)) as unknown;

  const resolved = await resolveContents(contents, pictures, NOW);

  assert.deepEqual(contents, before);
  assert.notEqual(resolved[0], contents[0]);
  assert.equal(contents[0].parts[1].fileData?.fileUri, GCS);
});

test("a part that is already a Files API uri passes through, so the pass is idempotent", async () => {
  const pictures = fakePictures();
  const once = await resolveContents([picture(GCS)], pictures, NOW);
  const twice = await resolveContents(once, pictures, NOW);

  assert.equal(twice, once);
  assert.equal(pictures.uploads.length, 1);
});

test("the same picture in two rounds is uploaded once, and so is one asked for twice at once", async () => {
  const pictures = fakePictures();
  await resolveContents([picture(GCS), picture(GCS)], pictures, NOW);
  assert.equal(pictures.uploads.length, 1);

  await resolveContents([picture(GCS)], pictures, NOW);
  assert.equal(pictures.uploads.length, 1);
});

test("two different pictures are two uploads, not one cache entry standing in for both", async () => {
  const pictures = fakePictures();
  await resolveContents([picture(GCS), picture(SECOND)], pictures, NOW);
  assert.equal(pictures.uploads.length, 2);
});

test("a render overwritten in place is uploaded again, because the key carries the generation", async () => {
  let generation = "1:1";
  const pictures = fakePictures({ generation: () => generation });

  await resolveContents([picture(SECOND)], pictures, NOW);
  generation = "2:2";
  await resolveContents([picture(SECOND)], pictures, NOW);

  assert.equal(pictures.uploads.length, 2);
});

test("a file the server is about to expire is uploaded again rather than handed over stale", async () => {
  const pictures = fakePictures();
  await resolveContents([picture(GCS)], pictures, NOW);

  const expiring = Date.parse(LATER) - EXPIRY_MARGIN_MS + 1;
  await resolveContents([picture(GCS)], pictures, expiring);

  assert.equal(pictures.uploads.length, 2);
});

test("a picture that is still processing is waited on rather than sent to the model", async () => {
  const slept = globalThis.setTimeout;
  globalThis.setTimeout = ((run: () => void) => slept(run, 0)) as typeof setTimeout;

  let asked = 0;
  const pictures = {
    ...fakePictures(),
    files: {
      async upload() {
        return { name: "files/slow", state: "PROCESSING" };
      },
      async get(name: string) {
        asked += 1;
        return asked < 3
          ? { name, state: "PROCESSING" }
          : { name, uri: "https://generativelanguage.googleapis.com/v1beta/files/slow", state: "ACTIVE" };
      },
    },
  };

  try {
    const [resolved] = await resolveContents([picture(GCS)], pictures, NOW);
    assert.equal(resolved.parts[1].fileData?.fileUri?.endsWith("files/slow"), true);
    assert.equal(asked, 3);
  } finally {
    globalThis.setTimeout = slept;
  }
});

test("a picture the Files API failed on throws what the server said about it", async () => {
  const pictures = {
    ...fakePictures(),
    files: {
      async upload() {
        return { name: "files/bad", state: "FAILED", error: { message: "unsupported image" } };
      },
      async get(name: string) {
        return { name, state: "FAILED" };
      },
    },
  };

  await assert.rejects(() => resolveContents([picture(GCS)], pictures, NOW), /unsupported image/);
});

test("a failed upload is not left in the cache to fail every later turn the same way", async () => {
  let attempts = 0;
  const good = fakePictures();
  const pictures = {
    ...good,
    files: {
      ...good.files,
      async upload(bytes: Uint8Array, mimeType: string) {
        attempts += 1;
        if (attempts === 1) throw new Error("the network went away");
        return good.files.upload(bytes, mimeType);
      },
    },
  };

  await assert.rejects(() => resolveContents([picture(GCS)], pictures, NOW), /network went away/);
  const [resolved] = await resolveContents([picture(GCS)], pictures, NOW);
  assert.equal(resolved.parts[1].fileData?.fileUri?.startsWith("https://"), true);
});
