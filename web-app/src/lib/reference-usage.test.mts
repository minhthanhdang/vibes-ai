import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boardReferenceUsage,
  referenceUsageIndex,
  sameReferenceCounts,
  sceneReferenceCounts,
  usageSummary,
  usingBoards,
} from "./reference-usage";
import { droppedImages } from "./moodboard-drop";
import { referenceFileId } from "./moodboard-scene";

function image(id: string, referenceId: string) {
  return { id, type: "image", fileId: referenceFileId(referenceId) };
}

test("a board is listed once per reference however many elements name it", () => {
  const usage = boardReferenceUsage([
    { id: "b1", title: "Act one", elements: [image("e1", "r1"), image("e2", "r1")] },
  ]);

  assert.deepEqual(usage, [{ referenceId: "r1", boards: [{ id: "b1", title: "Act one" }] }]);
});

test("boards are named in the order they were given", () => {
  const usage = boardReferenceUsage([
    { id: "b1", title: "Act one", elements: [image("e1", "r1")] },
    { id: "b2", title: "Act two", elements: [image("e2", "r1")] },
  ]);

  assert.deepEqual(usingBoards(referenceUsageIndex(usage), "r1"), [
    { id: "b1", title: "Act one" },
    { id: "b2", title: "Act two" },
  ]);
});

/// A tombstone is another tab's undo stack, not the stored board — counting one
/// would warn about a photo the board no longer shows.
test("a deleted element does not hold a reference on a board", () => {
  const usage = boardReferenceUsage([
    { id: "b1", title: "Act one", elements: [{ ...image("e1", "r1"), isDeleted: true }] },
  ]);

  assert.deepEqual(usage, []);
});

/// A scene imported from excalidraw.com carries content-hash fileIds, and a
/// rectangle carries none — neither is about a reference.
test("elements that are not reference pointers are not usage", () => {
  const usage = boardReferenceUsage([
    {
      id: "b1",
      title: "Act one",
      elements: [
        { id: "e1", type: "rectangle" },
        { id: "e2", type: "image", fileId: "9f8a7b6c5d" },
        { id: "e3", type: "image" },
      ],
    },
  ]);

  assert.deepEqual(usage, []);
});

test("a board whose column never held a scene reads as using nothing", () => {
  assert.deepEqual(boardReferenceUsage([{ id: "b1", title: "Empty", elements: null }]), []);
  assert.deepEqual(boardReferenceUsage([]), []);
});

test("a reference on no board has no usage and no summary", () => {
  const index = referenceUsageIndex(
    boardReferenceUsage([{ id: "b1", title: "Act one", elements: [image("e1", "r1")] }]),
  );

  assert.deepEqual(usingBoards(index, "r2"), []);
  assert.equal(usageSummary(usingBoards(index, "r2")), null);
  assert.equal(usageSummary([]), null);
});

test("usingBoards tolerates a usage read that has not landed yet", () => {
  assert.deepEqual(usingBoards(null, "r1"), []);
});

test("one and two boards are named, more are counted", () => {
  const board = (title: string) => ({ id: title, title });

  assert.equal(usageSummary([board("Act one")]), "On “Act one”");
  assert.equal(usageSummary([board("Act one"), board("Act two")]), "On “Act one” and “Act two”");
  assert.equal(
    usageSummary([board("Act one"), board("Act two"), board("Act three")]),
    "On 3 boards",
  );
});

test("a board with a blank title is still named something", () => {
  assert.equal(usageSummary([{ id: "b1", title: "   " }]), "On “Untitled board”");
});

/// The link that cannot be seen by looking at either side: what the sidebar
/// drag puts on the board has to be what the removal warning recognises, or the
/// guard is silently about nothing.
test("a photo dropped from the sidebar reads back as usage of that reference", () => {
  const dropped = droppedImages(
    [{ referenceId: "r1", width: 1600, height: 900 }],
    { x: 0, y: 0 },
  ).map((element, index) => ({ ...element, id: `e${index}` }));

  const usage = boardReferenceUsage([{ id: "b1", title: "Act one", elements: dropped }]);
  assert.deepEqual(usage, [{ referenceId: "r1", boards: [{ id: "b1", title: "Act one" }] }]);
});

/// The same link read from the composing side: not "which boards is this photo
/// on" but "is this photo on the board I have open, and how many times".
test("a scene counts each reference once per element that shows it", () => {
  const counts = sceneReferenceCounts([
    image("e1", "r1"),
    image("e2", "r1"),
    image("e3", "r2"),
    { id: "e4", type: "rectangle" },
    { id: "e5", type: "image", fileId: "9f8a7b6c5d" },
    { ...image("e6", "r3"), isDeleted: true },
  ]);

  assert.deepEqual([...counts], [
    ["r1", 2],
    ["r2", 1],
  ]);
});

test("a board with no scene yet places nothing", () => {
  assert.equal(sceneReferenceCounts(null).size, 0);
  assert.equal(sceneReferenceCounts([]).size, 0);
});

/// Moving a photo rewrites every element on the board and changes none of this,
/// so the strip must not re-render on the quiet period of a drag.
test("two reads of the same placement compare equal", () => {
  const scene = [image("e1", "r1"), image("e2", "r1"), image("e3", "r2")];
  const moved = scene.map((element) => ({ ...element, x: 40 }));

  assert.equal(sameReferenceCounts(sceneReferenceCounts(scene), sceneReferenceCounts(moved)), true);
  assert.equal(
    sameReferenceCounts(
      sceneReferenceCounts(scene),
      sceneReferenceCounts([...scene, image("e4", "r3")]),
    ),
    false,
  );
  /// One more copy of a photo already on the board is a change: it is what the
  /// count on the tile is for.
  assert.equal(
    sameReferenceCounts(
      sceneReferenceCounts(scene),
      sceneReferenceCounts([...scene, image("e4", "r1")]),
    ),
    false,
  );
  assert.equal(
    sameReferenceCounts(sceneReferenceCounts(scene), sceneReferenceCounts([image("e1", "r1")])),
    false,
  );
});

/// The contract the strip's mark depends on: the id a dropped photo puts on the
/// board is the id the strip keys its tiles by.
test("a photo dropped from the strip reads back as placed on that board", () => {
  const dropped = droppedImages([{ referenceId: "r1", width: 800, height: 600 }], {
    x: 0,
    y: 0,
  }).map((element, index) => ({ ...element, id: `e${index}` }));

  assert.equal(sceneReferenceCounts(dropped).get("r1"), 1);
});
