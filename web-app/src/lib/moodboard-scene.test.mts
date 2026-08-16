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
/// app's own stable image path, which redirects to a freshly signed read URL,
/// so a board left open past a signature's lifetime still renders.
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
    ],
  );
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
