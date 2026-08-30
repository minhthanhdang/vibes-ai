import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOM_PAGE_PRESET,
  boardPages,
  isPageElement,
  itemsOnPage,
  markElementAsPage,
  nextPageBox,
  nextPageName,
  pageChildOrder,
  pageCustomData,
  pageFrame,
  pageHolding,
  pageBackground,
  pageHolds,
  pageItems,
  pageSizeLabel,
  pagesInReadingOrder,
  frameJoining,
  renamePage,
} from "@/lib/pages/board-pages";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import { boardItems } from "@/lib/boards/board-contents";
import { boardFrames } from "@/lib/canvas/moodboard-frames";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

function page(
  id: string,
  box: { x: number; y: number; width?: number; height?: number },
  over: Partial<SceneElement> = {},
): SceneElement {
  const width = box.width ?? HD.width;
  const height = box.height ?? HD.height;
  return {
    id,
    type: "frame",
    x: box.x,
    y: box.y,
    width,
    height,
    name: id,
    customData: pageCustomData(width, height),
    ...over,
  };
}

function image(id: string, box: { x: number; y: number; width: number; height: number }): SceneElement {
  return { id, type: "image", fileId: `ref:${id}`, ...box };
}

test("a page is a frame carrying the marker, and a plain frame is still just a section", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { id: "section", type: "frame", x: 0, y: 0, width: 400, height: 400, name: "the cold half" },
    { id: "magic", type: "magicframe", x: 0, y: 0, width: 400, height: 400, customData: { page: true } },
    { id: "rect", type: "rectangle", x: 0, y: 0, width: 400, height: 400, customData: { page: true } },
  ];

  assert.deepEqual(
    boardPages(scene).map((found) => found.id),
    ["p1"],
  );
  assert.equal(isPageElement(scene[1]), false);
});

test("the size is the rectangle's, and the label is derived from it every read", () => {
  const [resized] = boardPages([
    page("p1", { x: 0, y: 0 }, { width: 1600, height: 900 }),
  ]);

  assert.equal(resized?.width, 1600);
  assert.equal(resized?.preset, CUSTOM_PAGE_PRESET);
  assert.equal(resized?.createdAs, "LANDSCAPE_HD");
});

test("a preset survives the fractional pixels a drag leaves behind", () => {
  assert.equal(pageSizeLabel(1920.4, 1079.7), "LANDSCAPE_HD");
  assert.equal(pageSizeLabel(1080, 1920), "PORTRAIT_HD");
  assert.equal(pageSizeLabel(1900, 1080), CUSTOM_PAGE_PRESET);
});

test("a frame with no real box is not a page anything can be put on", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }, { width: 0 }),
    page("p2", { x: 0, y: 0 }, { height: Number.NaN }),
    page("p3", { x: 0, y: 0 }),
    page("p4", { x: 0, y: 0 }, { isDeleted: true }),
  ];

  assert.deepEqual(
    boardPages(scene).map((found) => found.id),
    ["p3"],
  );
});

test("pages are read left to right, whatever order they were drawn in", () => {
  const pages = boardPages([
    page("third", { x: 4200, y: 0 }),
    page("first", { x: 0, y: 0 }),
    page("second", { x: 2100, y: 0 }),
  ]);

  assert.deepEqual(
    pagesInReadingOrder(pages).map((found) => found.id),
    ["first", "second", "third"],
  );
});

test("the next page takes the source page's size and lands past the rightmost one", () => {
  const pages = boardPages([
    page("p1", { x: 0, y: 0 }),
    page("p2", { x: 3000, y: 0, width: 1080, height: 1920 }),
  ]);

  const box = nextPageBox({ pages, sourcePageId: "p1", defaultSize: { width: 800, height: 600 } });

  assert.deepEqual(box, { x: 3000 + 1080 + PAGE_GAP, y: 0, width: HD.width, height: HD.height });
});

test("with no page selected the last created one is the source", () => {
  const pages = boardPages([
    page("p1", { x: 0, y: 0 }),
    page("p2", { x: 3000, y: 400, width: 1080, height: 1920 }),
  ]);

  const box = nextPageBox({ pages, defaultSize: { width: 800, height: 600 } });

  assert.deepEqual(box, {
    x: 3000 + 1080 + PAGE_GAP,
    y: 400,
    width: 1080,
    height: 1920,
  });
});

test("the first page is drawn at the board's default size, around what is already there", () => {
  const around = boardItems([image("a", { x: 1000, y: 1000, width: 200, height: 200 })]);

  const box = nextPageBox({ defaultSize: HD, around });

  assert.deepEqual(box, { x: 1100 - HD.width / 2, y: 1100 - HD.height / 2, ...HD });
  assert.equal(
    pageItems(around, box).length,
    1,
  );
});

test("an empty board's first page starts at the origin", () => {
  assert.deepEqual(nextPageBox({ defaultSize: HD }), { x: 0, y: 0, ...HD });
});

test("naming counts past the highest page the board carries, not the pages left on it", () => {
  const pages = boardPages([
    page("p1", { x: 0, y: 0 }, { name: "Page 2" }),
    page("p2", { x: 3000, y: 0 }, { name: "the cold open" }),
  ]);

  assert.equal(nextPageName(pages), "Page 3");
  assert.equal(nextPageName([]), "Page 1");
});

test("a composed frame carries the marker and the name it was given", () => {
  const frame = pageFrame(
    { x: 10, y: 20, ...HD },
    { name: "Page 1", makeId: () => "frame-1" },
  );

  assert.equal(frame.type, "frame");
  assert.deepEqual(frame.customData, { page: { preset: "LANDSCAPE_HD" } });
  assert.deepEqual(boardPages([frame]), [
    {
      id: "frame-1",
      name: "Page 1",
      x: 10,
      y: 20,
      width: HD.width,
      height: HD.height,
      preset: "LANDSCAPE_HD",
      createdAs: "LANDSCAPE_HD",
    },
  ]);
});

test("a section the user drew is promoted in place, at whatever size they drew it", () => {
  const section: SceneElement = {
    id: "section",
    type: "frame",
    x: 0,
    y: 0,
    width: 640,
    height: 480,
    name: "the cold half",
    customData: { note: "kept" },
  };

  const promoted = markElementAsPage(section);

  assert.deepEqual(promoted.customData, { note: "kept", page: {} });
  assert.deepEqual(
    boardPages([promoted]).map((found) => [found.name, found.preset, found.createdAs]),
    [["the cold half", CUSTOM_PAGE_PRESET, null]],
  );
});

test("what is on a page is decided by where it sits, not by the frame it claims", () => {
  const items = boardItems([
    { ...image("on", { x: 100, y: 100, width: 200, height: 200 }), frameId: "some-other-frame" },
    { ...image("off", { x: 3000, y: 0, width: 200, height: 200 }), frameId: "p1" },
    image("half-off", { x: -100, y: 200, width: 400, height: 200 }),
    { id: "line", type: "text", text: "WHAT THE CITY KEEPS", x: 400, y: 600, width: 600, height: 60 },
  ]);

  const [board] = boardPages([page("p1", { x: 0, y: 0 })]);

  assert.deepEqual(
    pageItems(items, board!).map((item) => [item.referenceId ?? item.text, item.clipped]),
    [
      ["half-off", true],
      ["on", false],
      ["WHAT THE CITY KEEPS", false],
    ],
  );
});

test("a page is read down its bands, so a column-height picture does not drag the page into one row", () => {
  const items = boardItems([
    image("top left", { x: 60, y: 60, width: 500, height: 280 }),
    image("column", { x: 620, y: 60, width: 440, height: 960 }),
    image("under it", { x: 60, y: 400, width: 500, height: 280 }),
  ]);

  const [first] = boardPages([page("p1", { x: 0, y: 0 })]);

  assert.deepEqual(
    pageItems(items, first!).map((item) => item.referenceId),
    ["top left", "column", "under it"],
  );
});

test("two blocks set a few pixels apart are read as one row, left to right", () => {
  const items = boardItems([
    image("right", { x: 700, y: 100, width: 400, height: 300 }),
    image("left", { x: 100, y: 120, width: 400, height: 300 }),
  ]);

  const [first] = boardPages([page("p1", { x: 0, y: 0 })]);

  assert.deepEqual(
    pageItems(items, first!).map((item) => item.referenceId),
    ["left", "right"],
  );
});

test("the bands are a share of the page height, not a fixed number of pixels", () => {
  const tall = boardPages([page("p1", { x: 0, y: 0 }, { width: 1080, height: 1920 })]);
  const stepped = boardItems([
    image("under", { x: 100, y: 300, width: 300, height: 200 }),
    image("over", { x: 600, y: 120, width: 300, height: 200 }),
  ]);

  assert.deepEqual(
    pageItems(stepped, tall[0]!).map((item) => item.referenceId),
    ["under", "over"],
  );
  const [wide] = boardPages([page("p2", { x: 0, y: 0 })]);
  assert.deepEqual(
    pageItems(stepped, wide!).map((item) => item.referenceId),
    ["over", "under"],
  );
});

test("a picture straddling two pages is on the one its middle is over", () => {
  const pages = boardPages([
    page("p1", { x: 0, y: 0 }),
    page("p2", { x: HD.width + PAGE_GAP, y: 0 }),
  ]);
  const straddling = { x: HD.width - 100, y: 0, width: 100 + PAGE_GAP + 300, height: 200 };

  assert.equal(pageHolding(pages, straddling)?.id, "p2");
  assert.equal(pageHolding(pages, { x: 0, y: 4000, width: 10, height: 10 }), null);
});

test("a picture where two pages overlap is on the topmost of them and on no other", () => {
  const scene = [
    page("under", { x: 0, y: 0 }),
    page("over", { x: HD.width / 2, y: 0 }),
    image("shared", { x: HD.width / 2 + 100, y: 100, width: 300, height: 200 }),
    image("under-only", { x: 100, y: 100, width: 300, height: 200 }),
  ];
  const pages = boardPages(scene);
  const items = boardItems(scene);

  assert.equal(pageHolding(pages, items[0]!)?.id, "over");
  assert.deepEqual(
    itemsOnPage(items, pages, pages[1]!).map((item) => item.referenceId),
    ["shared"],
  );
  assert.deepEqual(
    itemsOnPage(items, pages, pages[0]!).map((item) => item.referenceId),
    ["under-only"],
  );
});

test("the page a picture is on says so and the page beside it does not", () => {
  const scene = [page("under", { x: 0, y: 0 }), page("over", { x: HD.width / 2, y: 0 })];
  const pages = boardPages(scene);
  const box = { x: HD.width / 2 + 100, y: 100, width: 300, height: 200 };

  assert.equal(pageHolds(pages, pages[1]!, box), true);
  assert.equal(pageHolds(pages, pages[0]!, box), false);
});

test("pages that do not overlap keep every picture the rectangle rule gives them", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    page("p2", { x: HD.width + PAGE_GAP, y: 0 }),
    image("a", { x: 100, y: 100, width: 300, height: 200 }),
    image("b", { x: HD.width + PAGE_GAP + 100, y: 100, width: 300, height: 200 }),
    image("loose", { x: 0, y: 4000, width: 300, height: 200 }),
  ];
  const pages = boardPages(scene);
  const items = boardItems(scene);

  assert.deepEqual(
    pages.map((one) => itemsOnPage(items, pages, one).map((item) => item.referenceId)),
    [["a"], ["b"]],
  );
});

test("a page is renamed in place and nothing else in the scene moves", () => {
  const scene = [
    image("a", { x: 100, y: 100, width: 200, height: 200 }),
    page("p1", { x: 0, y: 0 }),
    page("p2", { x: HD.width + PAGE_GAP, y: 0 }),
  ];

  const renamed = renamePage(scene, "p2", "  Act two  ")!;

  assert.deepEqual(
    boardPages(renamed).map((found) => [found.id, found.name]),
    [
      ["p1", "p1"],
      ["p2", "Act two"],
    ],
  );
  assert.equal(renamed.length, scene.length);
  assert.equal(renamed[0], scene[0]);
  assert.equal(renamed[1], scene[1]);
  assert.notEqual(renamed[2], scene[2]);
});

test("only a page can be renamed — an unknown id and a plain section both refuse", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { id: "section", type: "frame", x: 0, y: 0, width: 400, height: 400, name: "the cold half" },
  ];

  assert.equal(renamePage(scene, "p9", "Act two"), null);
  assert.equal(renamePage(scene, "section", "Act two"), null);
});

test("a page's children are gathered immediately before it, in the order they had", () => {
  const scene = [
    { ...image("first", { x: 10, y: 10, width: 100, height: 100 }), frameId: "p1" },
    image("loose", { x: 5000, y: 0, width: 100, height: 100 }),
    { ...image("second", { x: 200, y: 10, width: 100, height: 100 }), frameId: "p1" },
    page("p1", { x: 0, y: 0 }),
    { ...image("after", { x: 400, y: 10, width: 100, height: 100 }), frameId: "p1" },
  ];

  assert.deepEqual(
    pageChildOrder(scene).map((element) => element.id),
    ["loose", "first", "second", "after", "p1"],
  );
});

test("a section's children and a board with no page at all are left in their order", () => {
  const sectioned = [
    { ...image("a", { x: 10, y: 10, width: 100, height: 100 }), frameId: "act-one" },
    image("b", { x: 900, y: 10, width: 100, height: 100 }),
    { id: "act-one", type: "frame", x: 0, y: 0, width: 400, height: 400, name: "act one" },
  ];

  assert.deepEqual(pageChildOrder(sectioned).map((element) => element.id), ["a", "b", "act-one"]);

  const paged = [
    ...sectioned,
    page("p1", { x: 2000, y: 0 }),
  ];
  assert.deepEqual(
    pageChildOrder(paged).map((element) => element.id),
    ["a", "b", "act-one", "p1"],
  );
});

test("a frame naming a page as its own frame is not gathered into it", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { id: "act-one", type: "frame", x: 10, y: 10, width: 400, height: 400, name: "act one", frameId: "p1" },
    { ...image("shot", { x: 20, y: 20, width: 100, height: 100 }), frameId: "p1" },
  ];

  assert.deepEqual(
    pageChildOrder(scene).map((element) => element.id),
    ["shot", "p1", "act-one"],
  );
});

test("a photo dropped over a page's edge joins it, where a section only takes what it contains", () => {
  const scene = [
    { id: "act-one", type: "frame", x: 0, y: 0, width: 400, height: 400, name: "act one" },
    page("p1", { x: 1000, y: 0 }),
  ];
  const frames = boardFrames(scene);
  const pages = boardPages(scene);

  const over = { x: 940, y: 100, width: 200, height: 200 };
  assert.equal(frameJoining(frames, pages, over), "p1");

  assert.equal(frameJoining(frames, pages, { x: -60, y: 100, width: 200, height: 200 }), null);

  assert.equal(frameJoining(frames, pages, { x: 100, y: 100, width: 200, height: 200 }), "act-one");

  assert.equal(frameJoining(frames, pages, { x: 860, y: 100, width: 200, height: 200 }), null);

  assert.equal(frameJoining(frames, pages, { x: 600, y: 600, width: 100, height: 100 }), null);
});

test("a photo dropped into a section standing on a page joins the section", () => {
  const scene = [
    { id: "act-one", type: "frame", x: 100, y: 100, width: 400, height: 400, name: "act one" },
    page("p1", { x: 0, y: 0 }),
  ];

  assert.equal(
    frameJoining(boardFrames(scene), boardPages(scene), { x: 200, y: 200, width: 100, height: 100 }),
    "act-one",
  );
});

test("a photo dropped where two pages overlap joins the topmost", () => {
  const scene = [page("under", { x: 0, y: 0 }), page("over", { x: 800, y: 0 })];

  assert.equal(
    frameJoining(boardFrames(scene), boardPages(scene), { x: 1000, y: 400, width: 200, height: 200 }),
    "over",
  );
});

test("the back-most picture covering a page with something else on it is its background", () => {
  const [board] = boardPages([page("p1", { x: 0, y: 0 })]);
  const items = boardItems([
    image("sketch", { x: -240, y: 0, width: HD.width + 480, height: HD.height }),
    image("a", { x: 100, y: 100, width: 400, height: 300 }),
  ]);

  assert.equal(pageBackground(pageItems(items, board!), board!)?.referenceId, "sketch");
});

test("a page holding one picture has no background, however that picture covers it", () => {
  const [board] = boardPages([page("p1", { x: 0, y: 0 })]);
  const alone = boardItems([image("hero", { x: 0, y: 0, width: HD.width, height: HD.height })]);

  assert.equal(pageBackground(pageItems(alone, board!), board!), null);
});

test("the back-most picture is not a background unless it covers the page", () => {
  const [board] = boardPages([page("p1", { x: 0, y: 0 })]);
  const items = boardItems([
    image("under", { x: 100, y: 100, width: 800, height: 600 }),
    image("over", { x: 300, y: 200, width: 800, height: 600 }),
  ]);

  assert.equal(pageBackground(pageItems(items, board!), board!), null);
  const nearly = boardItems([
    image("nearly", { x: 2, y: 0, width: HD.width, height: HD.height }),
    image("a", { x: 100, y: 100, width: 400, height: 300 }),
  ]);
  assert.equal(pageBackground(pageItems(nearly, board!), board!), null);
});

test("a covering picture a float short of the edge is still the background", () => {
  const [board] = boardPages([page("p1", { x: 0, y: 0 })]);
  const items = boardItems([
    image("sketch", { x: 0.0001, y: 0, width: HD.width - 0.0002, height: HD.height }),
    image("a", { x: 100, y: 100, width: 400, height: 300 }),
  ]);

  assert.equal(pageBackground(pageItems(items, board!), board!)?.referenceId, "sketch");
});

test("the thing at the back is a background only when it is a picture", () => {
  const [board] = boardPages([page("p1", { x: 0, y: 0 })]);
  const items = boardItems([
    { id: "line", type: "text", text: "WHAT THE CITY KEEPS", x: 0, y: 0, width: HD.width, height: HD.height },
    image("a", { x: 100, y: 100, width: 400, height: 300 }),
  ]);

  assert.equal(pageBackground(pageItems(items, board!), board!), null);
});
