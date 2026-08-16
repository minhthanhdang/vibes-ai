import { test } from "node:test";
import assert from "node:assert/strict";

import {
  retryableFiles,
  uploadFailure,
  uploadFileKey,
  withFailure,
  withoutFailures,
  type UploadFailure,
} from "./upload-failures";

const dropped = (name: string, size = 1000, lastModified = 1) =>
  ({ name, size, lastModified }) as File;

const WIDE = dropped("wide.jpg");
const CLOSE = dropped("close.jpg", 2000);
const TREATMENT = dropped("treatment.pdf", 3000);

const failedNames = (failures: UploadFailure[]) => failures.map((failure) => failure.file.name);

test("two shots named the same from different folders are different failures", () => {
  const fromMonday = dropped("DSC_0001.jpg", 1000, 1);
  const fromTuesday = dropped("DSC_0001.jpg", 4000, 2);

  assert.notEqual(uploadFileKey(fromMonday), uploadFileKey(fromTuesday));
  assert.equal(uploadFileKey(fromMonday), uploadFileKey(dropped("DSC_0001.jpg", 1000, 1)));
});

test("a file that fails twice keeps one line, carrying the newer reason", () => {
  const first = withFailure([], uploadFailure(WIDE, "upload failed (503)", true));
  const second = withFailure(first, uploadFailure(WIDE, "upload failed (429)", true));

  assert.equal(second.length, 1);
  assert.equal(second[0]!.reason, "upload failed (429)");
});

test("a repeat failure stays where it was rather than jumping to the end", () => {
  const failures = [
    uploadFailure(WIDE, "upload failed (503)", true),
    uploadFailure(CLOSE, "unsupported format", false),
  ];

  const next = withFailure(failures, uploadFailure(WIDE, "upload failed (429)", true));

  assert.deepEqual(failedNames(next), ["wide.jpg", "close.jpg"]);
});

test("a starting batch clears its own files' errors and leaves the rest", () => {
  const failures = [
    uploadFailure(WIDE, "upload failed (503)", true),
    uploadFailure(CLOSE, "upload failed (503)", true),
    uploadFailure(TREATMENT, "unsupported format", false),
  ];

  assert.deepEqual(failedNames(withoutFailures(failures, [WIDE])), [
    "close.jpg",
    "treatment.pdf",
  ]);
  assert.deepEqual(failedNames(withoutFailures(failures, [WIDE, CLOSE])), ["treatment.pdf"]);
});

test("clearing does not mutate the list it was handed", () => {
  const failures = [uploadFailure(WIDE, "upload failed (503)", true)];

  withoutFailures(failures, [WIDE]);
  withFailure(failures, uploadFailure(CLOSE, "upload failed (503)", true));

  assert.equal(failures.length, 1);
});

test("a batch of files that never failed leaves the list alone", () => {
  const failures = [uploadFailure(WIDE, "upload failed (503)", true)];

  assert.deepEqual(withoutFailures(failures, [CLOSE, TREATMENT]), failures);
  assert.deepEqual(withoutFailures([], [WIDE]), []);
});

test("only the files a retry could actually fix are offered one", () => {
  const failures = [
    uploadFailure(WIDE, "upload failed (503)", true),
    uploadFailure(TREATMENT, "unsupported format", false),
    uploadFailure(CLOSE, "upload failed (503)", true),
  ];

  assert.deepEqual(
    retryableFiles(failures).map((file) => file.name),
    ["wide.jpg", "close.jpg"],
  );
  assert.deepEqual(retryableFiles([]), []);
});
