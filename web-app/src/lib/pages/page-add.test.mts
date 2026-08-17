import { test } from "node:test";
import assert from "node:assert/strict";

import { addPage } from "@/lib/pages/page-add";
import { boardPages, isPageElement, pageCustomData, pageItems } from "@/lib/pages/board-pages";
import { boardItems } from "@/lib/boards/board-contents";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// Adding a page with nothing on it. The two boards this is written for are the
/// spread that wants somewhere new to put pictures, and the board the director
/// arranged by hand — which gets its first page drawn around what is already on
/// it, and has to come out of that with its arrangement untouched.

const HD = PAGE_PRESETS.LANDSCAPE_HD;
const SECOND = HD.width + PAGE_GAP;

function page(id: string, box: { x: number; y: number }, name = id): SceneElement {
  return {
    id,
    type: "frame",
    x: box.x,
    y: box.y,
    width: HD.width,
    height: HD.height,
    name,
    customData: pageCustomData(HD.width, HD.height),
  };
}

function image(
  id: string,
  box: { x: number; y: number; width?: number; height?: number },
): SceneElement {
  return {
    id: `img-${id}`,
    type: "image",
    fileId: `ref:${id}`,
    status: "saved",
    x: box.x,
    y: box.y,
    width: box.width ?? 400,
    height: box.height ?? 300,
  };
}

let made = 0;
const makeId = () => `made-${++made}`;

const defaultSize = { width: HD.width, height: HD.height };

test("a page added to a board of one lands to its right, at its size and its top edge", () => {
  const added = addPage({
    elements: [image("one", { x: 200, y: 200 }), page("p1", { x: 0, y: 0 })],
    defaultSize,
    makeId,
  });

  assert.equal(added.page.x, SECOND);
  assert.equal(added.page.y, 0);
  assert.equal(added.page.width, HD.width);
  assert.equal(added.page.height, HD.height);
  assert.equal(added.page.preset, "LANDSCAPE_HD");
});

test("the added page is empty and the board's own pictures are neither moved nor adopted", () => {
  const before: SceneElement[] = [image("one", { x: 200, y: 200 }), page("p1", { x: 0, y: 0 })];
  const added = addPage({ elements: before, defaultSize, makeId });

  assert.equal(added.adopted, 0);
  assert.equal(pageItems(boardItems(added.elements), added.page).length, 0);
  const held = added.elements.find((element) => element.id === "img-one");
  assert.deepEqual(
    { x: held?.x, y: held?.y, frameId: held?.frameId },
    { x: 200, y: 200, frameId: undefined },
  );
});

test("a page is named one past the highest the board carries, and the director's name is kept", () => {
  const board = [page("p1", { x: 0, y: 0 }, "Page 3")];
  assert.equal(addPage({ elements: board, defaultSize, makeId }).page.name, "Page 4");
  assert.equal(
    addPage({ elements: board, defaultSize, name: "  the exteriors  ", makeId }).page.name,
    "the exteriors",
  );
});

test("a named page is the one the new one takes its size and top edge from", () => {
  const tall = PAGE_PRESETS.PORTRAIT_HD;
  const spread: SceneElement[] = [
    page("p1", { x: 0, y: 0 }),
    {
      id: "p2",
      type: "frame",
      x: SECOND,
      y: 300,
      width: tall.width,
      height: tall.height,
      name: "Act two",
      customData: pageCustomData(tall.width, tall.height),
    },
  ];

  const added = addPage({ elements: spread, defaultSize, sourcePageId: "p2", makeId });
  assert.deepEqual(
    { y: added.page.y, width: added.page.width, height: added.page.height },
    { y: 300, width: tall.width, height: tall.height },
  );
  /// Past the rightmost edge on the board, which is the named page's own here.
  assert.equal(added.page.x, SECOND + tall.width + PAGE_GAP);
});

test("a hand-made board's first page is drawn around what is on it and adopts it", () => {
  const byHand: SceneElement[] = [
    image("one", { x: 0, y: 0 }),
    image("two", { x: 600, y: 0 }),
    image("three", { x: 300, y: 400 }),
  ];

  const added = addPage({ elements: byHand, defaultSize, makeId });

  assert.equal(added.adopted, 3);
  assert.equal(pageItems(boardItems(added.elements), added.page).length, 3);
  assert.deepEqual(
    added.elements.filter((element) => !isPageElement(element)).map((element) => element.frameId),
    [added.page.id, added.page.id, added.page.id],
  );
});

test("the pictures a first page is drawn around do not move", () => {
  const byHand: SceneElement[] = [image("one", { x: 0, y: 0 }), image("two", { x: 600, y: 0 })];
  const added = addPage({ elements: byHand, defaultSize, makeId });

  assert.deepEqual(
    added.elements
      .filter((element) => !isPageElement(element))
      .map(({ id, x, y }) => ({ id, x, y })),
    [
      { id: "img-one", x: 0, y: 0 },
      { id: "img-two", x: 600, y: 0 },
    ],
  );
});

test("what the page adopts sits immediately before its frame, in the order it was in", () => {
  const byHand: SceneElement[] = [
    image("under", { x: 0, y: 0 }),
    image("over", { x: 100, y: 100 }),
  ];
  const added = addPage({ elements: byHand, defaultSize, makeId });

  assert.deepEqual(
    added.elements.map((element) => element.id),
    ["img-under", "img-over", added.page.id],
  );
});

test("a picture on another page of the board is not adopted by one drawn beside it", () => {
  const added = addPage({
    elements: [image("one", { x: 200, y: 200 }), page("p1", { x: 0, y: 0 })],
    defaultSize,
    makeId,
  });
  const held = added.elements.find((element) => element.id === "img-one");
  assert.equal(held?.frameId, undefined);
  assert.equal(added.adopted, 0);
});

test("a picture loose beside a spread is adopted by a page drawn over it", () => {
  const loose = image("loose", { x: SECOND + 400, y: 400 });
  const added = addPage({
    elements: [loose, page("p1", { x: 0, y: 0 })],
    defaultSize,
    makeId,
  });

  assert.equal(added.adopted, 1);
  assert.deepEqual(added.adoptedIds, ["img-loose"]);
  assert.equal(
    added.elements.find((element) => element.id === "img-loose")?.frameId,
    added.page.id,
  );
});

/// The canvas hands its whole array over, tombstones included — excalidraw keeps
/// a deleted element so undo has something to restore. A page that framed them
/// would file what the director erased under itself, and undoing that erase
/// would put the picture back on a page it was never on.
test("a picture the director erased is not adopted by a page drawn where it was", () => {
  const erased = { ...image("gone", { x: 300, y: 300 }), isDeleted: true };
  const added = addPage({ elements: [erased, image("one", { x: 0, y: 0 })], defaultSize, makeId });

  assert.deepEqual(added.adoptedIds, ["img-one"]);
  assert.equal(added.elements.find((element) => element.id === "img-gone")?.frameId, undefined);
});

test("the board's own pages come back with the new one appended and nothing else changed", () => {
  const spread: SceneElement[] = [
    image("one", { x: 200, y: 200 }),
    page("p1", { x: 0, y: 0 }, "Cold open"),
    image("two", { x: SECOND + 200, y: 200 }),
    page("p2", { x: SECOND, y: 0 }, "Act two"),
  ];
  const added = addPage({ elements: spread, defaultSize, makeId });

  assert.deepEqual(
    boardPages(added.elements).map((held) => held.name),
    ["Cold open", "Act two", added.page.name],
  );
  assert.deepEqual(added.elements.slice(0, 4), spread);
});

test("a board with nothing at all gets its first page at the board's default size, at the origin", () => {
  const added = addPage({ elements: [], defaultSize: PAGE_PRESETS.SQUARE, makeId });
  assert.deepEqual(
    { x: added.page.x, y: added.page.y, preset: added.page.preset },
    { x: 0, y: 0, preset: "SQUARE" },
  );
});
