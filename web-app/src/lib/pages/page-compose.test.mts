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

/// An angle is what tells a scattered picture from one the user turned, so it
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

/// A picture the user dragged off a page onto the canvas beside it is theirs,
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

/// A page drawn across another is a board the user can still see two of, so
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

/// §V.2, for a page that is about to be drawn on: to the right of the rightmost,
/// top-aligned with the source, a fixed gutter away.
test("a page a compose adds lands past the rightmost page, level with the one it is put beside", () => {
  const scene = [page("p1", { x: 0, y: 0 }), page("p2", { x: SECOND, y: 300 })];

  assert.deepEqual(newPageBox({ pages: pagesOf(scene), sourcePageId: "p2", size: HD }), {
    x: SECOND + HD.width + PAGE_GAP,
    y: 300,
    width: HD.width,
    height: HD.height,
  });
});

/// Named nothing, the source is the last page the board carries — "another one"
/// is another one like the one last made.
test("with no page named, a new page takes its top edge from the board's last page", () => {
  const scene = [page("p1", { x: 0, y: 120 }), page("p2", { x: SECOND, y: 0 })];

  assert.equal(newPageBox({ pages: pagesOf(scene), size: HD }).y, 0);
});

/// The size is the template's rather than the source page's: a compose decides
/// the page it draws, the same rule a rebuild follows.
test("a new page is the size of the template being composed, not of the page beside it", () => {
  const tall = PAGE_PRESETS.PORTRAIT_HD;
  const box = newPageBox({ pages: pagesOf([page("p1", { x: 0, y: 0 })]), size: tall });

  assert.deepEqual([box.width, box.height], [tall.width, tall.height]);
});

/// Clear of *everything*, not of the pages alone: a picture dragged out to the
/// right of the last page is on the board, and a page drawn over it would adopt
/// it the next time the user moved anything.
test("a new page clears the pictures loose on the canvas as well as the pages", () => {
  const loose = { x: SECOND + 4000, y: 0, width: 400, height: 300 };

  assert.equal(
    newPageBox({ pages: pagesOf([page("p1", { x: 0, y: 0 })]), size: HD, occupied: [loose] }).x,
    loose.x + loose.width + PAGE_GAP,
  );
});

/// A board composed before pages existed has none, and it is still a board with
/// an arrangement on it. The page goes beside that arrangement rather than
/// `nextPageBox`'s frame around it, which here would draw the new one on top of
/// what the user is looking at.
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

/// A page still at one of the presets is a page the templates are cut to, and a
/// compose at a template of another preset reshapes it — the behaviour every
/// board in this app has had, and the answer says the page changed shape.
test("a page at a preset takes the template as it is cut", () => {
  const standing = pagesOf([page("p1", { x: 0, y: 0 })])[0]!;

  assert.equal(layoutForPage(SPLIT, standing), SPLIT);
  assert.equal(layoutForPage(SPLIT, null), SPLIT);
  assert.equal(layoutForPage(null, standing), null);
});

/// The one thing a rectangle says that a preset cannot: the user sized this
/// page themselves. Composed at the template's own size it would come back
/// 1920×1080, which is their number overwritten by a call they made about the
/// pictures on it.
test("a page the user resized keeps its rectangle, and the template is fitted into it", () => {
  const standing = pagesOf([page("p1", { x: 0, y: 0 })])[0]!;
  const resized = { ...standing, width: 3840, height: 2160, preset: "Custom" as const };

  const drawn = layoutForPage(SPLIT, resized);

  assert.notEqual(drawn, SPLIT);
  assert.deepEqual(drawn.page, { width: 3840, height: 2160 });
  assert.equal(drawn.id, SPLIT.id);
  assert.equal(drawn.slots[0]!.width, SPLIT.slots[0]!.width * 2);
});

/// The counterpart of `sceneOffPage` and the reason it needs one: that filter
/// keeps everything *not* on the page being composed, so a rebuild drops the
/// background along with the arrangement standing on it. A user who asks for a
/// grid and loses the sketch they put behind their page is being argued with.
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
  /// And it is exactly what the filter drops, which is what makes this the way
  /// back rather than a second copy.
  assert.ok(!sceneOffPage(scene, first!, pagesOf(scene)).some((element) => element.id === "sketch"));
});

test("a page with nothing behind it has no background to carry through a rebuild", () => {
  const scene = [page("p1", { x: 0, y: 0 }), image("a", { x: 100, y: 100 }), image("b", { x: 900, y: 100 })];

  assert.equal(pageBackgroundElement(scene, pagesOf(scene), pagesOf(scene)[0]!), null);
});

/// The page a rebuild is not about keeps its own background, and the read is
/// scoped by the same membership rule everything else on a spread is.
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

/// The routing decision §XI.5 records: the pictures are all still seated, so the
/// seating question says the page stands, and a rebuild would lay the next
/// photograph over the field somebody drew under them.
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

/// Scoped by the same membership rule every other page read is: page 2 is not
/// sent down the edit-in-place branch by a colour block on page 1.
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

/// A board with no page frame is read flat, which is how the compose reads one.
test("on a board with no pages the question is asked of the whole scene", () => {
  const flat = [image("a", { x: 0, y: 0 }), shape("field", "rectangle", { x: 0, y: 0 })];

  assert.equal(pageCarriesShapes(flat, [], null), true);
  assert.equal(pageCarriesShapes([image("a", { x: 0, y: 0 })], [], null), false);
});

/// An arrow is drawn on the board and is not one of the three kinds the read
/// carries (§XI.1), so it is not ground a rebuild has to step around either.
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
