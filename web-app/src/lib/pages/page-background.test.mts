import { test } from "node:test";
import assert from "node:assert/strict";

import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import {
  isPageBackground,
  pageBackgroundColour,
  pageBackgroundOf,
  resizedPageBackground,
  setPageBackground,
} from "@/lib/pages/page-background";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

const PAGE = { id: "page_1", x: 0, y: 0, width: HD.width, height: HD.height };

function frame(): SceneElement {
  return {
    id: PAGE.id,
    type: "frame",
    name: "Page 1",
    x: PAGE.x,
    y: PAGE.y,
    width: PAGE.width,
    height: PAGE.height,
    customData: { page: true },
  } as unknown as SceneElement;
}

function photo(id: string, x = 100, y = 100): SceneElement {
  return {
    id,
    type: "image",
    fileId: "ref:sketch",
    x,
    y,
    width: 400,
    height: 300,
    frameId: PAGE.id,
  } as unknown as SceneElement;
}

function paint(elements: readonly SceneElement[], colour: unknown) {
  return setPageBackground({ elements, page: PAGE, colour, makeId: () => "ground_1" });
}

test("a colour lands as a page-sized rectangle carrying the mark", () => {
  const scene = [photo("photo_1"), frame()];
  const edit = paint(scene, "#0c111c")!;

  const ground = pageBackgroundOf(edit.elements!, PAGE)!;
  assert.equal(ground.type, "rectangle");
  assert.equal(ground.backgroundColor, "#0c111c");
  assert.equal(ground.x, PAGE.x);
  assert.equal(ground.y, PAGE.y);
  assert.equal(ground.width, PAGE.width);
  assert.equal(ground.height, PAGE.height);
  assert.equal(ground.frameId, PAGE.id);
  assert.equal(isPageBackground(ground), true);
  assert.equal(edit.colour, "#0c111c");
  assert.equal(edit.was, null);
});

test("it lands flat, unstroked and locked — a page's ground is not a shape to grab", () => {
  const ground = pageBackgroundOf(paint([frame()], "#ffffff")!.elements!, PAGE)!;
  assert.equal(ground.fillStyle, "solid");
  assert.equal(ground.roughness, 0);
  assert.equal(ground.strokeColor, "transparent");
  assert.equal(ground.locked, true);
  assert.equal(ground.opacity, 100);
});

test("it goes to the back of the page's child run, under the photographs", () => {
  const scene = [photo("photo_1"), photo("photo_2", 600), frame()];
  const after = paint(scene, "#0c111c")!.elements!;
  assert.deepEqual(
    after.map((element) => element.id),
    ["ground_1", "photo_1", "photo_2", PAGE.id],
  );
});

test("a page holding nothing takes it immediately before its own frame", () => {
  const other = { id: "loose", type: "rectangle", x: 4000, y: 0, width: 10, height: 10 };
  const after = paint([other as unknown as SceneElement, frame()], "#0c111c")!.elements!;
  assert.deepEqual(
    after.map((element) => element.id),
    ["loose", "ground_1", PAGE.id],
  );
});

test("setting a colour twice recolours in place — one per page, never stacked", () => {
  const first = paint([photo("photo_1"), frame()], "#0c111c")!.elements!;
  const second = paint(first, "#f5f0e8")!;

  const grounds = second.elements!.filter(isPageBackground);
  assert.equal(grounds.length, 1);
  assert.equal(grounds[0]!.id, "ground_1", "the element keeps its id, so undo and selection survive");
  assert.equal(grounds[0]!.backgroundColor, "#f5f0e8");
  assert.equal(second.was, "#0c111c");
});

test("the colour a page already stands on writes nothing", () => {
  const first = paint([frame()], "#0c111c")!.elements!;
  const again = paint(first, "#0C111C")!;
  assert.equal(again.elements, null);
  assert.equal(again.colour, "#0c111c");
});

test('"none" drops the element rather than leaving a transparent rectangle', () => {
  const painted = paint([photo("photo_1"), frame()], "#0c111c")!.elements!;
  const cleared = paint(painted, "none")!;

  assert.deepEqual(
    cleared.elements!.map((element) => element.id),
    ["photo_1", PAGE.id],
  );
  assert.equal(cleared.colour, null);
  assert.equal(pageBackgroundColour(cleared.elements!, PAGE), null);
});

test('"none" on a page painted nothing writes nothing', () => {
  const edit = paint([frame()], "NONE")!;
  assert.equal(edit.elements, null);
  assert.equal(edit.colour, null);
});

test("a colour that is not a colour is refused to the caller, not guessed at", () => {
  assert.equal(paint([frame()], "off-white"), null);
  assert.equal(paint([frame()], ""), null);
  assert.equal(paint([frame()], 12), null);
});

test("a ground belongs to the page whose rectangle its centre is inside", () => {
  const second = { id: "page_2", x: 2000, y: 0, width: HD.width, height: HD.height };
  const scene = paint([frame()], "#0c111c")!.elements!;
  assert.equal(pageBackgroundColour(scene, PAGE), "#0c111c");
  assert.equal(pageBackgroundColour(scene, second), null);
});

test("a resize takes the ground with it — looked up at the old rect, applied at the new", () => {
  const painted = paint([photo("photo_1"), frame()], "#0c111c")!.elements!;
  const now = { id: PAGE.id, x: 0, y: 0, width: 400, height: 400 };
  const after = resizedPageBackground(painted, PAGE, now);

  const ground = after.find(isPageBackground)!;
  assert.equal(ground.width, 400);
  assert.equal(ground.height, 400);
});

test("a page painted nothing resizes to nothing extra", () => {
  const scene = [photo("photo_1"), frame()];
  const now = { id: PAGE.id, x: 0, y: 0, width: 400, height: 400 };
  assert.deepEqual(resizedPageBackground(scene, PAGE, now), scene);
});

test("a tombstoned ground is not the page's ground", () => {
  const painted = paint([frame()], "#0c111c")!.elements!;
  const buried = painted.map((element) =>
    isPageBackground(element) ? { ...element, isDeleted: true } : element,
  );
  assert.equal(pageBackgroundOf(buried, PAGE), null);
});
