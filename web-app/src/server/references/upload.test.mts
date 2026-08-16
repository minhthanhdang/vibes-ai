import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { isProjectUpload, uploadObjectPath } = await import("./upload");
const { forDisplay, referenceImagePath } = await import("./display");
const { IMAGE_EXTENSIONS, isUploadContentType } = await import("@/lib/image-types");

const PROJECT = "cproj1";
const PREFIX = `gs://test-bucket/projects/${PROJECT}/references/`;

test("accepts a uri under the project's own prefix", () => {
  assert.equal(isProjectUpload(PROJECT, `${PREFIX}a1b2.png`), true);
});

test("rejects another project's prefix", () => {
  assert.equal(isProjectUpload(PROJECT, "gs://test-bucket/projects/cproj2/references/a.png"), false);
});

test("rejects a project id that only prefixes ours", () => {
  assert.equal(isProjectUpload("cproj", `${PREFIX}a.png`), false);
});

test("rejects another bucket", () => {
  assert.equal(isProjectUpload(PROJECT, `gs://other/projects/${PROJECT}/references/a.png`), false);
});

test("rejects a non-gs locator that embeds the prefix", () => {
  assert.equal(isProjectUpload(PROJECT, `https://evil.example/${PREFIX}a.png`), false);
});

test("rejects the bare prefix — a directory is not an object to delete", () => {
  assert.equal(isProjectUpload(PROJECT, PREFIX), false);
});

test("the deletable object path is the uri with the bucket stripped", () => {
  assert.equal(
    uploadObjectPath(PROJECT, `${PREFIX}a1b2.png`),
    `projects/${PROJECT}/references/a1b2.png`,
  );
});

test("nothing outside the project's uploads yields a deletable path", () => {
  /// The pipeline's own artifacts and seeded rows live elsewhere in the
  /// bucket; removing a reference must not reach them.
  assert.equal(uploadObjectPath(PROJECT, `gs://test-bucket/seed/a.png`), null);
  assert.equal(uploadObjectPath(PROJECT, `gs://test-bucket/projects/${PROJECT}/crops/a.png`), null);
  assert.equal(uploadObjectPath(PROJECT, "gs://test-bucket/projects/other/references/a.png"), null);
});

test("every accepted content type has an extension", () => {
  for (const [type, extension] of Object.entries(IMAGE_EXTENSIONS)) {
    assert.equal(isUploadContentType(type), true);
    assert.match(extension, /^[a-z]+$/);
  }
});

test("heic is not accepted — no browser renders it and there is no transcode step", () => {
  assert.equal(isUploadContentType("image/heic"), false);
});

test("the display url is stable — the same reference renders the same src twice", () => {
  const reference = { id: "cref1", gcsUri: `${PREFIX}a.png`, title: "a.png" };
  assert.equal(forDisplay(reference).displayUrl, forDisplay(reference).displayUrl);
  assert.equal(forDisplay(reference).displayUrl, referenceImagePath("cref1"));
});

test("the bucket path never reaches the browser", () => {
  const shown = forDisplay({ id: "cref1", gcsUri: `${PREFIX}a.png`, title: "a.png" });
  assert.equal("gcsUri" in shown, false);
  assert.equal(JSON.stringify(shown).includes("gs://"), false);
});
