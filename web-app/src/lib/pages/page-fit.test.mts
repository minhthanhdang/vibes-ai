import { test } from "node:test";
import assert from "node:assert/strict";

import { pagedLooseFits, pagedSlotShape } from "@/lib/pages/page-fit";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { BoardItem } from "@/lib/boards/board-contents";
import {
  PAGE_GAP,
  PAGE_PRESETS,
  fitInSlot,
  layoutById,
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
