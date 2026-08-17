import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pagedLooseFits,
  pagedPlacements,
  pagedSlotShape,
  pagedStandsAsComposed,
  pageStandsAsComposed,
} from "@/lib/pages/page-fit";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { BoardItem } from "@/lib/boards/board-contents";
import {
  PAGE_GAP,
  PAGE_PRESETS,
  fitInSlot,
  layoutById,
  layoutOnPage,
  type MoodboardLayout,
} from "@/lib/layout/moodboard-layouts";

const SPLIT = layoutById("SPLIT")!;
const HERO = layoutById("HERO_LEFT")!;
const HD = PAGE_PRESETS.LANDSCAPE_HD;

/// Where a board's second page stands — the corner every one of these is about.
const SECOND = HD.width + PAGE_GAP;

function page(id: string, x: number, name = id): BoardPage {
  return { id, name, x, y: 0, width: HD.width, height: HD.height, preset: "LANDSCAPE_HD", createdAs: "LANDSCAPE_HD" };
}

/// A picture sitting exactly where the template put it, on the page whose corner
/// is `at`. On page 1 that is the slot's own box; anywhere else it is that box
/// carried to the page.
function seated(
  layout: MoodboardLayout,
  slotId: string,
  referenceId: string,
  size: { width: number; height: number },
  at: { x: number; y: number } = { x: 0, y: 0 },
): BoardItem {
  const opening = layout.slots.find((slot) => slot.id === slotId)!;
  const box = fitInSlot(opening, { id: referenceId, kind: "image", ...size });
  return {
    kind: "image",
    referenceId,
    text: null,
    ...box,
    x: box.x + at.x,
    y: box.y + at.y,
    ...(opening.angle ? { angle: opening.angle } : {}),
  };
}

const PORTRAIT = { width: 1000, height: 1500 };

/// The gap this module was written to close: measured in board coordinates, a
/// picture on page 2 sits a page and a gutter to the right of every slot, so it
/// is seated in none of them and the board answers "nothing loose" for a page
/// with page showing around every picture on it.
test("a picture sitting loosely on the second page is reported, not silently missed", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const items = [seated(SPLIT, "img-1", "ref-2", PORTRAIT, { x: SECOND, y: 0 })];

  const loose = pagedLooseFits(items, pages, SPLIT);

  assert.equal(loose.length, 1);
  assert.equal(loose[0].referenceId, "ref-2");
  assert.equal(loose[0].slotId, "img-1");
});

test("a gap is said with the page it is on when the board has more than one page", () => {
  const pages = [page("p1", 0, "Act one"), page("p2", SECOND, "Act two")];
  const items = [seated(SPLIT, "img-1", "ref-2", PORTRAIT, { x: SECOND, y: 0 })];

  const [loose] = pagedLooseFits(items, pages, SPLIT);

  assert.equal(loose.pageId, "p2");
  assert.equal(loose.page, "Act two");
});

/// The answer already says which page it is about, so naming it per picture buys
/// the same fact once a line.
test("a one-page board's gaps carry no page name, and neither does a read scoped to one page", () => {
  const items = [seated(SPLIT, "img-1", "ref-1", PORTRAIT)];

  const [whole] = pagedLooseFits(items, [page("p1", 0, "Act one")], SPLIT);
  assert.deepEqual(Object.keys(whole).includes("pageId"), false);
  assert.deepEqual(Object.keys(whole).includes("page"), false);

  const onPage2 = [seated(SPLIT, "img-1", "ref-2", PORTRAIT, { x: SECOND, y: 0 })];
  const [scoped] = pagedLooseFits(onPage2, [page("p2", SECOND, "Act two")], SPLIT);
  assert.equal(scoped.referenceId, "ref-2");
  assert.deepEqual(Object.keys(scoped).includes("pageId"), false);
});

test("the worst fit is first across the whole board, whichever page it is on", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const items = [
    /// 4:3 in SPLIT's left half — loose, but far less so than the portrait.
    seated(SPLIT, "img-1", "wide", { width: 1200, height: 900 }),
    seated(SPLIT, "img-1", "tall", { width: 1000, height: 2000 }, { x: SECOND, y: 0 }),
  ];

  const loose = pagedLooseFits(items, pages, SPLIT);

  assert.deepEqual(
    loose.map(({ referenceId }) => referenceId),
    ["tall", "wide"],
  );
  assert.ok(loose[0].fills < loose[1].fills);
});

test("a board with no page frame is measured flat, exactly as it was before pages", () => {
  const items = [seated(SPLIT, "img-1", "ref-1", PORTRAIT)];

  assert.deepEqual(
    pagedLooseFits(items, [], SPLIT).map(({ referenceId, slotId }) => [referenceId, slotId]),
    [["ref-1", "img-1"]],
  );
});

/// Pictures on no page are on the canvas beside the arrangement rather than in
/// it, so there is no opening they could be sitting in.
test("a picture dragged off every page of a paged board is measured against no slot", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const beside = { ...seated(SPLIT, "img-1", "ref-1", PORTRAIT), y: -4000 };

  assert.deepEqual(pagedLooseFits([beside], pages, SPLIT), []);
});

/// The other reader of the slot geometry: a cut asked for a picture on page 2 is
/// held to the opening it is filling rather than to the nearest of six names.
test("the opening a picture is seated in is read on whichever page it sits on", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const items = [seated(HERO, "img-2", "ref-1", PORTRAIT, { x: SECOND, y: 0 })];

  const found = pagedSlotShape(items, pages, HERO, "ref-1");

  assert.equal(found?.slotId, "img-2");
  assert.equal(found?.shape.ratio, 3.52);
});

test("a picture in no slot on any page has no opening, and a page-less board reads as before", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const seatedOnOne = seated(HERO, "img-2", "ref-1", PORTRAIT);

  assert.equal(pagedSlotShape([{ ...seatedOnOne, x: seatedOnOne.x + 90 }], pages, HERO, "ref-1"), null);
  assert.equal(pagedSlotShape([seatedOnOne], [], HERO, "ref-1")?.slotId, "img-2");
});

/// The shape readers can measure inside the page and stop there; a caller that
/// has to *draw* — `swapOnBoard` re-fitting a replacement to the opening — needs
/// the opening where it actually is.
test("the opening a picture on page 2 sits in is given at its place on the board", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const items = [
    seated(SPLIT, "img-1", "ref-1", PORTRAIT),
    seated(SPLIT, "img-2", "ref-2", PORTRAIT, { x: SECOND, y: 0 }),
  ];

  const placed = pagedPlacements(items, pages, SPLIT);
  const opening = (id: string) => SPLIT.slots.find((slot) => slot.id === id)!;

  assert.deepEqual(
    placed.map(({ slot, block }) => [block.id, slot.id, slot.x]),
    [
      ["ref-1", "img-1", opening("img-1").x],
      ["ref-2", "img-2", opening("img-2").x + SECOND],
    ],
  );
  /// Only the corner moves. The opening is the same size and shape it is in the
  /// template, which is what keeps a cut held to it valid on any page.
  assert.equal(placed[1]!.slot.width, opening("img-2").width);
});

test("a board with no page frame is paired flat, exactly as it was before pages", () => {
  const items = [seated(SPLIT, "img-1", "ref-1", PORTRAIT)];

  assert.deepEqual(
    pagedPlacements(items, [], SPLIT).map(({ slot, block }) => [block.id, slot.id, slot.x]),
    [["ref-1", "img-1", SPLIT.slots.find((slot) => slot.id === "img-1")!.x]],
  );
});

/// The caption's question. Read flat, a spread nobody has touched answers
/// "rearranged" — no picture past page 1 is seated in anything — and the tile
/// loses the template name the moment the board grows a second page.
test("a spread with every picture in its slot is still standing as its template composed it", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const items = [
    seated(SPLIT, "img-1", "ref-1", PORTRAIT),
    seated(SPLIT, "img-2", "ref-2", PORTRAIT),
    seated(SPLIT, "img-1", "ref-3", PORTRAIT, { x: SECOND, y: 0 }),
  ];

  assert.equal(pagedStandsAsComposed(items, pages, SPLIT), true);
});

test("one picture dragged out of its slot on the second page is a spread no longer standing", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const onTwo = seated(SPLIT, "img-1", "ref-2", PORTRAIT, { x: SECOND, y: 0 });
  const items = [seated(SPLIT, "img-1", "ref-1", PORTRAIT), { ...onTwo, x: onTwo.x + 120 }];

  assert.equal(pagedStandsAsComposed(items, pages, SPLIT), false);
});

/// The narrower question every sentence about *one* page asks. The board-wide
/// answer is false the moment any page of the spread is out of place, and using
/// it to name a page would take page 1's template away because page 3 was
/// dragged apart.
test("a page standing in the template is standing whatever the rest of the spread is doing", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const onTwo = seated(SPLIT, "img-1", "ref-3", PORTRAIT, { x: SECOND, y: 0 });
  const items = [
    seated(SPLIT, "img-1", "ref-1", PORTRAIT),
    seated(SPLIT, "img-2", "ref-2", PORTRAIT),
    { ...onTwo, y: onTwo.y + 200 },
  ];

  assert.equal(pagedStandsAsComposed(items, pages, SPLIT), false);
  assert.equal(pageStandsAsComposed(items, pages, pages[0]!, SPLIT), true);
  assert.equal(pageStandsAsComposed(items, pages, pages[1]!, SPLIT), false);
});

/// The commonest case on a board that has been given a second page: the row
/// still names the template its first page was composed at, and the page the
/// director is looking at has never been laid out at all.
test("a page with nothing on it is standing in no template", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const items = [seated(SPLIT, "img-1", "ref-1", PORTRAIT), seated(SPLIT, "img-2", "ref-2", PORTRAIT)];

  assert.equal(pageStandsAsComposed(items, pages, pages[1]!, SPLIT), false);
  assert.equal(pageStandsAsComposed(items, pages, pages[0]!, null), false);
});

/// §V.3 on a board whose pages the director has dragged together: a picture in
/// the overlap belongs to the topmost page, so the page underneath is short of it
/// and every slot reader has to say so. Counted on both, the page underneath
/// offers the director a cut of a photograph standing on the page over it, and
/// the swap that takes the offer re-fits it into a panel of the wrong page.
test("a picture where two pages overlap is seated on the topmost page alone", () => {
  const under = page("under", 0);
  const over = page("over", HD.width / 2, "over");
  const pages = [under, over];
  /// Seated in the right-hand panel of the page underneath, and its centre is
  /// over the page lying across it.
  const shared = seated(SPLIT, "img-2", "ref-2", PORTRAIT);
  const items = [seated(SPLIT, "img-1", "ref-1", PORTRAIT), shared];

  assert.deepEqual(
    pagedLooseFits(items, pages, SPLIT)
      .filter((fit) => fit.pageId === "under")
      .map((fit) => fit.slotId),
    ["img-1"],
  );
  assert.deepEqual(
    pagedPlacements(items, pages, SPLIT).map(({ block }) => block.id),
    ["ref-1"],
  );

  /// And the page underneath keeps its template's name: a photograph standing on
  /// the page over it is not this page's picture dragged out of a slot.
  const across: BoardItem = {
    kind: "image",
    referenceId: "ref-3",
    text: null,
    x: 1750,
    y: 350,
    width: 300,
    height: 300,
  };
  assert.equal(
    pageStandsAsComposed([seated(SPLIT, "img-1", "ref-1", PORTRAIT), across], pages, under, SPLIT),
    true,
  );
});

/// A picture on the canvas beside the pages is in nobody's slot, which is the
/// same thing the flat rule calls dragged out of one.
test("a picture on no page of a paged board keeps the board from standing as composed", () => {
  const pages = [page("p1", 0), page("p2", SECOND)];
  const items = [
    seated(SPLIT, "img-1", "ref-1", PORTRAIT),
    { ...seated(SPLIT, "img-2", "ref-2", PORTRAIT), y: -4000 },
  ];

  assert.equal(pagedStandsAsComposed(items, pages, SPLIT), false);
  assert.equal(pagedStandsAsComposed([], pages, SPLIT), false);
  assert.equal(pagedStandsAsComposed(items, pages, null), false);
});

/// A page the director resized carries the arrangement fitted to their rectangle
/// (`layoutForPage`), so a reader holding it to the template's own page size
/// finds nothing seated on a page that is standing perfectly well: no loose fit,
/// no opening for a cut, and a tile that has lost its template's name.
const RESIZED = { width: HD.width * 2, height: HD.height * 2 };
const FITTED = layoutOnPage(SPLIT, RESIZED);

function resized(id: string, x: number, name = id): BoardPage {
  return { id, name, x, y: 0, ...RESIZED, preset: "Custom", createdAs: "LANDSCAPE_HD" };
}

test("a picture seated on a page the director resized is seated, not read as dragged out of its slot", () => {
  const pages = [resized("p1", 0)];
  const items = [
    seated(FITTED, "img-1", "ref-1", { width: 4000, height: 2000 }),
    seated(FITTED, "img-2", "ref-2", { width: 4000, height: 2000 }),
  ];

  assert.equal(pagedPlacements(items, pages, SPLIT).length, 2);
  assert.equal(pagedStandsAsComposed(items, pages, SPLIT), true);
});

test("the opening a cut is held to on a resized page is that page's slot, at that page's scale", () => {
  const wide = { width: 4000, height: 2000 };
  const opening = pagedSlotShape(
    [seated(FITTED, "img-1", "ref-1", wide, { x: SECOND, y: 0 })],
    [resized("p2", SECOND)],
    SPLIT,
    "ref-1",
  );

  assert.equal(opening?.slotId, "img-1");
  /// The shape the compositor was briefed with, which a uniform fit cannot
  /// change: the same cut the same picture would be held to on a page nobody
  /// resized.
  assert.deepEqual(
    opening?.shape,
    pagedSlotShape([seated(SPLIT, "img-1", "ref-1", wide)], [page("p1", 0)], SPLIT, "ref-1")?.shape,
  );
});

test("a gap on a resized page is measured against the slot as that page draws it", () => {
  const pages = [resized("p1", 0)];
  const items = [seated(FITTED, "img-1", "ref-1", PORTRAIT)];

  const [loose] = pagedLooseFits(items, pages, SPLIT);

  assert.equal(loose?.referenceId, "ref-1");
  assert.equal(loose?.slotId, "img-1");
});
