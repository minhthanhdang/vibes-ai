import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.APP_ENV = "production";

const {
  fitsInOneFunction,
  isObjectTooLarge,
  ObjectTooLargeError,
  parseGcsUri,
  readUrlWindow,
  READ_URL_BUCKET_MS,
  READ_URL_TTL_MS,
} = await import("@/server/google/storage");

const LIMIT = 100_000_000;

test("a size inside the ceiling fits", () => {
  assert.equal(fitsInOneFunction("67000000", LIMIT), true);
});

test("a size exactly at the ceiling fits", () => {
  assert.equal(fitsInOneFunction(LIMIT, LIMIT), true);
});

test("a size past the ceiling does not", () => {
  assert.equal(fitsInOneFunction("100000001", LIMIT), false);
});

test("a size GCS did not record does not fit", () => {
  assert.equal(fitsInOneFunction(undefined, LIMIT), false);
});

test("a size that is not a number does not fit", () => {
  assert.equal(fitsInOneFunction("a lot", LIMIT), false);
});

test("the refusal a read throws is the one the crop tool tells apart", () => {
  assert.equal(isObjectTooLarge(new ObjectTooLargeError("gs://b/o.jpg is 340 MB")), true);
  assert.equal(isObjectTooLarge(new Error("gs://b/o.jpg is 340 MB")), false);
  assert.equal(isObjectTooLarge("too large"), false);
  assert.equal(isObjectTooLarge(undefined), false);
});

test("an error carrying the name from another copy of this module is the same refusal", () => {
  const foreign = new Error("gs://b/o.jpg is 340 MB");
  foreign.name = "ObjectTooLargeError";
  assert.equal(isObjectTooLarge(foreign), true);
});

test("a read window opens on the hour and never after now", () => {
  const now = Date.UTC(2026, 7, 30, 12, 59, 3);
  const { accessibleAt, expires } = readUrlWindow(now);
  assert.equal(accessibleAt, Date.UTC(2026, 7, 30, 12));
  assert.ok(accessibleAt <= now);
  assert.equal(expires - accessibleAt, READ_URL_TTL_MS);
});

test("a read window spans a day and an hour past its start", () => {
  assert.equal(READ_URL_TTL_MS, 25 * READ_URL_BUCKET_MS);
});

test("every moment of the same hour signs the same window", () => {
  assert.deepEqual(
    readUrlWindow(Date.UTC(2026, 7, 30, 12, 0, 0)),
    readUrlWindow(Date.UTC(2026, 7, 30, 12, 59, 59, 999)),
  );
});

test("the hour rolling over opens a new window while the old one still lives a day", () => {
  const rollover = Date.UTC(2026, 7, 30, 13);
  const before = readUrlWindow(rollover - 1);
  const opened = readUrlWindow(rollover);

  assert.equal(opened.accessibleAt - before.accessibleAt, READ_URL_BUCKET_MS);
  assert.ok(before.expires - rollover >= 24 * READ_URL_BUCKET_MS);
});

test("a locator is read as its bucket and the object under it", () => {
  assert.deepEqual(parseGcsUri("gs://a-bucket/projects/p1/references/a.png"), {
    bucket: "a-bucket",
    object: "projects/p1/references/a.png",
  });
});

test("a bucket this deployment does not own is read all the same", () => {
  assert.deepEqual(parseGcsUri("gs://someone-elses/seed/a.png"), {
    bucket: "someone-elses",
    object: "seed/a.png",
  });
});

test("anything that is not an object locator is refused", () => {
  for (const uri of ["https://example.test/a.png", "gs://a-bucket", "gs://a-bucket/", "a.png"]) {
    assert.throws(() => parseGcsUri(uri), /not a gs:\/\/ uri/);
  }
});
