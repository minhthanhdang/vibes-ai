import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adoptableUpload,
  decodeDataUrl,
  unadoptedImages,
  withAdoptedFileIds,
} from "./moodboard-images";
import { persistableElements, referenceFileId, sceneReferenceIds } from "./moodboard-scene";

function pngDataUrl(bytes = [0x89, 0x50, 0x4e, 0x47]) {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function pasted(fileId: string, elementId = fileId) {
  return { id: elementId, type: "image", fileId };
}

function fileMap(fileId: string, dataURL: string, mimeType = "image/png") {
  return { [fileId]: { id: fileId, dataURL, mimeType, created: 1 } };
}

test("a pasted image is unadopted; one dragged from the sidebar is not", () => {
  const elements = [pasted("hash1"), { id: "e2", type: "image", fileId: referenceFileId("ref_1") }];
  const files = {
    ...fileMap("hash1", pngDataUrl()),
    ...fileMap(referenceFileId("ref_1"), "/api/references/ref_1/image", "image/jpeg"),
  };

  assert.deepEqual(
    unadoptedImages(elements, files).map((image) => image.fileId),
    ["hash1"],
  );
});

test("one file pasted onto two elements is one upload", () => {
  const elements = [pasted("hash1", "e1"), pasted("hash1", "e2")];
  assert.equal(unadoptedImages(elements, fileMap("hash1", pngDataUrl())).length, 1);
});

test("an image the director undid is not uploaded to the project", () => {
  const elements = [{ ...pasted("hash1"), isDeleted: true }];
  assert.deepEqual(unadoptedImages(elements, fileMap("hash1", pngDataUrl())), []);
});

test("shapes, elements with no file entry, and junk are all nothing to adopt", () => {
  const files = fileMap("hash1", pngDataUrl());
  assert.deepEqual(unadoptedImages([{ id: "r1", type: "rectangle" }], files), []);
  assert.deepEqual(unadoptedImages([pasted("missing")], files), []);
  assert.deepEqual(unadoptedImages([pasted("hash1")], { hash1: { id: "hash1" } }), []);
  for (const elements of [null, undefined, "scene", {}]) {
    assert.deepEqual(unadoptedImages(elements, files), [], JSON.stringify(elements));
  }
  assert.deepEqual(unadoptedImages([pasted("hash1")], null), []);
});

test("a data URL decodes to the bytes it carries and the type it declares", () => {
  const decoded = decodeDataUrl(pngDataUrl([1, 2, 250]));
  assert.equal(decoded?.contentType, "image/png");
  assert.deepEqual([...(decoded?.bytes ?? [])], [1, 2, 250]);
});

/// Percent-encoded payloads are text, and reading one back through character
/// codes would corrupt every byte above 0x7f without ever failing.
test("only base64 payloads decode; anything else reads as undecodable", () => {
  assert.equal(decodeDataUrl("data:image/svg+xml,%3Csvg%2F%3E"), null);
  assert.equal(decodeDataUrl("/api/references/ref_1/image"), null);
  assert.equal(decodeDataUrl("data:image/png;base64,!!not base64!!"), null);
  assert.equal(decodeDataUrl(null), null);
});

test("only formats the project can hold are adoptable", () => {
  const upload = adoptableUpload({ fileId: "hash1", dataURL: pngDataUrl(), mimeType: "image/png" });
  assert.equal(upload?.contentType, "image/png");

  for (const dataURL of ["data:image/svg+xml;base64,PHN2Zy8+", "data:image/heic;base64,AAAA"]) {
    assert.equal(adoptableUpload({ fileId: "hash1", dataURL, mimeType: "image/png" }), null, dataURL);
  }
});

/// The signed URL is issued for the type we tell the server, and the PUT is
/// refused if the bytes go up under a different one.
test("the dataURL's own type wins over the file entry's, and stands in for a missing one", () => {
  const bytes = Buffer.from([1, 2]).toString("base64");
  assert.equal(
    adoptableUpload({ fileId: "h", dataURL: `data:image/webp;base64,${bytes}`, mimeType: "image/png" })
      ?.contentType,
    "image/webp",
  );
  assert.equal(
    adoptableUpload({ fileId: "h", dataURL: `data:;base64,${bytes}`, mimeType: "image/GIF" })
      ?.contentType,
    "image/gif",
  );
});

test("adopting repoints the element without touching the array it came from", () => {
  const source = pasted("hash1");
  const elements = [source, { id: "r1", type: "rectangle" }];
  const adopted = withAdoptedFileIds(elements, new Map([["hash1", "ref_9"]]));

  assert.equal(adopted[0]?.fileId, referenceFileId("ref_9"));
  assert.equal(adopted[1], elements[1]);
  assert.equal(source.fileId, "hash1");
});

/// Undo restores a tombstone, so one left pointing at bytes we never stored
/// would come back as an empty box.
test("tombstones are repointed too, and unknown files are left alone", () => {
  const elements = [{ ...pasted("hash1"), isDeleted: true }, pasted("hash2", "e2")];
  const adopted = withAdoptedFileIds(elements, new Map([["hash1", "ref_9"]]));

  assert.equal(adopted[0]?.fileId, referenceFileId("ref_9"));
  assert.equal(adopted[1]?.fileId, "hash2");
  assert.deepEqual(withAdoptedFileIds("scene", new Map()), []);
});

/// The contract the whole feature rests on: what adoption writes into the scene
/// is what the board's save keeps and its load hydrates back into a URL.
test("an adopted element persists as a reference the load can resolve", () => {
  const scene = withAdoptedFileIds([pasted("hash1")], new Map([["hash1", "ref_9"]]));
  assert.deepEqual(sceneReferenceIds(persistableElements(scene)), ["ref_9"]);
  assert.deepEqual(unadoptedImages(scene, fileMap("hash1", pngDataUrl())), []);
});
