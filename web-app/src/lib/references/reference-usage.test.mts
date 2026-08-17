import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boardReferenceUsage,
  referenceUsageIndex,
  removalUsage,
  removalUsageSummary,
  sameReferenceCounts,
  sceneReferenceCounts,
  usageSummary,
  usingBoards,
  usingPagesSaid,
} from "@/lib/references/reference-usage";
import { droppedImages } from "@/lib/canvas/moodboard-drop";
import { pageFrame } from "@/lib/pages/board-pages";
import { referenceFileId } from "@/lib/scene/moodboard-scene";

function image(id: string, referenceId: string) {
  return { id, type: "image", fileId: referenceFileId(referenceId) };
}

/// The same picture, put somewhere: geometry is what decides which page an
/// element is on (§V.3), so a usage read on a spread needs boxes rather than
/// bare pointers.
function at(id: string, referenceId: string, x: number, y: number) {
  return { ...image(id, referenceId), x, y, width: 200, height: 200 };
}

/// A two-page spread: pages side by side with PAGE_GAP between them, which is
/// the geometry `add_page` and a `newPage` compose both draw.
function spread() {
  return [
    pageFrame({ x: 0, y: 0, width: 1920, height: 1080 }, { name: "Act one", makeId: () => "pg-1" }),
    pageFrame(
      { x: 2120, y: 0, width: 1920, height: 1080 },
      { name: "Act two", makeId: () => "pg-2" },
    ),
  ];
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

/// The half of the removal the guard could not see: a frame is deleted from the
/// gallery and its cuts go with it — the row cascades — so a photograph on no
/// board at all can still be the only thing holding up two.
test("a frame kept off every board is still holding up the boards its cuts are on", () => {
  const index = referenceUsageIndex(
    boardReferenceUsage([
      { id: "b1", title: "Act one", elements: [image("e1", "hands")] },
      { id: "b2", title: "Act two", elements: [image("e2", "knuckles")] },
    ]),
  );

  const usage = removalUsage(index, "hallway", ["hands", "knuckles"]);
  assert.deepEqual(usage.own, []);
  assert.deepEqual(usage.viaVersions, [
    { id: "b1", title: "Act one" },
    { id: "b2", title: "Act two" },
  ]);
  assert.equal(removalUsageSummary(usage), "Its crops are on “Act one” and “Act two”");
});

test("a board is named once whether the frame or its cut is on it", () => {
  /// Both on one board is the frame's board: it is already named, and naming it
  /// twice says nothing more about what the delete costs.
  const index = referenceUsageIndex(
    boardReferenceUsage([
      { id: "b1", title: "Act one", elements: [image("e1", "hallway"), image("e2", "hands")] },
    ]),
  );

  const usage = removalUsage(index, "hallway", ["hands"]);
  assert.deepEqual(usage.own, [{ id: "b1", title: "Act one" }]);
  assert.deepEqual(usage.viaVersions, []);
  assert.equal(removalUsageSummary(usage), "On “Act one”");
});

test("the frame's boards and its crops' boards are told apart", () => {
  /// Said as crops rather than folded into one list: "On “Act two”" about a
  /// photograph that is not on Act two is a warning the director cannot check by
  /// looking at the board.
  const index = referenceUsageIndex(
    boardReferenceUsage([
      { id: "b1", title: "Act one", elements: [image("e1", "hallway")] },
      { id: "b2", title: "Act two", elements: [image("e2", "hands")] },
    ]),
  );

  assert.equal(
    removalUsageSummary(removalUsage(index, "hallway", ["hands"])),
    "On “Act one” — its crops on “Act two”",
  );
});

test("a frame with cuts on no board warns about nothing, as before", () => {
  /// The guard has to be about something or it becomes the thing that is clicked
  /// through — a cut that was never placed changes nothing about the delete.
  const index = referenceUsageIndex(
    boardReferenceUsage([{ id: "b1", title: "Act one", elements: [image("e1", "street")] }]),
  );

  assert.equal(removalUsageSummary(removalUsage(index, "hallway", ["hands"])), null);
  assert.equal(removalUsageSummary(removalUsage(null, "hallway", ["hands"])), null);
});

/// A board of one page is the page: the answer it gave before pages existed is
/// the answer it goes on giving, and an absent key is what makes that assertable.
test("a board of one page says nothing about pages", () => {
  const usage = boardReferenceUsage([
    {
      id: "b1",
      title: "Act one",
      elements: [
        pageFrame({ x: 0, y: 0, width: 1920, height: 1080 }, { name: "Page 1", makeId: () => "p" }),
        at("e1", "r1", 100, 100),
      ],
    },
  ]);

  assert.deepEqual(usage, [{ referenceId: "r1", boards: [{ id: "b1", title: "Act one" }] }]);
});

test("a spread names the pages the reference is on, in reading order", () => {
  const usage = boardReferenceUsage([
    {
      id: "b1",
      title: "Spread",
      elements: [
        ...spread(),
        /// The copy on page 2 first in the array, so reading order is being
        /// asserted rather than the order the copies were met in.
        at("e1", "r1", 2200, 100),
        at("e2", "r1", 100, 100),
        at("e3", "r2", 2400, 400),
      ],
    },
  ]);

  assert.deepEqual(usingBoards(referenceUsageIndex(usage), "r1"), [
    {
      id: "b1",
      title: "Spread",
      pages: [
        { pageId: "pg-1", name: "Act one" },
        { pageId: "pg-2", name: "Act two" },
      ],
    },
  ]);
  assert.deepEqual(usingBoards(referenceUsageIndex(usage), "r2"), [
    { id: "b1", title: "Spread", pages: [{ pageId: "pg-2", name: "Act two" }] },
  ]);
});

/// The place a page-scoped call would never find it: on the board, between its
/// pages. Empty rather than absent, because absent is what a board of one page
/// says and the two are different facts.
test("a picture between the pages of a spread is on the board and on none of them", () => {
  const usage = boardReferenceUsage([
    { id: "b1", title: "Spread", elements: [...spread(), at("e1", "r1", 1960, 400)] },
  ]);

  assert.deepEqual(usage, [
    { referenceId: "r1", boards: [{ id: "b1", title: "Spread", pages: [] }] },
  ]);
});

/// Membership is the centre of the box, never `frameId` — the rule every other
/// page read in this codebase follows, and the one that agrees with the render.
test("a picture is on the page its centre sits on whatever frame it names", () => {
  const usage = boardReferenceUsage([
    {
      id: "b1",
      title: "Spread",
      elements: [...spread(), { ...at("e1", "r1", 2200, 100), frameId: "pg-1" }],
    },
  ]);

  assert.deepEqual(usage[0]!.boards[0]!.pages, [{ pageId: "pg-2", name: "Act two" }]);
});

test("the pages of a spread are named to the director and to the model", () => {
  const oneBoard = [
    {
      id: "b1",
      title: "Spread",
      pages: [{ pageId: "pg-2", name: "Act two" }],
    },
  ];

  assert.equal(usageSummary(oneBoard), "On “Spread” (Act two)");
  assert.equal(usingPagesSaid(oneBoard[0]!), " on “Act two” (pg-2)");
  /// The board of one page has no pageId to pass and no page to name.
  assert.equal(usingPagesSaid({ id: "b1", title: "Spread" }), "");
  assert.equal(usageSummary([{ id: "b1", title: "Spread" }]), "On “Spread”");
  assert.equal(
    usageSummary([{ id: "b1", title: "Spread", pages: [] }]),
    "On “Spread” (on none of its pages)",
  );
  assert.equal(
    usageSummary([
      {
        id: "b1",
        title: "Spread",
        pages: [
          { pageId: "pg-1", name: "Act one" },
          { pageId: "pg-2", name: "Act two" },
          { pageId: "pg-3", name: "Act three" },
        ],
      },
    ]),
    "On “Spread” (3 pages of it)",
  );
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
