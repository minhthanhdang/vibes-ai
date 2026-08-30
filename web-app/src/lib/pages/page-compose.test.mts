import { test } from "node:test";
import assert from "node:assert/strict";

import {
  layoutForPage,
  newPageBox,
  pageBackgroundElement,
  pageCarriesShapes,
  pageLocalItems,
  sceneOffPage,
} from "@/lib/pages/page-compose";
import { boardPages, pageCustomData, pagesInReadingOrder } from "@/lib/pages/board-pages";
import { boardItems } from "@/lib/boards/board-contents";
import { PAGE_GAP, PAGE_PRESETS, layoutById } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;
const SPLIT = layoutById("SPLIT")!;

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

test("an item keeps its angle when it is read in the page's coordinates", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { ...image("a", { x: 100, y: 100 }), angle: 0.2 },
  ];

  assert.equal(pageLocalItems(boardItems(scene), pagesOf(scene)[0]!)[0]!.angle, 0.2);
});

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

test("a page frame overlapping the one being composed is kept", () => {
  const scene = [page("p1", { x: 0, y: 0 }), page("p2", { x: 200, y: 0 })];

  const pages = pagesOf(scene);
  assert.deepEqual(
    sceneOffPage(scene, pages[0]!, pages).map((element) => element.id),
    ["p2"],
  );
});

test("an element with no geometry is kept", () => {
  const scene = [page("p1", { x: 0, y: 0 }), { id: "odd", type: "freedraw" } as SceneElement];

  const pages = pagesOf(scene);
  assert.deepEqual(
    sceneOffPage(scene, pages[0]!, pages).map((element) => element.id),
    ["odd"],
  );
});

test("a page a compose adds lands past the rightmost page, level with the one it is put beside", () => {
  const scene = [page("p1", { x: 0, y: 0 }), page("p2", { x: SECOND, y: 300 })];

  assert.deepEqual(newPageBox({ pages: pagesOf(scene), sourcePageId: "p2", size: HD }), {
    x: SECOND + HD.width + PAGE_GAP,
    y: 300,
    width: HD.width,
    height: HD.height,
  });
});

test("with no page named, a new page takes its top edge from the board's last page", () => {
  const scene = [page("p1", { x: 0, y: 120 }), page("p2", { x: SECOND, y: 0 })];

  assert.equal(newPageBox({ pages: pagesOf(scene), size: HD }).y, 0);
});

test("a new page is the size of the template being composed, not of the page beside it", () => {
  const tall = PAGE_PRESETS.PORTRAIT_HD;
  const box = newPageBox({ pages: pagesOf([page("p1", { x: 0, y: 0 })]), size: tall });

  assert.deepEqual([box.width, box.height], [tall.width, tall.height]);
});

test("a new page clears the pictures loose on the canvas as well as the pages", () => {
  const loose = { x: SECOND + 4000, y: 0, width: 400, height: 300 };

  assert.equal(
    newPageBox({ pages: pagesOf([page("p1", { x: 0, y: 0 })]), size: HD, occupied: [loose] }).x,
    loose.x + loose.width + PAGE_GAP,
  );
});

test("on a board with no pages, a new page lands beside what is already on it", () => {
  const scene = [image("a", { x: 0, y: 40 }), image("b", { x: 900, y: 40 })];

  assert.deepEqual(newPageBox({ size: HD, occupied: boardItems(scene) }), {
    x: 1300 + PAGE_GAP,
    y: 40,
    width: HD.width,
    height: HD.height,
  });
});

test("on an empty board the first page a compose draws sits at the origin", () => {
  assert.deepEqual(newPageBox({ size: HD }), { x: 0, y: 0, width: HD.width, height: HD.height });
});

test("a page at a preset takes the template as it is cut", () => {
  const standing = pagesOf([page("p1", { x: 0, y: 0 })])[0]!;

  assert.equal(layoutForPage(SPLIT, standing), SPLIT);
  assert.equal(layoutForPage(SPLIT, null), SPLIT);
  assert.equal(layoutForPage(null, standing), null);
});

test("a page the user resized keeps its rectangle, and the template is fitted into it", () => {
  const standing = pagesOf([page("p1", { x: 0, y: 0 })])[0]!;
  const resized = { ...standing, width: 3840, height: 2160, preset: "Custom" as const };

  const drawn = layoutForPage(SPLIT, resized);

  assert.notEqual(drawn, SPLIT);
  assert.deepEqual(drawn.page, { width: 3840, height: 2160 });
  assert.equal(drawn.id, SPLIT.id);
  assert.equal(drawn.slots[0]!.width, SPLIT.slots[0]!.width * 2);
});

test("the picture standing behind a page is found so a rebuild can put it back", () => {
  const cover: SceneElement = {
    id: "sketch",
    type: "image",
    fileId: "ref:sketch",
    x: -240,
    y: 0,
    width: HD.width + 480,
    height: HD.height,
  };
  const scene = [page("p1", { x: 0, y: 0 }), cover, image("a", { x: 100, y: 100 })];
  const [first] = pagesOf(scene);

  assert.equal(pageBackgroundElement(scene, pagesOf(scene), first!)?.id, "sketch");
  assert.ok(!sceneOffPage(scene, first!, pagesOf(scene)).some((element) => element.id === "sketch"));
});

test("a page with nothing behind it has no background to carry through a rebuild", () => {
  const scene = [page("p1", { x: 0, y: 0 }), image("a", { x: 100, y: 100 }), image("b", { x: 900, y: 100 })];

  assert.equal(pageBackgroundElement(scene, pagesOf(scene), pagesOf(scene)[0]!), null);
});

test("the background found is the named page's, not the spread's", () => {
  const behind = (id: string, at: number): SceneElement => ({
    id,
    type: "image",
    fileId: `ref:${id}`,
    x: at,
    y: 0,
    width: HD.width,
    height: HD.height,
  });
  const scene = [
    page("p1", { x: 0, y: 0 }),
    page("p2", { x: SECOND, y: 0 }),
    behind("wash", 0),
    image("a", { x: 100, y: 100 }),
    behind("paper", SECOND),
    image("b", { x: SECOND + 100, y: 100 }),
  ];

  const [first, second] = pagesOf(scene);
  assert.equal(pageBackgroundElement(scene, pagesOf(scene), first!)?.id, "wash");
  assert.equal(pageBackgroundElement(scene, pagesOf(scene), second!)?.id, "paper");
});

function shape(
  id: string,
  type: "rectangle" | "ellipse" | "line",
  box: { x: number; y: number },
): SceneElement {
  return { id, type, x: box.x, y: box.y, width: 400, height: 300, backgroundColor: "#0c111c" };
}

test("a page with a colour block on it is carrying shapes even while its pictures are seated", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    shape("scrim", "rectangle", { x: 0, y: 0 }),
    image("a", { x: 100, y: 100 }),
  ];

  assert.equal(pageCarriesShapes(scene, pagesOf(scene), pagesOf(scene)[0]!), true);
});

test("a page of photographs and lines alone is not carrying shapes", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    image("a", { x: 100, y: 100 }),
    { id: "t", type: "text", x: 100, y: 600, width: 400, height: 60, text: "dawn" } as SceneElement,
  ];

  assert.equal(pageCarriesShapes(scene, pagesOf(scene), pagesOf(scene)[0]!), false);
});

test("an ellipse and a rule count as ground the same way a rectangle does", () => {
  for (const type of ["ellipse", "line"] as const) {
    const scene = [page("p1", { x: 0, y: 0 }), shape("drawn", type, { x: 100, y: 100 })];
    assert.equal(pageCarriesShapes(scene, pagesOf(scene), pagesOf(scene)[0]!), true);
  }
});

test("a shape on the page beside it does not make this page a painted one", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    page("p2", { x: SECOND, y: 0 }),
    shape("scrim", "rectangle", { x: 0, y: 0 }),
    image("b", { x: SECOND + 100, y: 100 }),
  ];

  const [first, second] = pagesOf(scene);
  assert.equal(pageCarriesShapes(scene, pagesOf(scene), first!), true);
  assert.equal(pageCarriesShapes(scene, pagesOf(scene), second!), false);
});

test("on a board with no pages the question is asked of the whole scene", () => {
  const flat = [image("a", { x: 0, y: 0 }), shape("field", "rectangle", { x: 0, y: 0 })];

  assert.equal(pageCarriesShapes(flat, [], null), true);
  assert.equal(pageCarriesShapes([image("a", { x: 0, y: 0 })], [], null), false);
});

test("an arrow on the page is not one of the three shapes", () => {
  const scene = [
    page("p1", { x: 0, y: 0 }),
    { id: "a1", type: "arrow", x: 100, y: 100, width: 200, height: 0 } as SceneElement,
  ];

  assert.equal(pageCarriesShapes(scene, pagesOf(scene), pagesOf(scene)[0]!), false);
});

test("a page's own ground is not ground somebody drew on it — the compose still seats", () => {
  const scene = [
    {
      id: "ground",
      type: "rectangle",
      x: SECOND,
      y: 0,
      width: HD.width,
      height: HD.height,
      backgroundColor: "#0c111c",
      locked: true,
      customData: { pageBackground: true },
    } as unknown as SceneElement,
    image("a", { x: SECOND + 100, y: 100 }),
    page("p2", { x: SECOND, y: 0 }),
  ];
  const pages = pagesInReadingOrder(boardPages(scene));

  assert.equal(
    pageCarriesShapes(scene, pages, pages[0]!),
    false,
    "otherwise every page Let’s Vibes paints would be a page agent 4 cannot compose onto",
  );
});
