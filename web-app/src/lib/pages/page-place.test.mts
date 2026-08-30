import { test } from "node:test";
import assert from "node:assert/strict";

import { placeLinesOnPage, placeOnPage } from "@/lib/pages/page-place";
import { boardPages, pageCustomData, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

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

const sizes: Record<string, { width: number; height: number }> = {
  joining: { width: 4000, height: 3000 },
};
const sizeOf = (id: string) => sizes[id] ?? null;

function pagesOf(scene: readonly SceneElement[]) {
  return pagesInReadingOrder(boardPages(scene));
}

function spread(): SceneElement[] {
  return [
    image("one", { x: 200, y: 200 }),
    page("p1", { x: 0, y: 0 }, "Cold open"),
    image("two", { x: SECOND + 200, y: 200 }),
    page("p2", { x: SECOND, y: 0 }, "Act two"),
  ];
}

function boxOf(scene: readonly SceneElement[], referenceId: string) {
  const element = scene.find((entry) => entry.fileId === `ref:${referenceId}`)!;
  return { x: element.x as number, y: element.y as number };
}

test("a picture joining a page goes on that page rather than under the board", () => {
  const scene = spread();
  const pages = pagesOf(scene);

  const result = placeOnPage({
    elements: scene,
    pages,
    page: pages[1]!,
    add: ["joining"],
    sizeOf,
    makeId: () => "new",
  });

  const placed = result.elements.find((element) => element.id === "new")!;
  assert.deepEqual(result.added, ["joining"]);
  assert.ok((placed.y as number) >= 500);
  assert.ok((placed.x as number) >= SECOND);
  assert.ok((placed.x as number) + (placed.width as number) <= SECOND + HD.width);
});

test("a picture joining a page is adopted by it, immediately before the frame", () => {
  const scene = spread();
  const pages = pagesOf(scene);

  const result = placeOnPage({
    elements: scene,
    pages,
    page: pages[1]!,
    add: ["joining"],
    sizeOf,
    makeId: () => "new",
  });

  assert.deepEqual(
    result.elements.map((element) => element.id),
    ["img-one", "p1", "img-two", "new", "p2"],
  );
  assert.equal(result.elements.find((element) => element.id === "new")!.frameId, "p2");
});

test("nothing on the board's other pages moves, and their order is kept", () => {
  const scene = spread();
  const pages = pagesOf(scene);

  const result = placeOnPage({
    elements: scene,
    pages,
    page: pages[1]!,
    add: ["joining"],
    sizeOf,
    makeId: () => "new",
  });

  assert.deepEqual(boxOf(result.elements, "one"), { x: 200, y: 200 });
  assert.deepEqual(boxOf(result.elements, "two"), { x: SECOND + 200, y: 200 });
});

test("a picture is taken off the page named and left standing on the others", () => {
  const scene = [...spread(), image("one-again", { x: SECOND + 700, y: 200 })];
  const pages = pagesOf(scene);

  const result = placeOnPage({
    elements: scene,
    pages,
    page: pages[1]!,
    remove: ["one-again", "one"],
    sizeOf,
  });

  assert.deepEqual(result.removed, ["one-again"]);
  assert.deepEqual(result.notOnBoard, ["one"]);
  assert.deepEqual(
    result.elements.map((element) => element.id),
    ["img-one", "p1", "img-two", "p2"],
  );
});

test("a picture joining a full page is kept inside it", () => {
  const scene = [
    image("low", { x: 100, y: 800, width: 800, height: 300 }),
    page("p1", { x: 0, y: 0 }, "Cold open"),
  ];
  const pages = pagesOf(scene);

  const result = placeOnPage({
    elements: scene,
    pages,
    page: pages[0]!,
    add: ["joining"],
    sizeOf,
    makeId: () => "new",
  });

  const placed = result.elements.find((element) => element.id === "new")!;
  assert.ok((placed.y as number) >= 0);
  assert.equal((placed.y as number) + (placed.height as number), HD.height);
});

test("a picture bigger than the page starts at its corner", () => {
  const scene = [
    image("filling", { x: 0, y: 0, width: HD.width, height: HD.height }),
    page("p1", { x: 0, y: 0 }, "Cold open"),
  ];
  const pages = pagesOf(scene);

  const result = placeOnPage({
    elements: scene,
    pages,
    page: pages[0]!,
    add: ["joining"],
    sizeOf,
    makeId: () => "new",
  });

  const placed = result.elements.find((element) => element.id === "new")!;
  assert.equal(placed.y, 0);
  assert.ok((placed.height as number) > HD.height);
});

test("a picture on another page still joins this one", () => {
  const scene = spread();
  const pages = pagesOf(scene);

  const result = placeOnPage({
    elements: scene,
    pages,
    page: pages[1]!,
    add: ["one"],
    sizeOf,
    makeId: () => "new",
  });

  assert.deepEqual(result.added, ["one"]);
  assert.deepEqual(result.alreadyOn, []);
});

test("a line joining a page is set above what is on that page", () => {
  const scene = spread();
  const pages = pagesOf(scene);

  const result = placeLinesOnPage({
    elements: scene,
    pages,
    page: pages[1]!,
    add: ["ACT TWO"],
    makeId: () => "new",
  });

  const line = result.elements.find((element) => element.id === "new")!;
  assert.deepEqual(result.added, ["ACT TWO"]);
  assert.ok((line.y as number) < 200);
  assert.ok((line.x as number) >= SECOND);
  assert.equal(line.frameId, "p2");
});

test("a line with no room above it is set inside the page rather than off it", () => {
  const scene = [image("top", { x: 100, y: 0 }), page("p1", { x: 0, y: 0 }, "Cold open")];
  const pages = pagesOf(scene);

  const result = placeLinesOnPage({
    elements: scene,
    pages,
    page: pages[0]!,
    add: ["ACT ONE"],
    makeId: () => "new",
  });

  const line = result.elements.find((element) => element.id === "new")!;
  assert.equal(line.y, 0);
});

test("a line is taken off the page named and left standing on the others", () => {
  const scene: SceneElement[] = [
    { id: "t1", type: "text", text: "ACT ONE", x: 100, y: 100, width: 600, height: 80 },
    page("p1", { x: 0, y: 0 }, "Cold open"),
    { id: "t2", type: "text", text: "ACT ONE", x: SECOND + 100, y: 100, width: 600, height: 80 },
    page("p2", { x: SECOND, y: 0 }, "Act two"),
  ];
  const pages = pagesOf(scene);

  const result = placeLinesOnPage({ elements: scene, pages, page: pages[1]!, remove: ["act one"] });

  assert.deepEqual(result.removed, ["act one"]);
  assert.deepEqual(
    result.elements.map((element) => element.id),
    ["t1", "p1", "p2"],
  );
});
