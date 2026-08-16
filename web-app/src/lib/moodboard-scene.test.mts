import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  MOODBOARD_SCENE_BYTE_LIMIT,
  exceedsSceneByteLimit,
  persistableElements,
  persistedAppState,
  referenceFileId,
  referenceIdFromFileId,
  sceneFiles,
  sceneReferenceIds,
} from "./moodboard-scene";
import { referenceCanvasImagePath, referenceImagePath } from "@/server/references/display";

const element = (overrides: Record<string, unknown> = {}) => ({
  id: "el_1",
  type: "rectangle",
  x: 0,
  y: 0,
  ...overrides,
});

test("an image on the board points back at its reference", () => {
  assert.equal(referenceFileId("ref_1"), "ref:ref_1");
  assert.equal(referenceIdFromFileId(referenceFileId("ref_1")), "ref_1");
});

/// A scene pasted in from excalidraw.com carries content-hash fileIds naming
/// bytes we never stored — those must not be read as reference ids.
test("a fileId that is not one of ours names no reference", () => {
  for (const fileId of ["abc123", "ref:", "ref:   ", "", null, undefined, 7, { id: "ref:x" }]) {
    assert.equal(referenceIdFromFileId(fileId), null, `${JSON.stringify(fileId)} names no reference`);
  }
});

test("elements survive a round trip in z-order", () => {
  const scene = [element({ id: "a" }), element({ id: "b", type: "image" }), element({ id: "c" })];
  assert.deepEqual(
    persistableElements(scene).map((kept) => kept.id),
    ["a", "b", "c"],
  );
});

/// `onChange` reports the tombstones undo restores from. They are session
/// state: storing them grows the row forever for a director who draws and
/// erases, and excalidraw's own export drops them too.
test("erased elements are not stored", () => {
  const scene = [element({ id: "a" }), element({ id: "b", isDeleted: true }), element({ id: "c" })];
  assert.deepEqual(
    persistableElements(scene).map((kept) => kept.id),
    ["a", "c"],
  );
});

test("an element that cannot be drawn is dropped, not stored", () => {
  const scene = [
    element(),
    { id: "no_type" },
    { type: "rectangle" },
    { id: 7, type: "rectangle" },
    { id: "", type: "rectangle" },
    { id: "x", type: "" },
    "rectangle",
    null,
    ["rectangle"],
  ];
  assert.deepEqual(
    persistableElements(scene).map((kept) => kept.id),
    ["el_1"],
  );
});

/// Excalidraw renders only one of a duplicated pair, so storing both would
/// resurrect the loser on the next load.
test("a duplicated id is stored once", () => {
  const scene = [element({ id: "a", x: 1 }), element({ id: "a", x: 2 }), element({ id: "b" })];
  const kept = persistableElements(scene);
  assert.deepEqual(kept.map((entry) => entry.id), ["a", "b"]);
  assert.equal(kept[0]!.x, 1);
});

test("a scene that is not an array stores nothing", () => {
  for (const input of [null, undefined, {}, "[]", 7]) {
    assert.deepEqual(persistableElements(input), []);
  }
});

test("every reference the board shows is named once, first appearance first", () => {
  const scene = persistableElements([
    element({ id: "a", type: "image", fileId: "ref:ref_2" }),
    element({ id: "b", type: "rectangle" }),
    element({ id: "c", type: "image", fileId: "ref:ref_1" }),
    element({ id: "d", type: "image", fileId: "ref:ref_2" }),
    element({ id: "e", type: "image", fileId: "sha256hash" }),
  ]);
  assert.deepEqual(sceneReferenceIds(scene), ["ref_2", "ref_1"]);
});

/// The board holds a pointer, never bytes: the file entry's `dataURL` is the
/// app's own stable image path, which signs a fresh read of the object on every
/// request, so a board left open past a signature's lifetime still renders.
test("a file entry points at the app's image path, typed from the object it names", () => {
  const createdAt = new Date("2026-08-16T12:00:00Z");
  assert.deepEqual(
    sceneFiles([
      { id: "ref_1", gcsUri: "gs://bucket/projects/p1/references/one.png", createdAt },
      { id: "ref_2", gcsUri: "gs://bucket/projects/p1/references/two.webp", createdAt },
    ]),
    [
      {
        id: "ref:ref_1",
        dataURL: "/api/references/ref_1/image",
        mimeType: "image/png",
        created: createdAt.getTime(),
      },
      {
        id: "ref:ref_2",
        dataURL: "/api/references/ref_2/image",
        mimeType: "image/webp",
        created: createdAt.getTime(),
      },
    ].map((file) => ({ ...file, dataURL: referenceCanvasImagePath(file.id.slice(4)) })),
  );
});

/// The one thing about a board image that cannot be seen by looking at the
/// board: an image loaded through the bucket redirect renders perfectly and
/// then makes the whole board unexportable, because a canvas that has drawn a
/// cross-origin image cannot be read back. Pinned here because the redirect
/// path is the one every other surface uses, so this is the easy line to
/// "simplify" away.
test("a board's images are loaded same-origin, so the board can be exported", () => {
  const [file] = sceneFiles([
    { id: "ref_1", gcsUri: "gs://bucket/projects/p1/references/one.png", createdAt: new Date(0) },
  ]);
  assert.equal(file!.dataURL, referenceCanvasImagePath("ref_1"));
  assert.notEqual(file!.dataURL, referenceImagePath("ref_1"));
  assert.ok(file!.dataURL.startsWith("/"), "same-origin, so the export canvas is not tainted");
});

/// A board draws a 5568px photo at 320 units, so loading the original is six
/// megabytes to paint sixty kilobytes of pixels — through the app's own
/// streaming route, which pays for every one of them twice.
test("a file entry asks for the copy the board's own elements need", () => {
  const references = [
    {
      id: "ref_1",
      gcsUri: "gs://bucket/projects/p1/references/one.png",
      thumbGcsUri: "gs://bucket/projects/p1/references/one-thumb.jpg",
      createdAt: new Date(0),
    },
  ];

  const [small] = sceneFiles(references, new Map([["ref_1", "thumb" as const]]));
  assert.equal(small!.dataURL, referenceCanvasImagePath("ref_1", "thumb"));
  assert.equal(small!.mimeType, "image/jpeg", "the thumbnail's type, not the original's");

  const [large] = sceneFiles(references, new Map([["ref_1", "full" as const]]));
  assert.equal(large!.dataURL, referenceCanvasImagePath("ref_1"));
  assert.equal(large!.mimeType, "image/png");
});

/// The URL names what was asked for rather than what exists, so the drop —
/// which cannot see the row — and the load, which can, land on one cache entry.
/// Only the type is read off the object that will actually be served.
test("a reference with no thumbnail is still asked for by variant", () => {
  const [file] = sceneFiles(
    [{ id: "ref_1", gcsUri: "gs://bucket/projects/p1/references/one.png", createdAt: new Date(0) }],
    new Map([["ref_1", "thumb" as const]]),
  );
  assert.equal(file!.dataURL, referenceCanvasImagePath("ref_1", "thumb"));
  assert.equal(file!.mimeType, "image/png");
});

test("a reference nothing asked about is served its original", () => {
  const [file] = sceneFiles(
    [{ id: "ref_1", gcsUri: "gs://bucket/projects/p1/references/one.png", createdAt: new Date(0) }],
    new Map(),
  );
  assert.equal(file!.dataURL, referenceCanvasImagePath("ref_1"));
});

test("an object with no readable extension still gets a usable type", () => {
  const [file] = sceneFiles([
    { id: "ref_1", gcsUri: "gs://bucket/projects/p1/references/no-extension", createdAt: new Date(0) },
  ]);
  assert.equal(file!.mimeType, "image/jpeg");
});

test("the director's tool settings and canvas reopen with the board", () => {
  assert.deepEqual(
    persistedAppState({
      viewBackgroundColor: "#0b0b0b",
      gridSize: 20,
      gridModeEnabled: true,
      currentItemStrokeColor: "#1e1e1e",
      currentItemFontSize: 20,
      currentItemStartArrowhead: null,
      scrollX: -420.5,
      scrollY: 88,
      zoom: { value: 1.5 },
    }),
    {
      viewBackgroundColor: "#0b0b0b",
      gridSize: 20,
      gridModeEnabled: true,
      currentItemStrokeColor: "#1e1e1e",
      currentItemFontSize: 20,
      currentItemStartArrowhead: null,
      scrollX: -420.5,
      scrollY: 88,
      zoom: { value: 1.5 },
    },
  );
});

/// appState is client input on its way into a Json column and excalidraw adds
/// keys every release, so it is copied by allowlist rather than filtered — a
/// `collaborators` Map is not even JSON, and this session's selection is not
/// the board.
test("session state and unknown keys never reach the row", () => {
  const state = persistedAppState({
    viewBackgroundColor: "#fff",
    collaborators: new Map([["socket_1", { username: "someone" }]]),
    selectedElementIds: { el_1: true },
    openDialog: { name: "imageExport" },
    draggingElement: { id: "el_1" },
    somethingAddedNextRelease: "value",
    errorMessage: "boom",
  });
  assert.deepEqual(state, { viewBackgroundColor: "#fff" });
});

/// A board reopened with zoom 0 renders nothing and offers no way back out.
test("an unusable viewport is clamped or left out rather than stored", () => {
  assert.deepEqual(persistedAppState({ zoom: { value: 0 } }), { zoom: { value: MIN_ZOOM } });
  assert.deepEqual(persistedAppState({ zoom: { value: -3 } }), { zoom: { value: MIN_ZOOM } });
  assert.deepEqual(persistedAppState({ zoom: { value: 1e6 } }), { zoom: { value: MAX_ZOOM } });
  assert.deepEqual(persistedAppState({ zoom: { value: Number.NaN } }), {});
  assert.deepEqual(persistedAppState({ zoom: 2 }), {});
  assert.deepEqual(persistedAppState({ scrollX: Number.POSITIVE_INFINITY, scrollY: "0" }), {});
});

test("appState that is not an object stores nothing", () => {
  for (const input of [null, undefined, [], "{}", 7]) {
    assert.deepEqual(persistedAppState(input), {});
  }
});

/// A freedraw stroke is a point list, so element count alone does not bound the
/// row size.
test("a scene is measured by what it would actually write", () => {
  const points = Array.from({ length: 200_000 }, (_, i) => [i, i]);
  assert.ok(exceedsSceneByteLimit([element({ type: "freedraw", points })], {}));
  assert.ok(!exceedsSceneByteLimit([element()], { viewBackgroundColor: "#fff" }));
  assert.ok(!exceedsSceneByteLimit([], {}));
});

test("the byte limit is the boundary, not an approximation", () => {
  const padding = "x".repeat(MOODBOARD_SCENE_BYTE_LIMIT);
  assert.ok(exceedsSceneByteLimit([element({ padding })], {}));
});
