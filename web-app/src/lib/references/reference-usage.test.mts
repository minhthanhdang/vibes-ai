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

function at(id: string, referenceId: string, x: number, y: number) {
  return { ...image(id, referenceId), x, y, width: 200, height: 200 };
}

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

test("a deleted element does not hold a reference on a board", () => {
  const usage = boardReferenceUsage([
    { id: "b1", title: "Act one", elements: [{ ...image("e1", "r1"), isDeleted: true }] },
  ]);

  assert.deepEqual(usage, []);
});

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
  const index = referenceUsageIndex(
    boardReferenceUsage([{ id: "b1", title: "Act one", elements: [image("e1", "street")] }]),
  );

  assert.equal(removalUsageSummary(removalUsage(index, "hallway", ["hands"])), null);
  assert.equal(removalUsageSummary(removalUsage(null, "hallway", ["hands"])), null);
});

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

test("a picture between the pages of a spread is on the board and on none of them", () => {
  const usage = boardReferenceUsage([
    { id: "b1", title: "Spread", elements: [...spread(), at("e1", "r1", 1960, 400)] },
  ]);

  assert.deepEqual(usage, [
    { referenceId: "r1", boards: [{ id: "b1", title: "Spread", pages: [] }] },
  ]);
});

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

test("the pages of a spread are named to the user and to the model", () => {
  const oneBoard = [
    {
      id: "b1",
      title: "Spread",
      pages: [{ pageId: "pg-2", name: "Act two" }],
    },
  ];

  assert.equal(usageSummary(oneBoard), "On “Spread” (Act two)");
  assert.equal(usingPagesSaid(oneBoard[0]!), " on “Act two” (pg-2)");
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

test("a photo dropped from the sidebar reads back as usage of that reference", () => {
  const dropped = droppedImages(
    [{ referenceId: "r1", width: 1600, height: 900 }],
    { x: 0, y: 0 },
  ).map((element, index) => ({ ...element, id: `e${index}` }));

  const usage = boardReferenceUsage([{ id: "b1", title: "Act one", elements: dropped }]);
  assert.deepEqual(usage, [{ referenceId: "r1", boards: [{ id: "b1", title: "Act one" }] }]);
});

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

test("a photo dropped from the strip reads back as placed on that board", () => {
  const dropped = droppedImages([{ referenceId: "r1", width: 800, height: 600 }], {
    x: 0,
    y: 0,
  }).map((element, index) => ({ ...element, id: `e${index}` }));

  assert.equal(sceneReferenceCounts(dropped).get("r1"), 1);
});
