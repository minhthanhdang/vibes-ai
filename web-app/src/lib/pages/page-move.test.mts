import { test } from "node:test";
import assert from "node:assert/strict";

import { moveToPage } from "@/lib/pages/page-move";
import { boardPages, pageCustomData, pageHolds, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

/// A picture carried between the pages of one board. The promise is the one the
/// swap could not make on a spread: it comes off the page it was on, so the board
/// holds it once afterwards and not twice.

const HD = PAGE_PRESETS.LANDSCAPE_HD;
const SECOND = HD.width + PAGE_GAP;

function page(id: string, x: number, name = id): SceneElement {
  return {
    id,
    type: "frame",
    x,
    y: 0,
    width: HD.width,
    height: HD.height,
    name,
    customData: pageCustomData(HD.width, HD.height),
  };
}

function image(id: string, x: number, y = 200): SceneElement {
  return {
    id: `img-${id}`,
    type: "image",
    fileId: `ref:${id}`,
    status: "saved",
    x,
    y,
    width: 400,
    height: 300,
  };
}

const sizeOf = () => ({ width: 4000, height: 3000 });

function spread(): SceneElement[] {
  return [
    image("one", 200),
    image("two", 700),
    page("p1", 0, "Cold open"),
    image("three", SECOND + 200),
    page("p2", SECOND, "Act two"),
  ];
}

function pagesOf(scene: readonly SceneElement[]) {
  return pagesInReadingOrder(boardPages(scene));
}

function onPage(scene: readonly SceneElement[], pageId: string): string[] {
  const pages = boardPages(scene);
  const page = pages.find((entry) => entry.id === pageId)!;
  return scene
    .filter((element) => element.type === "image")
    .filter((element) =>
      pageHolds(pages, page, {
        x: element.x as number,
        y: element.y as number,
        width: element.width as number,
        height: element.height as number,
      }),
    )
    .map((element) => referenceIdFromFileId(element.fileId))
    .filter((id): id is string => id !== null);
}

test("a picture moved to another page comes off the page it was on", () => {
  const scene = spread();
  const pages = pagesOf(scene);

  const move = moveToPage({
    elements: scene,
    pages,
    from: pages[0],
    to: pages[1],
    referenceIds: ["two"],
    sizeOf,
    makeId: () => "joined",
  });

  assert.deepEqual(move.moved, ["two"]);
  assert.deepEqual(onPage(move.elements, "p1"), ["one"]);
  assert.deepEqual(onPage(move.elements, "p2").sort(), ["three", "two"]);
});

/// The whole reason this is not a page-scoped swap: the board must hold the
/// photograph once when it is done, and a swap onto the target page leaves the
/// copy on the source page standing.
test("the board carries the moved picture once, not on both pages", () => {
  const scene = spread();
  const pages = pagesOf(scene);

  const move = moveToPage({
    elements: scene,
    pages,
    from: pages[0],
    to: pages[1],
    referenceIds: ["two"],
    sizeOf,
    makeId: () => "joined",
  });

  const carried = move.elements.filter(
    (element) => referenceIdFromFileId(element.fileId) === "two",
  );
  assert.equal(carried.length, 1);
});

test("what lands on the page is inside it and owned by its frame", () => {
  const scene = spread();
  const pages = pagesOf(scene);

  const move = moveToPage({
    elements: scene,
    pages,
    from: pages[0],
    to: pages[1],
    referenceIds: ["two"],
    sizeOf,
    makeId: () => "joined",
  });

  const landed = move.elements.find(
    (element) => referenceIdFromFileId(element.fileId) === "two",
  )!;
  assert.equal(landed.frameId, "p2");
  assert.ok((landed.x as number) >= SECOND);
  assert.ok((landed.x as number) + (landed.width as number) <= SECOND + HD.width);
  assert.ok((landed.y as number) + (landed.height as number) <= HD.height);
});

/// Excalidraw's ordering invariant: a frame's children come immediately before
/// it, so the page drags the picture with it.
test("the picture that joined sits immediately before the page's frame", () => {
  const scene = spread();
  const pages = pagesOf(scene);

  const move = moveToPage({
    elements: scene,
    pages,
    from: pages[0],
    to: pages[1],
    referenceIds: ["two"],
    sizeOf,
    makeId: () => "joined",
  });

  const at = move.elements.findIndex((element) => element.id === "p2");
  assert.equal(referenceIdFromFileId(move.elements[at - 1].fileId), "two");
});

test("nothing on the board's other pages moves", () => {
  const scene = spread();
  const pages = pagesOf(scene);
  const before = scene.find((element) => element.id === "img-three")!;

  const move = moveToPage({
    elements: scene,
    pages,
    from: pages[0],
    to: pages[1],
    referenceIds: ["two"],
    sizeOf,
    makeId: () => "joined",
  });

  const after = move.elements.find((element) => element.id === "img-three")!;
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
});

/// A picture the source page has not got is a pageId to correct, not a reference
/// id: the board may hold it a page away.
test("a picture that is not on the page it was to come off is named and nothing else happens", () => {
  const scene = spread();
  const pages = pagesOf(scene);

  const move = moveToPage({
    elements: scene,
    pages,
    from: pages[0],
    to: pages[1],
    referenceIds: ["three"],
    sizeOf,
    makeId: () => "joined",
  });

  assert.deepEqual(move.notOnFrom, ["three"]);
  assert.deepEqual(move.moved, []);
  assert.deepEqual(move.elements, scene);
});

/// On the source page and already on the target: it comes off the one and is not
/// drawn twice on the other.
test("a picture already on the page it is going to only comes off the page it was on", () => {
  const scene = [...spread(), { ...image("two", SECOND + 700), id: "img-two-again" }];
  const pages = pagesOf(scene);

  const move = moveToPage({
    elements: scene,
    pages,
    from: pages[0],
    to: pages[1],
    referenceIds: ["two"],
    sizeOf,
    makeId: () => "joined",
  });

  assert.deepEqual(move.alreadyThere, ["two"]);
  assert.deepEqual(move.moved, []);
  assert.deepEqual(onPage(move.elements, "p1"), ["one"]);
  assert.deepEqual(onPage(move.elements, "p2").sort(), ["three", "two"]);
});

/// §V.3's membership is geometric and exclusive, so a picture the director
/// dragged onto page 2 while its `frameId` still says page 1 is page 2's — and a
/// move off page 1 must not take it.
test("membership is by centre rather than by frameId", () => {
  const dragged = { ...image("two", SECOND + 700), frameId: "p1" };
  const scene = [image("one", 200), page("p1", 0), dragged, page("p2", SECOND)];
  const pages = pagesOf(scene);

  const move = moveToPage({
    elements: scene,
    pages,
    from: pages[0],
    to: pages[1],
    referenceIds: ["two"],
    sizeOf,
    makeId: () => "joined",
  });

  assert.deepEqual(move.notOnFrom, ["two"]);
  assert.deepEqual(move.moved, []);
});
