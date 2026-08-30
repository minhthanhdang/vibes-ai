import { test } from "node:test";
import assert from "node:assert/strict";

import { framesToPromote, pageTargets } from "@/lib/pages/page-mark";
import { boardPages, isPageElement, pageCustomData } from "@/lib/pages/board-pages";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

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

function frame(id: string, name: string | null, box?: { width: number; height: number }): SceneElement {
  return {
    id,
    type: "frame",
    x: 0,
    y: 0,
    width: box?.width ?? 900,
    height: box?.height ?? 600,
    name,
  };
}

test("a frame the user drew is promoted at the size they drew it, so it becomes a Custom page rather than being resized", () => {
  const drawn = frame("f1", null, { width: 900, height: 600 });
  const [promotion] = framesToPromote([drawn], ["f1"]);

  assert.equal(promotion?.id, "f1");
  const promoted = { ...drawn, name: promotion!.name, customData: promotion!.customData };
  assert.equal(isPageElement(promoted), true);
  assert.equal(boardPages([promoted])[0]?.preset, "Custom");
  assert.equal(boardPages([promoted])[0]?.width, 900);
});

test("a frame drawn at a preset's size is promoted as that preset", () => {
  const drawn = frame("f1", null, { width: HD.width, height: HD.height });
  const [promotion] = framesToPromote([drawn], ["f1"]);

  const promoted = { ...drawn, customData: promotion!.customData };
  assert.equal(boardPages([promoted])[0]?.createdAs, "LANDSCAPE_HD");
});

test("a section the user already named keeps its name", () => {
  const [promotion] = framesToPromote([frame("f1", "Act one")], ["f1"]);

  assert.equal(promotion?.name, "Act one");
});

test("an unnamed frame is numbered past the pages the board already carries", () => {
  const elements = [page("p1", { x: 0, y: 0 }, "Page 1"), frame("f1", null)];

  assert.equal(framesToPromote(elements, ["f1"])[0]?.name, "Page 2");
});

test("two frames promoted at once are numbered one after the other", () => {
  const elements = [page("p1", { x: 0, y: 0 }, "Page 1"), frame("f1", null), frame("f2", "")];

  assert.deepEqual(
    framesToPromote(elements, ["f1", "f2"]).map((promotion) => promotion.name),
    ["Page 2", "Page 3"],
  );
});

test("a frame that is already a page is not offered for promotion", () => {
  assert.deepEqual(framesToPromote([page("p1", { x: 0, y: 0 })], ["p1"]), []);
});

test("nothing but a selected frame is promotable — a photograph is not a page", () => {
  const elements: SceneElement[] = [
    { id: "img", type: "image", fileId: "ref:one", x: 0, y: 0, width: 400, height: 300 },
    frame("f1", null),
    { id: "gone", type: "frame", x: 0, y: 0, width: 900, height: 600, name: null, isDeleted: true },
  ];

  assert.deepEqual(
    framesToPromote(elements, ["img", "f1", "gone"]).map((promotion) => promotion.id),
    ["f1"],
  );
});

test("the selected page is what a new one is measured from, and the board's page count is said", () => {
  const elements = [
    page("p1", { x: 0, y: 0 }),
    page("p2", { x: HD.width + PAGE_GAP, y: 0 }),
    frame("f1", null),
  ];

  assert.deepEqual(pageTargets(elements, ["p2"]), {
    pages: 2,
    sourcePageId: "p2",
    promotable: 0,
  });
});

test("with no page selected the source is left to the board's last", () => {
  const elements = [page("p1", { x: 0, y: 0 }), frame("f1", null)];

  assert.deepEqual(pageTargets(elements, ["f1"]), {
    pages: 1,
    sourcePageId: null,
    promotable: 1,
  });
});

test("a board with no page at all says so, which is the first page drawn around what is there", () => {
  assert.deepEqual(pageTargets([{ id: "img", type: "image", x: 0, y: 0, width: 4, height: 4 }], []), {
    pages: 0,
    sourcePageId: null,
    promotable: 0,
  });
});
