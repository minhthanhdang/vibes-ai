import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hashBytes,
  hashFileContent,
  partitionDrop,
  type HashedFile,
} from "@/lib/intake/content-hash";

const hashed = (name: string, contentHash: string): HashedFile => ({
  file: { name } as File,
  contentType: "image/jpeg",
  contentHash,
});

const names = (files: HashedFile[]) => files.map((file) => file.file.name);

test("the same bytes hash the same under two different file names", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const fromMonday = new Blob([bytes], { type: "image/png" });
  const fromTuesday = new Blob([bytes], { type: "image/png" });

  assert.equal(await hashFileContent(fromMonday), await hashFileContent(fromTuesday));
});

test("one flipped byte is a different image", async () => {
  const mansion = await hashFileContent(new Blob([new Uint8Array([1, 2, 3])]));
  const graded = await hashFileContent(new Blob([new Uint8Array([1, 2, 4])]));

  assert.notEqual(mansion, graded);
  assert.match(mansion, /^[0-9a-f]{64}$/);
});

/// The two doors onto one crop. A cut the user frames in the panel is hashed off
/// the `File` the canvas wrote; the same cut filed by `crop_reference` is hashed
/// off bytes the server never wrapped in one. A digest that depended on which
/// door the bytes came in by would file the same crop twice.
test("bytes cut on the server hash as the file the browser would have made", async () => {
  const cut = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);

  assert.equal(await hashBytes(cut), await hashFileContent(new Blob([cut])));
});

/// Bytes off a codec are a view into a buffer that is larger than they are.
/// Digesting what backs them rather than what they are would hash whatever the
/// pool is carrying either side of the cut, so two identical crops read out of
/// differently packed buffers would come back as different images.
test("bytes that are a window into a larger buffer hash as themselves", async () => {
  const pool = new Uint8Array([9, 9, 9, 1, 2, 3, 9, 9]);
  const cut = new Uint8Array(pool.buffer, 3, 3);

  assert.equal(await hashBytes(cut), await hashBytes(new Uint8Array([1, 2, 3])));
});

test("a file the project already holds is not uploaded again", () => {
  const drop = [hashed("wide.jpg", "aaa"), hashed("close.jpg", "bbb")];

  const { fresh, duplicates } = partitionDrop(drop, new Set(["aaa"]));

  assert.deepEqual(names(fresh), ["close.jpg"]);
  assert.deepEqual(names(duplicates), ["wide.jpg"]);
});

test("the same photo twice in one drop lands once", () => {
  const drop = [
    hashed("scout/DSC_0001.jpg", "aaa"),
    hashed("selects/hero.jpg", "aaa"),
    hashed("selects/wide.jpg", "bbb"),
  ];

  const { fresh, duplicates } = partitionDrop(drop, new Set());

  assert.deepEqual(names(fresh), ["scout/DSC_0001.jpg", "selects/wide.jpg"]);
  assert.deepEqual(names(duplicates), ["selects/hero.jpg"]);
});

test("re-dropping a folder after a partial failure uploads only what failed", () => {
  const folder = [hashed("a.jpg", "aaa"), hashed("b.jpg", "bbb"), hashed("c.jpg", "ccc")];

  const { fresh, duplicates } = partitionDrop(folder, new Set(["aaa", "ccc"]));

  assert.deepEqual(names(fresh), ["b.jpg"]);
  assert.equal(duplicates.length, 2);
});

test("a project with nothing in it takes the whole drop, in drop order", () => {
  const drop = [hashed("a.jpg", "aaa"), hashed("b.jpg", "bbb")];

  const { fresh, duplicates } = partitionDrop(drop, new Set());

  assert.deepEqual(names(fresh), ["a.jpg", "b.jpg"]);
  assert.deepEqual(duplicates, []);
});

test("the caller's set of known hashes is left alone", () => {
  const known = new Set(["aaa"]);

  partitionDrop([hashed("b.jpg", "bbb")], known);

  assert.deepEqual([...known], ["aaa"]);
});

test("an empty drop partitions into nothing", () => {
  assert.deepEqual(partitionDrop([], new Set(["aaa"])), {
    fresh: [],
    duplicates: [],
  });
});
