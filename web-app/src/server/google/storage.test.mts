import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { fitsInOneFunction, isObjectTooLarge, ObjectTooLargeError, parseGcsUri } = await import(
  "@/server/google/storage"
);

/// `readObject` itself cannot be reached from here — it builds a real client and
/// goes to the network — so what is checked is the whole of the decision it
/// makes before a byte transfers, and the discriminator the caller reads that
/// decision back with.

const LIMIT = 100_000_000;

test("a size inside the ceiling fits", () => {
  /// A string, because that is what the JSON API records a size as.
  assert.equal(fitsInOneFunction("67000000", LIMIT), true);
});

test("a size exactly at the ceiling fits", () => {
  assert.equal(fitsInOneFunction(LIMIT, LIMIT), true);
});

test("a size past the ceiling does not", () => {
  assert.equal(fitsInOneFunction("100000001", LIMIT), false);
});

test("a size GCS did not record does not fit", () => {
  /// The trap the ceiling was written around: an absent size is NaN, and NaN is
  /// not greater than anything, so a bound asked the other way round would read
  /// this as an empty object and pull it into the function.
  assert.equal(fitsInOneFunction(undefined, LIMIT), false);
});

test("a size that is not a number does not fit", () => {
  assert.equal(fitsInOneFunction("a lot", LIMIT), false);
});

test("the refusal a read throws is the one the crop tool tells apart", () => {
  /// The cut answers a too-large photograph with its own sentence — say so and
  /// do not ask again — and this is what stands between that sentence and the
  /// generic one.
  assert.equal(isObjectTooLarge(new ObjectTooLargeError("gs://b/o.jpg is 340 MB")), true);
  assert.equal(isObjectTooLarge(new Error("gs://b/o.jpg is 340 MB")), false);
  assert.equal(isObjectTooLarge("too large"), false);
  assert.equal(isObjectTooLarge(undefined), false);
});

test("an error carrying the name from another copy of this module is the same refusal", () => {
  /// Structural on purpose. Under the test runner an `.mts` file reaches this
  /// module as ESM and the app's own graph reaches it as CJS, so `instanceof`
  /// is false across the two instances of a class that is one class in the
  /// deployment — the name is the part that survives the crossing.
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
  /// Why the read resolves the locator rather than going through `bucket()`: a
  /// reference may point outside the prefix this deployment writes under, and a
  /// crop of it is still a crop.
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
