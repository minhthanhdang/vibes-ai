import { test } from "node:test";
import assert from "node:assert/strict";

import { pageDuplication } from "@/lib/pages/page-duplicate";
import { boardPages, pageCustomData } from "@/lib/pages/board-pages";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

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

function section(id: string, x: number): SceneElement {
  return { id, type: "frame", x, y: 0, width: 600, height: 500, name: "Night work" };
}

function image(
  id: string,
  box: { x: number; y: number; width?: number; height?: number },
  extra: Record<string, unknown> = {},
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
    frameId: null,
    ...extra,
  };
}

function text(id: string, words: string, box: { x: number; y: number }): SceneElement {
  return { id, type: "text", text: words, x: box.x, y: box.y, width: 500, height: 60 };
}

function spread(): SceneElement[] {
  return [
    page("pg-1", 0, "Act one"),
    image("a", { x: 100, y: 100 }, { frameId: "pg-1" }),
    image("b", { x: 700, y: 100 }, { frameId: "pg-1" }),
    text("line-1", "WHAT THE CITY KEEPS", { x: 100, y: 600 }),
    page("pg-2", SECOND, "Act two"),
    image("c", { x: SECOND + 100, y: 100 }, { frameId: "pg-2" }),
  ];
}

function counter() {
  let made = 0;
  return () => `new-${++made}`;
}

test("a copied page lands beside the board at the source page's size", () => {
  const copy = pageDuplication({ elements: spread(), pageId: "pg-1", makeId: counter() })!;

  assert.equal(copy.page.x, SECOND + HD.width + PAGE_GAP);
  assert.equal(copy.page.y, 0);
  assert.equal(copy.page.width, HD.width);
  assert.equal(copy.page.height, HD.height);
  assert.equal(copy.page.preset, "LANDSCAPE_HD");
  assert.equal(copy.page.name, "Page 3");
  assert.equal(copy.source.id, "pg-1");
});

test("a page the user sized themselves is copied at their rectangle", () => {
  const elements: SceneElement[] = [
    { ...page("pg-1", 0, "Act one"), width: 2400, height: 1200 },
    image("a", { x: 100, y: 100 }),
  ];
  const copy = pageDuplication({ elements, pageId: "pg-1", makeId: counter() })!;

  assert.equal(copy.page.width, 2400);
  assert.equal(copy.page.height, 1200);
  assert.equal(copy.page.preset, "Custom");
});

test("what the page holds is carried across at the same place inside the copy", () => {
  const copy = pageDuplication({ elements: spread(), pageId: "pg-1", makeId: counter() })!;

  const on = copy.elements.filter((element) => element.frameId === copy.page.id);
  assert.equal(on.length, 3);
  assert.deepEqual(
    on.map((element) => [
      (element.x as number) - copy.page.x,
      (element.y as number) - copy.page.y,
    ]),
    [
      [100, 100],
      [700, 100],
      [100, 600],
    ],
  );
  assert.deepEqual(copy.pictures, ["a", "b"]);
  assert.deepEqual(copy.lines, ["WHAT THE CITY KEEPS"]);
  assert.equal(copy.copied, 3);
});

test("the page it was copied from is left exactly as it was", () => {
  const before = spread();
  const copy = pageDuplication({ elements: before, pageId: "pg-1", makeId: counter() })!;

  assert.deepEqual(copy.elements.slice(0, before.length), before);
});

test("nothing in the scene ends up carrying an id twice", () => {
  const copy = pageDuplication({ elements: spread(), pageId: "pg-1", makeId: counter() })!;

  const ids = copy.elements.map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("a group on the page is copied as a group of its own", () => {
  const elements: SceneElement[] = [
    page("pg-1", 0, "Act one"),
    image("a", { x: 100, y: 100 }, { groupIds: ["grp-1"] }),
    text("line-1", "CAPTION", { x: 100, y: 420 }),
    { ...text("line-2", "CAPTION", { x: 100, y: 420 }), id: "line-2", groupIds: ["grp-1"] },
  ];
  const copy = pageDuplication({ elements, pageId: "pg-1", makeId: counter() })!;

  const grouped = copy.elements
    .filter((element) => element.frameId === copy.page.id)
    .flatMap((element) => (Array.isArray(element.groupIds) ? element.groupIds : []));
  assert.equal(new Set(grouped).size, 1);
  assert.equal(grouped.includes("grp-1"), false);
});

test("the copies sit immediately before the frame that owns them", () => {
  const copy = pageDuplication({ elements: spread(), pageId: "pg-1", makeId: counter() })!;

  const order = copy.elements.map((element) => element.id);
  const frameAt = order.indexOf(copy.page.id);
  assert.equal(frameAt, order.length - 1);
  assert.deepEqual(
    copy.elements.slice(frameAt - 3, frameAt).map((element) => element.frameId),
    [copy.page.id, copy.page.id, copy.page.id],
  );
});

test("membership is geometric, so a picture dragged off the page is not copied", () => {
  const elements = [
    ...spread(),
    image("d", { x: -900, y: 100 }, { frameId: "pg-1" }),
  ];
  const copy = pageDuplication({ elements, pageId: "pg-1", makeId: counter() })!;

  assert.deepEqual(copy.pictures, ["a", "b"]);
});

test("a picture dropped on the page without being adopted is copied", () => {
  const elements = [...spread(), image("d", { x: 200, y: 700 })];
  const copy = pageDuplication({ elements, pageId: "pg-1", makeId: counter() })!;

  assert.deepEqual(copy.pictures, ["a", "b", "d"]);
});

test("a section standing on the page keeps its photographs and is not copied", () => {
  const elements = [
    ...spread(),
    section("sec-1", 200),
    image("d", { x: 300, y: 100 }, { frameId: "sec-1" }),
  ];
  const copy = pageDuplication({ elements, pageId: "pg-1", makeId: counter() })!;

  assert.deepEqual(copy.pictures, ["a", "b"]);
  assert.equal(copy.sections, 1);
  assert.equal(copy.keptInSections, 1);
  assert.equal(
    copy.elements.some((element) => element.type === "frame" && element.name === "Night work" && element.id !== "sec-1"),
    false,
  );
});

test("the copy is named by the user when they said what to call it", () => {
  const copy = pageDuplication({
    elements: spread(),
    pageId: "pg-1",
    name: "  Act one again  ",
    makeId: counter(),
  })!;

  assert.equal(copy.page.name, "Act one again");
});

test("an id the board has no page for is refused rather than copied", () => {
  assert.equal(pageDuplication({ elements: spread(), pageId: "pg-9" }), null);
  assert.equal(pageDuplication({ elements: spread(), pageId: "sec-1" }), null);
});

test("the fields excalidraw regenerates are not carried onto the copies", () => {
  const elements: SceneElement[] = [
    page("pg-1", 0, "Act one"),
    image("a", { x: 100, y: 100 }, { index: "a1", seed: 12, version: 4, versionNonce: 9 }),
  ];
  const copy = pageDuplication({ elements, pageId: "pg-1", makeId: counter() })!;
  const made = copy.elements.find((element) => element.frameId === copy.page.id)!;

  assert.deepEqual(
    ["index", "seed", "version", "versionNonce"].filter((field) => field in made),
    [],
  );
  assert.equal(made.fileId, "ref:a");
});

test("the copy is a page the board now reads as one of its own", () => {
  const copy = pageDuplication({ elements: spread(), pageId: "pg-1", makeId: counter() })!;

  assert.deepEqual(
    boardPages(copy.elements).map((page) => page.id),
    ["pg-1", "pg-2", copy.page.id],
  );
});

test("a copied page carries its ground, with the mark and an id of its own", () => {
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
    page("p1", 0),
  ];

  const copy = pageDuplication({ elements: scene, pageId: "p1" })!;
  const copied = copy.elements.filter(
    (element) => (element.customData as { pageBackground?: unknown })?.pageBackground === true,
  );
  assert.equal(copied.length, 2, "the original's and the copy's");
  const made = copied.find((element) => element.id !== "ground")!;
  assert.equal(made.backgroundColor, "#0c111c");
  assert.equal(made.locked, true);
  assert.equal(made.x, SECOND, "at the copy's own corner");
});
