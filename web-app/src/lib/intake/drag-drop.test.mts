import { test } from "node:test";
import assert from "node:assert/strict";

import { isFileDrag, nextDragDepth, sortDroppedFiles } from "@/lib/intake/drag-drop";

const dropped = (name: string, type: string) => ({ name, type }) as File;

const JPEG = dropped("shot.jpg", "image/jpeg");
const PNG = dropped("frame.png", "image/png");
const PDF = dropped("treatment.pdf", "application/pdf");
const FOLDER = dropped("location scout", "");

test("keeps supported images and narrows their content type", () => {
  const { uploadable, unsupported } = sortDroppedFiles([JPEG, PNG]);

  assert.deepEqual(
    uploadable.map((item) => item.contentType),
    ["image/jpeg", "image/png"],
  );
  assert.deepEqual(unsupported, []);
});

test("separates unsupported files instead of dropping them silently", () => {
  const { uploadable, unsupported } = sortDroppedFiles([JPEG, PDF, FOLDER]);

  assert.deepEqual(
    uploadable.map((item) => item.file),
    [JPEG],
  );
  assert.deepEqual(unsupported, [PDF, FOLDER]);
});

test("preserves drop order among the uploadable files", () => {
  const { uploadable } = sortDroppedFiles([PNG, PDF, JPEG]);

  assert.deepEqual(
    uploadable.map((item) => item.file.name),
    ["frame.png", "shot.jpg"],
  );
});

test("an empty drop sorts into two empty lists", () => {
  assert.deepEqual(sortDroppedFiles([]), { uploadable: [], unsupported: [] });
});

test("drag depth only reaches zero once every enter has been matched", () => {
  const overPage = nextDragDepth(0, "enter");
  const overButtonInside = nextDragDepth(overPage, "enter");

  assert.equal(nextDragDepth(overButtonInside, "leave"), 1);
  assert.equal(nextDragDepth(1, "leave"), 0);
});

test("a drop clears the depth however unbalanced it got", () => {
  assert.equal(nextDragDepth(3, "drop"), 0);
});

test("depth never goes negative", () => {
  assert.equal(nextDragDepth(0, "leave"), 0);
});

test("only a drag advertising files counts as a file drag", () => {
  assert.equal(isFileDrag(["Files"]), true);
  assert.equal(isFileDrag(["text/plain", "Files"]), true);
  assert.equal(isFileDrag(["text/uri-list"]), false);
  assert.equal(isFileDrag([]), false);
  assert.equal(isFileDrag(undefined), false);
});
