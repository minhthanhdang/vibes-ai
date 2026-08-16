import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATALOG_LIMIT,
  LIST_REFERENCES,
  SHOWN_LIMIT,
  SHOW_REFERENCES,
  aspectLabel,
  attachmentOf,
  attachmentTarget,
  digestTags,
  mergedAttachments,
  pickReferences,
  referenceCatalog,
  referenceDigest,
  type ToolReference,
} from "./agent-tools";

function reference(overrides: Partial<ToolReference> = {}): ToolReference {
  return {
    id: "ref-1",
    title: "Hallway",
    width: 1920,
    height: 1080,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
    ...overrides,
  };
}

test("a photograph's shape is said by the name a director uses for it", () => {
  assert.equal(aspectLabel(1920, 1080), "16:9");
  assert.equal(aspectLabel(2048, 2048), "1:1");
  assert.equal(aspectLabel(1080, 1920), "9:16");
});

test("a shape nobody has a name for is said as its own ratio", () => {
  assert.equal(aspectLabel(5568, 3712), "1.50:1");
});

test("a row with no recorded pixels has no shape rather than a made-up one", () => {
  assert.equal(aspectLabel(null, null), "unknown");
  assert.equal(aspectLabel(1920, 0), "unknown");
});

test("the digest carries the id, the shape and the tags and nothing else", () => {
  const digest = referenceDigest(
    reference({
      analysis: { lighting: ["low-key"], subject: ["interior"], colorPalette: ["#112233"] },
    }),
  );

  assert.deepEqual(digest, {
    id: "ref-1",
    title: "Hallway",
    shape: "16:9",
    tags: ["Low key", "Interior"],
  });
});

test("the palette stays out of the digest — hex codes are tokens a model cannot see", () => {
  assert.equal(digestTags({ colorPalette: ["#112233", "#445566"] }), undefined);
});

test("a cut says which frame it came out of and what it keeps", () => {
  const digest = referenceDigest(
    reference({
      id: "cut-1",
      title: "Hallway (crop 2)",
      editIntent: "the doorway",
      source: { id: "ref-1", title: "Hallway" },
    }),
  );

  assert.equal(digest.croppedFrom, "ref-1");
  assert.equal(digest.keeps, "the doorway");
});

test("an untitled reference is still named — a blank row is unpointable", () => {
  assert.equal(referenceDigest(reference({ title: "   " })).title, "Untitled");
});

test("the catalog says how many did not fit, so a truncated list is not read as the whole gallery", () => {
  const references = Array.from({ length: CATALOG_LIMIT + 5 }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const catalog = referenceCatalog(references);

  assert.equal(catalog.total, CATALOG_LIMIT + 5);
  assert.equal(catalog.shown, CATALOG_LIMIT);
  assert.equal(catalog.references.length, CATALOG_LIMIT);
});

test("a catalog that fits reports no truncation", () => {
  const catalog = referenceCatalog([reference(), reference({ id: "ref-2" })]);
  assert.equal(catalog.total, 2);
  assert.equal(catalog.shown, 2);
});

test("an attachment of a photograph opens that photograph", () => {
  const target = attachmentTarget(attachmentOf(reference()));
  assert.deepEqual(target, { view: "gallery", inspectId: "ref-1" });
});

test("an attachment of a cut opens the frame it was cut from", () => {
  const attachment = attachmentOf(
    reference({
      id: "cut-1",
      title: "Hallway (crop 2)",
      editIntent: "the doorway",
      source: { id: "ref-1", title: "Hallway" },
    }),
  );

  assert.equal(attachment.caption, "Hallway — the doorway");
  assert.deepEqual(attachmentTarget(attachment), { view: "gallery", inspectId: "ref-1" });
});

test("named references come back in the order they were named", () => {
  const references = [reference({ id: "a" }), reference({ id: "b" }), reference({ id: "c" })];
  const { found, missing } = pickReferences(references, ["c", "a"]);

  assert.deepEqual(
    found.map((entry) => entry.id),
    ["c", "a"],
  );
  assert.deepEqual(missing, []);
});

test("an id that answers to nothing is reported, not dropped", () => {
  const { found, missing } = pickReferences([reference({ id: "a" })], ["a", "ghost"]);
  assert.deepEqual(
    found.map((entry) => entry.id),
    ["a"],
  );
  assert.deepEqual(missing, ["ghost"]);
});

test("a reference named twice in one call is shown once", () => {
  const { found } = pickReferences([reference({ id: "a" })], ["a", "a"]);
  assert.equal(found.length, 1);
});

test("a call naming more pictures than the chat has room for is cut to the limit", () => {
  const references = Array.from({ length: SHOWN_LIMIT + 3 }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const { found } = pickReferences(
    references,
    references.map((entry) => entry.id),
  );
  assert.equal(found.length, SHOWN_LIMIT);
});

test("the same picture shown on two rounds of one exchange is drawn once", () => {
  const first = [attachmentOf(reference({ id: "a" }))];
  const merged = mergedAttachments(first, [
    attachmentOf(reference({ id: "a" })),
    attachmentOf(reference({ id: "b" })),
  ]);

  assert.deepEqual(
    merged.map((attachment) => attachment.referenceId),
    ["a", "b"],
  );
});

test("the declarations name themselves as the model is told to call them", () => {
  assert.equal(LIST_REFERENCES.name, "list_references");
  assert.equal(SHOW_REFERENCES.name, "show_references");
  assert.deepEqual(SHOW_REFERENCES.parameters.required, ["referenceIds"]);
});
