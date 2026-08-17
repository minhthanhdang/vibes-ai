import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOM_PAGE_PRESET,
  boardPages,
  isPageElement,
  markElementAsPage,
  nextPageBox,
  nextPageName,
  pageCustomData,
  pageFrame,
  pageHolding,
  pageItems,
  pageSizeLabel,
  pagesInReadingOrder,
  renamePage,
} from "@/lib/pages/board-pages";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import { boardItems } from "@/lib/boards/board-contents";
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
  /// The marker still says what it was created at — the label above is what
  /// disagreeing with the rectangle would have looked like.
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
  /// The picture the board already had is on the page it was just given.
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

test("a section the director drew is promoted in place, at whatever size they drew it", () => {
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
      ["on", false],
      ["half-off", true],
      ["WHAT THE CITY KEEPS", false],
    ],
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

/// §V.1: the name is the frame's and it is "the director's to edit". Until a page
/// could be renamed, the only name it ever carried was the one it was made with —
/// and that name is what the director and the model both say the page by.
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
  /// Every other element is the object it was, in the place it was: a rename is
  /// one string, and a scene rebuilt around it is a write the tab has to reload
  /// for.
  assert.equal(renamed.length, scene.length);
  assert.equal(renamed[0], scene[0]);
  assert.equal(renamed[1], scene[1]);
  assert.notEqual(renamed[2], scene[2]);
});

/// A section is a frame too, and it carries a name the same way. Renaming one
/// through this would put the director's word for a page on a rectangle that no
/// page read describes.
test("only a page can be renamed — an unknown id and a plain section both refuse", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { id: "section", type: "frame", x: 0, y: 0, width: 400, height: 400, name: "the cold half" },
  ];

  assert.equal(renamePage(scene, "p9", "Act two"), null);
  assert.equal(renamePage(scene, "section", "Act two"), null);
});
