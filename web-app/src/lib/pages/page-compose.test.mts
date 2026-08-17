import { test } from "node:test";
import assert from "node:assert/strict";

import { pageLocalItems, sceneOffPage } from "@/lib/pages/page-compose";
import { boardPages, pageCustomData, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { boardItems } from "@/lib/boards/board-contents";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

/// Where a board's second page stands, which is the case this whole module is
/// for: the first one is at the origin and reads correctly by accident.
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

function image(id: string, box: { x: number; y: number }): SceneElement {
  return { id, type: "image", fileId: `ref:${id}`, x: box.x, y: box.y, width: 400, height: 300 };
}

function pagesOf(scene: readonly SceneElement[]) {
  return pagesInReadingOrder(boardPages(scene));
}

/// The whole reason this exists: a template's slots are cut against the origin,
/// so a picture on page 2 is only recognisable as sitting in one after the page's
/// own corner has been taken off it.
test("a page's items are read from its own corner, whatever corner the page sits at", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    page("p2", { x: SECOND, y: 0 }),
    image("a", { x: SECOND + 100, y: 200 }),
  ];

  const [, second] = pagesOf(scene);
  assert.deepEqual(
    pageLocalItems(boardItems(scene), second!).map(({ referenceId, x, y }) => [referenceId, x, y]),
    [["a", 100, 200]],
  );
});

test("only what is on the page is read, and a line on it is read with the pictures", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    page("p2", { x: SECOND, y: 0 }),
    image("first", { x: 100, y: 100 }),
    image("second", { x: SECOND + 100, y: 100 }),
    { id: "t", type: "text", text: "COLD OPEN", x: SECOND + 100, y: 600, width: 600, height: 80 },
  ];

  const [, second] = pagesOf(scene);
  assert.deepEqual(
    pageLocalItems(boardItems(scene), second!).map((item) => item.referenceId ?? item.text),
    ["second", "COLD OPEN"],
  );
});

/// An angle is what tells a scattered picture from one the director turned, so it
/// survives the move to the page's coordinates — nothing about a rotation is
/// about where the page sits.
test("an item keeps its angle when it is read in the page's coordinates", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { ...image("a", { x: 100, y: 100 }), angle: 0.2 },
  ];

  assert.equal(pageLocalItems(boardItems(scene), pagesOf(scene)[0]!)[0]!.angle, 0.2);
});

/// A compose writes over the page it is about and nothing else. Before pages, the
/// scene it wrote *was* the board, so laying out page 2 would have deleted page 1.
test("the scene off a page is every other page, its pictures and the frame that names it", () => {
  const scene = [
    image("first", { x: 100, y: 100 }),
    page("p1", { x: 0, y: 0 }),
    image("second", { x: SECOND + 100, y: 100 }),
    page("p2", { x: SECOND, y: 0 }),
  ];

  const pages = pagesOf(scene);
  const kept = sceneOffPage(scene, pages[1]!, pages);

  assert.deepEqual(kept.map((element) => element.id), ["first", "p1"]);
});

/// The order it was in, because array order is z-order and because excalidraw
/// wants a frame's children immediately before it — an untouched page keeps both
/// by never being moved.
test("what is kept is kept in the order the scene had it", () => {
  const scene = [
    image("a", { x: 100, y: 100 }),
    image("b", { x: 600, y: 100 }),
    page("p1", { x: 0, y: 0 }),
    image("c", { x: SECOND + 100, y: 100 }),
    page("p2", { x: SECOND, y: 0 }),
  ];

  const pages = pagesOf(scene);
  assert.deepEqual(
    sceneOffPage(scene, pages[0]!, pages).map((element) => element.id),
    ["c", "p2"],
  );
});

/// A picture the director dragged off a page onto the canvas beside it is theirs,
/// not the compose's to delete: it is on no page, so no page's compose steps over
/// it.
test("a picture on no page survives a compose of any page", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    image("on", { x: 100, y: 100 }),
    image("beside", { x: 0, y: HD.height + 400 }),
  ];

  const pages = pagesOf(scene);
  assert.deepEqual(
    sceneOffPage(scene, pages[0]!, pages).map((element) => element.id),
    ["beside"],
  );
});

/// Membership is the entity's own rule — the centre of the box — so what a
/// compose steps over is exactly what a page read described. A picture adopted by
/// a frame it has been dragged out of stays put.
test("a picture filed to the page but sitting off it is not written over", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { ...image("dragged", { x: 0, y: HD.height + 400 }), frameId: "p1" },
  ];

  const pages = pagesOf(scene);
  assert.deepEqual(
    sceneOffPage(scene, pages[0]!, pages).map((element) => element.id),
    ["dragged"],
  );
});

/// A page drawn across another is a board the director can still see two of, so
/// the frame is kept whatever it overlaps — a page is never something another
/// page's compose deletes.
test("a page frame overlapping the one being composed is kept", () => {
  const scene = [page("p1", { x: 0, y: 0 }), page("p2", { x: 200, y: 0 })];

  const pages = pagesOf(scene);
  assert.deepEqual(
    sceneOffPage(scene, pages[0]!, pages).map((element) => element.id),
    ["p2"],
  );
});

/// An element with no readable box belongs to no page, so nothing that cannot be
/// placed is thrown away by a call about a place.
test("an element with no geometry is kept", () => {
  const scene = [page("p1", { x: 0, y: 0 }), { id: "odd", type: "freedraw" } as SceneElement];

  const pages = pagesOf(scene);
  assert.deepEqual(
    sceneOffPage(scene, pages[0]!, pages).map((element) => element.id),
    ["odd"],
  );
});
