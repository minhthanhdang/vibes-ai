import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { fitsInOneFunction, isObjectTooLarge, ObjectTooLargeError, parseGcsUri } = await import(
  "@/server/google/storage"
);

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
