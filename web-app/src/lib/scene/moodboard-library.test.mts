import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LIBRARY_ITEM_NAME_LIMIT,
  exceedsLibraryByteLimit,
  libraryFingerprint,
  libraryReferenceIds,
  persistableLibraryItems,
} from "@/lib/scene/moodboard-library";
import { droppedImage } from "@/lib/canvas/moodboard-drop";
import { referenceFileId, sceneFiles } from "@/lib/scene/moodboard-scene";

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: "unpublished",
    created: 1,
    elements: [{ id: `${id}-el`, type: "rectangle" }],
    ...extra,
  };
}

test("a library item survives the round trip unchanged", () => {
  const source = item("a", { name: "Title card" });
  assert.deepEqual(persistableLibraryItems([source]), [source]);
});

test("anything that is not a list of items is an empty library, never a throw", () => {
  for (const input of [null, undefined, 0, "items", {}, [null, 7, "x", []]]) {
    assert.deepEqual(persistableLibraryItems(input), [], JSON.stringify(input) ?? "undefined");
  }
});

test("an item with no id, or a repeat of one already kept, is dropped", () => {
  const kept = persistableLibraryItems([
    item("a"),
    item(""),
    { ...item("b"), id: 7 },
    { ...item("a"), name: "second copy" },
  ]);
  assert.deepEqual(
    kept.map((entry) => entry.id),
    ["a"],
  );
  assert.equal(kept[0]?.name, undefined);
});

test("an item with nothing in it is dropped", () => {
  for (const elements of [[], undefined, "shapes", [{ type: "rectangle" }], [{ id: "x" }]]) {
    assert.deepEqual(persistableLibraryItems([item("a", { elements })]), []);
  }
});

test("an item's elements go through the scene filter", () => {
  const [kept] = persistableLibraryItems([
    item("a", {
      elements: [
        { id: "e1", type: "rectangle" },
        { id: "e2", type: "ellipse", isDeleted: true },
        { id: "e1", type: "diamond" },
      ],
    }),
  ]);
  assert.deepEqual(kept?.elements, [{ id: "e1", type: "rectangle" }]);
});

test("an element field this build has never heard of is stored, not stripped", () => {
  const [kept] = persistableLibraryItems([
    item("a", { elements: [{ id: "e1", type: "rectangle", futureProp: { deep: [1] } }] }),
  ]);
  assert.deepEqual(kept?.elements[0]?.futureProp, { deep: [1] });
});

test("status is read rather than forced, and anything else reads unpublished", () => {
  const kept = persistableLibraryItems([
    item("a", { status: "published" }),
    item("b", { status: "draft" }),
    item("c", { status: undefined }),
  ]);
  assert.deepEqual(
    kept.map((entry) => entry.status),
    ["published", "unpublished", "unpublished"],
  );
});

test("a name is trimmed and truncated, and a blank one is left off entirely", () => {
  const kept = persistableLibraryItems([
    item("a", { name: "  Lens flare  " }),
    item("b", { name: "   " }),
    item("c", { name: 12 }),
    item("d", { name: "n".repeat(LIBRARY_ITEM_NAME_LIMIT + 50) }),
  ]);
  assert.equal(kept[0]?.name, "Lens flare");
  assert.equal("name" in (kept[1] ?? {}), false);
  assert.equal("name" in (kept[2] ?? {}), false);
  assert.equal(kept[3]?.name?.length, LIBRARY_ITEM_NAME_LIMIT);
});

test("a missing or nonsense created timestamp sorts to the end instead of nowhere", () => {
  const kept = persistableLibraryItems([
    item("a", { created: undefined }),
    item("b", { created: Number.NaN }),
    item("c", { created: "yesterday" }),
  ]);
  assert.deepEqual(
    kept.map((entry) => entry.created),
    [0, 0, 0],
  );
});

test("the references a library points at are collected once each, across items", () => {
  const items = persistableLibraryItems([
    item("a", {
      elements: [
        { id: "e1", type: "image", fileId: referenceFileId("ref_1") },
        { id: "e2", type: "image", fileId: referenceFileId("ref_2") },
      ],
    }),
    item("b", {
      elements: [
        { id: "e3", type: "image", fileId: referenceFileId("ref_1") },
        { id: "e4", type: "rectangle" },
        { id: "e5", type: "image", fileId: "a1b2c3" },
      ],
    }),
  ]);
  assert.deepEqual(libraryReferenceIds(items).sort(), ["ref_1", "ref_2"]);
});

test("an item built from a dropped reference resolves to the file a load hydrates", () => {
  const dropped = droppedImage(
    { referenceId: "ref_9", width: 800, height: 600 },
    { x: 0, y: 0 },
  );
  const [item] = persistableLibraryItems([
    { id: "lib_1", status: "unpublished", created: 1, elements: [{ id: "e1", ...dropped }] },
  ]);

  const [referenceId] = libraryReferenceIds([item!]);
  assert.equal(referenceId, "ref_9");

  const [file] = sceneFiles([
    { id: referenceId!, gcsUri: "gs://bucket/ref_9.jpg", createdAt: new Date(0) },
  ]);
  assert.equal(file?.id, item?.elements[0]?.fileId);
});

test("a library past the byte limit is refused rather than trimmed", () => {
  const small = persistableLibraryItems([item("a")]);
  assert.equal(exceedsLibraryByteLimit(small), false);

  const huge = [
    item("a", { elements: [{ id: "e1", type: "freedraw", points: "x".repeat(2_000_001) }] }),
  ];
  assert.equal(exceedsLibraryByteLimit(persistableLibraryItems(huge)), true);
});

test("the fingerprint ignores everything the filter would erase", () => {
  const stored = persistableLibraryItems([item("a")]);
  assert.equal(
    libraryFingerprint([{ ...item("a"), error: "transient", extra: 1 }]),
    libraryFingerprint(stored),
  );
  assert.notEqual(libraryFingerprint([item("a"), item("b")]), libraryFingerprint(stored));
  assert.equal(libraryFingerprint(undefined), libraryFingerprint([]));
});
