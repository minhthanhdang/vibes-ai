import { test } from "node:test";
import assert from "node:assert/strict";

import { pageContents, pageDigests, picturesOffPages } from "@/lib/pages/page-contents";
import { boardPages, pageCustomData } from "@/lib/pages/board-pages";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

function page(
  id: string,
  box: { x: number; y: number; width?: number; height?: number },
  name = id,
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
    name,
    customData: pageCustomData(width, height),
  };
}

function image(
  id: string,
  box: { x: number; y: number; width?: number; height?: number },
  fileId = `ref:${id}`,
): SceneElement {
  return { id, type: "image", fileId, x: box.x, y: box.y, width: box.width ?? 400, height: box.height ?? 300 };
}

function line(id: string, text: string, box: { x: number; y: number }): SceneElement {
  return { id, type: "text", text, x: box.x, y: box.y, width: 600, height: 80 };
}

test("a page's contents are the pictures and the lines on it, in reading order", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    image("b", { x: 900, y: 100 }),
    image("a", { x: 100, y: 100 }),
    line("t", "WHAT THE CITY KEEPS", { x: 100, y: 600 }),
  ];

  const contents = pageContents(scene, boardPages(scene)[0]!);

  assert.deepEqual(
    contents.pictures.map((picture) => picture.referenceId),
    ["a", "b"],
  );
  assert.deepEqual(contents.lines, ["WHAT THE CITY KEEPS"]);
  assert.equal(contents.unnamedImages, 0);
});

test("a picture whose centre is off the page is not on it, however the scene has it filed", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { ...image("beside", { x: 2200, y: 100 }), frameId: "p1" },
  ];

  assert.deepEqual(pageContents(scene, boardPages(scene)[0]!).pictures, []);
});

test("a picture hanging over the page edge is on it and marked clipped", () => {
  const scene = [page("p1", { x: 0, y: 0 }), image("a", { x: -100, y: 100 })];

  assert.deepEqual(pageContents(scene, boardPages(scene)[0]!).pictures, [
    { referenceId: "a", clipped: true },
  ]);
});

test("a reference placed twice on a page is one picture, clipped if either copy is", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    image("a", { x: 100, y: 100 }),
    { ...image("a-again", { x: -50, y: 500 }), fileId: "ref:a" },
  ];

  assert.deepEqual(pageContents(scene, boardPages(scene)[0]!).pictures, [
    { referenceId: "a", clipped: true },
  ]);
});

test("images naming nothing this project holds are counted, not listed", () => {
  const scene = [page("p1", { x: 0, y: 0 }), image("pasted", { x: 100, y: 100 }, "pasted-bytes")];

  const contents = pageContents(scene, boardPages(scene)[0]!);
  assert.deepEqual(contents.pictures, []);
  assert.equal(contents.unnamedImages, 1);
});

test("the digest of a board is its pages in reading order, numbered and counted", () => {
  const scene = [
    page("p2", { x: HD.width + 200, y: 0 }, "Cold open"),
    page("p1", { x: 0, y: 0 }, "Page 1"),
    image("a", { x: 100, y: 100 }),
    line("t", "ACT ONE", { x: 100, y: 600 }),
    image("b", { x: HD.width + 300, y: 100 }),
    image("c", { x: HD.width + 100, y: 500 }),
  ];

  assert.deepEqual(pageDigests(scene), [
    {
      pageId: "p1",
      name: "Page 1",
      position: 1,
      of: 2,
      width: HD.width,
      height: HD.height,
      preset: "LANDSCAPE_HD",
      pictures: 1,
      lines: 1,
      shapes: 0,
      clipped: 0,
    },
    {
      pageId: "p2",
      name: "Cold open",
      position: 2,
      of: 2,
      width: HD.width,
      height: HD.height,
      preset: "LANDSCAPE_HD",
      pictures: 2,
      lines: 0,
      shapes: 0,
      clipped: 1,
    },
  ]);
});

test("a resized page is listed as Custom", () => {
  const [digest] = pageDigests([page("p1", { x: 0, y: 0, width: 1600, height: 900 })]);

  assert.equal(digest?.preset, "Custom");
  assert.equal(digest?.width, 1600);
});

test("a board with no pages digests to nothing at all", () => {
  assert.deepEqual(pageDigests([image("a", { x: 0, y: 0 })]), []);
});

test("pictures sitting on no page are named, and a board without pages has none to name", () => {
  const scene = [page("p1", { x: 0, y: 0 }), image("on", { x: 100, y: 100 }), image("off", { x: 3000, y: 100 })];

  assert.deepEqual(picturesOffPages(scene, boardPages(scene)), ["off"]);
  assert.deepEqual(picturesOffPages(scene, []), []);
});

test("the picture standing behind a page is named apart from the photographs on it", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    image("sketch", { x: -240, y: 0, width: HD.width + 480, height: HD.height }),
    image("a", { x: 100, y: 100 }),
    image("b", { x: 900, y: 100 }),
  ];

  const contents = pageContents(scene, boardPages(scene)[0]!);

  assert.equal(contents.background, "sketch");
  assert.deepEqual(
    contents.pictures.map((picture) => picture.referenceId),
    ["a", "b"],
  );
});

test("a page's count leaves its background out", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    image("sketch", { x: -240, y: 0, width: HD.width + 480, height: HD.height }),
    image("a", { x: 100, y: 100 }),
    image("b", { x: 900, y: 100 }),
  ];

  assert.equal(pageDigests(scene)[0]!.pictures, 2);
});

test("a page holding only a full-bleed picture holds a picture, not a background", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    image("hero", { x: 0, y: 0, width: HD.width, height: HD.height }),
  ];

  const contents = pageContents(scene, boardPages(scene)[0]!);
  assert.equal(contents.background, null);
  assert.deepEqual(
    contents.pictures.map((picture) => picture.referenceId),
    ["hero"],
  );
});

test("a background naming nothing the project holds is neither a picture nor an unnamed one", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { ...image("pasted", { x: -240, y: 0, width: HD.width + 480, height: HD.height }), fileId: "elsewhere" },
    image("a", { x: 100, y: 100 }),
  ];

  const contents = pageContents(scene, boardPages(scene)[0]!);
  assert.equal(contents.background, null);
  assert.equal(contents.unnamedImages, 0);
  assert.deepEqual(
    contents.pictures.map((picture) => picture.referenceId),
    ["a"],
  );
});

test("shapes on a page are counted beside the pictures rather than among them", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { id: "ground", type: "rectangle", x: 0, y: 0, width: HD.width, height: HD.height },
    image("a", { x: 100, y: 100 }),
    image("b", { x: 900, y: 100 }),
    line("l1", "WHAT THE CITY KEEPS", { x: 100, y: 700 }),
  ];

  const contents = pageContents(scene, boardPages(scene)[0]!);

  assert.equal(contents.shapes, 1);
  assert.deepEqual(
    contents.pictures.map((picture) => picture.referenceId),
    ["a", "b"],
  );
  assert.deepEqual(contents.lines, ["WHAT THE CITY KEEPS"]);
  assert.equal(pageDigests(scene)[0]!.shapes, 1);
});

test("a shape at the back does not take the backdrop off the picture covering the page", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { id: "ground", type: "rectangle", x: 0, y: 0, width: HD.width, height: HD.height },
    image("sketch", { x: -240, y: 0, width: HD.width + 480, height: HD.height }),
    image("a", { x: 100, y: 100 }),
  ];

  const contents = pageContents(scene, boardPages(scene)[0]!);

  assert.equal(contents.background, "sketch");
  assert.deepEqual(
    contents.pictures.map((picture) => picture.referenceId),
    ["a"],
  );
});

test("a page's ground is a colour it stands on, never one of the shapes on it", () => {
  const scene = [
    {
      id: "ground",
      type: "rectangle",
      x: 0,
      y: 0,
      width: HD.width,
      height: HD.height,
      backgroundColor: "#0c111c",
      locked: true,
      customData: { pageBackground: true },
    } as unknown as SceneElement,
    image("a", { x: 100, y: 100 }),
    page("p1", { x: 0, y: 0 }),
  ];
  const pages = boardPages(scene);

  const contents = pageContents(scene, pages[0]!);
  assert.equal(contents.shapes, 0);
  assert.deepEqual(contents.pictures, [{ referenceId: "a", clipped: false }]);
  assert.equal(contents.background, null, "the backdrop rule is about a photograph covering the page");
  assert.equal(pageDigests(scene)[0]!.shapes, 0);
});
