import { test } from "node:test";
import assert from "node:assert/strict";

import { resizePage } from "@/lib/pages/page-resize";
import { boardPages, pageCustomData, pageItems } from "@/lib/pages/board-pages";
import { boardItems } from "@/lib/boards/board-contents";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// A page turned on its side, and nothing else laid out again (§V.1's "resizing a
/// page is allowed and changes nothing else"). The rectangle is the only thing
/// written — so what the tests are for is the two consequences of writing it: what
/// the page stops holding, and what it starts holding.

const HD = PAGE_PRESETS.LANDSCAPE_HD;
const TALL = PAGE_PRESETS.PORTRAIT_HD;
const SECOND = HD.width + PAGE_GAP;

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
  frameId?: string,
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
    ...(frameId ? { frameId } : {}),
  };
}

function text(id: string, box: { x: number; y: number }, words: string): SceneElement {
  return {
    id,
    type: "text",
    text: words,
    x: box.x,
    y: box.y,
    width: 600,
    height: 80,
  };
}

function section(id: string, box: { x: number; y: number }): SceneElement {
  return { id, type: "frame", x: box.x, y: box.y, width: 700, height: 500, name: id };
}

test("the page's rectangle is the only geometry written, and the label follows it", () => {
  const before: SceneElement[] = [
    image("left", { x: 100, y: 100 }, "p1"),
    page("p1", { x: 0, y: 0 }),
  ];
  const resized = resizePage({ elements: before, pageId: "p1", size: TALL })!;

  assert.deepEqual(
    { width: resized.page.width, height: resized.page.height, preset: resized.page.preset },
    { width: TALL.width, height: TALL.height, preset: "PORTRAIT_HD" },
  );
  assert.deepEqual(
    { x: resized.page.x, y: resized.page.y },
    { x: 0, y: 0 },
    "the top-left corner is the anchor",
  );
  assert.deepEqual(resized.was, { width: HD.width, height: HD.height, preset: "LANDSCAPE_HD" });

  const held = resized.elements.find((element) => element.id === "img-left");
  assert.deepEqual(
    { x: held?.x, y: held?.y, width: held?.width },
    { x: 100, y: 100, width: 400 },
    "nothing on the page moves or is resized with it",
  );
});

test("the marker keeps the size the page was created at while the derived label changes", () => {
  const resized = resizePage({
    elements: [page("p1", { x: 0, y: 0 })],
    pageId: "p1",
    size: { width: 1600, height: 900 },
  })!;

  assert.equal(resized.page.preset, "Custom");
  assert.equal(resized.page.createdAs, "LANDSCAPE_HD");
  const frame = resized.elements.find((element) => element.id === "p1");
  assert.deepEqual(frame?.customData, { page: { preset: "LANDSCAPE_HD" } });
});

test("a page made smaller reports what fell off it, and moves nothing", () => {
  const before: SceneElement[] = [
    image("left", { x: 100, y: 100 }, "p1"),
    image("right", { x: 1500, y: 100 }, "p1"),
    text("headline", { x: 1300, y: 900 }, "WHAT THE CITY KEEPS"),
    page("p1", { x: 0, y: 0 }),
  ];
  const resized = resizePage({ elements: before, pageId: "p1", size: TALL })!;

  assert.deepEqual(resized.fellOff.pictures, ["right"]);
  assert.deepEqual(resized.fellOff.lines, ["WHAT THE CITY KEEPS"]);
  assert.deepEqual(resized.joined, { pictures: [], lines: [] });
  assert.deepEqual(
    pageItems(boardItems(resized.elements), resized.page).map((item) => item.referenceId),
    ["left"],
  );

  const off = resized.elements.find((element) => element.id === "img-right");
  assert.deepEqual({ x: off?.x, y: off?.y }, { x: 1500, y: 100 }, "it stays on the board where it is");
});

test("a picture that fell off stops naming the page as its frame", () => {
  const resized = resizePage({
    elements: [image("right", { x: 1500, y: 100 }, "p1"), page("p1", { x: 0, y: 0 })],
    pageId: "p1",
    size: TALL,
  })!;

  assert.deepEqual(resized.releasedIds, ["img-right"]);
  assert.equal(resized.elements.find((element) => element.id === "img-right")?.frameId, null);
});

test("a page made larger takes in what it now covers, and adopts it", () => {
  const before: SceneElement[] = [
    page("p1", { x: 0, y: 0, width: 900, height: 600 }),
    image("beside", { x: 1000, y: 100 }),
  ];
  const resized = resizePage({ elements: before, pageId: "p1", size: HD })!;

  assert.deepEqual(resized.joined.pictures, ["beside"]);
  assert.deepEqual(resized.fellOff, { pictures: [], lines: [] });
  assert.deepEqual(resized.adoptedIds, ["img-beside"]);
  assert.equal(resized.elements.find((element) => element.id === "img-beside")?.frameId, "p1");
});

test("what a growing page adopts is gathered immediately before the frame", () => {
  const resized = resizePage({
    elements: [
      page("p1", { x: 0, y: 0, width: 900, height: 600 }),
      image("beside", { x: 1000, y: 100 }),
    ],
    pageId: "p1",
    size: HD,
  })!;

  assert.deepEqual(
    resized.elements.map((element) => element.id),
    ["img-beside", "p1"],
  );
});

test("a picture crossing the new edge is reported as clipped rather than as fallen off", () => {
  const resized = resizePage({
    elements: [image("over", { x: 750, y: 100, width: 400 }, "p1"), page("p1", { x: 0, y: 0 })],
    pageId: "p1",
    size: { width: 1000, height: HD.height },
  })!;

  assert.deepEqual(resized.clipped, ["over"]);
  assert.deepEqual(resized.fellOff.pictures, []);
});

test("a page grown across the gap reports the page it now overlaps", () => {
  const spread: SceneElement[] = [page("p1", { x: 0, y: 0 }), page("p2", { x: SECOND, y: 0 })];

  assert.deepEqual(
    resizePage({ elements: spread, pageId: "p1", size: { width: SECOND + 400, height: HD.height } })!
      .overlaps.map((other) => other.id),
    ["p2"],
  );
  assert.deepEqual(
    resizePage({ elements: spread, pageId: "p1", size: TALL })!.overlaps,
    [],
    "a page inside its own gutter overlaps nothing",
  );
});

test("a picture on the page beside it is not carried off by the page underneath", () => {
  const resized = resizePage({
    elements: [
      page("p1", { x: 0, y: 0 }),
      page("p2", { x: SECOND, y: 0 }),
      image("theirs", { x: SECOND + 100, y: 100 }, "p2"),
    ],
    pageId: "p1",
    size: { width: SECOND + 900, height: HD.height },
  })!;

  assert.deepEqual(resized.joined.pictures, [], "p2 is the topmost page holding it (§V.3)");
  assert.equal(resized.elements.find((element) => element.id === "img-theirs")?.frameId, "p2");
});

test("a section standing on the page keeps its photographs when the page is resized", () => {
  const resized = resizePage({
    elements: [
      section("act-one", { x: 100, y: 100 }),
      image("inside", { x: 150, y: 150 }, "act-one"),
      page("p1", { x: 0, y: 0, width: 900, height: 600 }),
    ],
    pageId: "p1",
    size: HD,
  })!;

  assert.deepEqual(resized.joined.pictures, []);
  assert.deepEqual(resized.adoptedIds, []);
  assert.equal(resized.elements.find((element) => element.id === "img-inside")?.frameId, "act-one");
});

test("an id the board does not carry, and a size with no rectangle in it, are refused", () => {
  const board = [page("p1", { x: 0, y: 0 }), section("act-one", { x: 100, y: 100 })];

  assert.equal(resizePage({ elements: board, pageId: "nope", size: TALL }), null);
  assert.equal(
    resizePage({ elements: board, pageId: "act-one", size: TALL }),
    null,
    "a section is a frame and is not a page",
  );
  assert.equal(resizePage({ elements: board, pageId: "p1", size: { width: 0, height: 0 } }), null);
});

test("resizing one page of a spread leaves the other page and its pictures alone", () => {
  const before: SceneElement[] = [
    page("p1", { x: 0, y: 0 }),
    image("mine", { x: 100, y: 100 }, "p1"),
    page("p2", { x: SECOND, y: 0 }),
    image("theirs", { x: SECOND + 100, y: 100 }, "p2"),
  ];
  const resized = resizePage({ elements: before, pageId: "p2", size: TALL })!;

  const standing = boardPages(resized.elements);
  assert.deepEqual(
    standing.map((other) => [other.id, other.width, other.height]),
    [
      ["p1", HD.width, HD.height],
      ["p2", TALL.width, TALL.height],
    ],
  );
  assert.deepEqual(
    resized.elements.filter((element) => element.type === "image"),
    before.filter((element) => element.type === "image"),
    "no image element is rewritten at all",
  );
});

test("the page's ground takes the new rectangle — the one thing a resize does move", () => {
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
      frameId: "p1",
    } as unknown as SceneElement,
    image("a", { x: 100, y: 100 }, "p1"),
    page("p1", { x: 0, y: 0 }),
  ];

  const resized = resizePage({ elements: scene, pageId: "p1", size: TALL })!;
  const ground = resized.elements.find((element) => element.id === "ground")!;
  assert.equal(ground.width, TALL.width);
  assert.equal(ground.height, TALL.height);
  assert.deepEqual(resized.fellOff, { pictures: [], lines: [] }, "the ground is never reported as content");
});
