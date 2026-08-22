import { test } from "node:test";
import assert from "node:assert/strict";

import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import { boardPages, pagesInReadingOrder } from "@/lib/pages/board-pages";
import {
  isPageBackground,
  pageBackgroundColour,
} from "@/lib/pages/page-background";
import { canvasRead } from "@/lib/canvas-objects/object-read";
import {
  VIBES_PAGE_LIMIT,
  vibesBrief,
  type VibesBrief,
} from "@/lib/vibes/vibes-brief";
import { vibesAsk, vibesBoard } from "@/lib/vibes/vibes-start";

/// compositor-v2.md §IX.2. The board a form becomes before any model is asked
/// anything: N pages at the preset, each already standing on the theme colour,
/// in the order six design calls will be handed them.

const FORM = {
  purpose: "a welcome sign for a rustic autumn wedding",
  pages: 3,
  palette: ["#7A4B2A", "#E8D9C0"],
  vibes: "warm, intimate, candlelit",
  preset: "PORTRAIT_HD",
};

function brief(over: Partial<typeof FORM> = {}): VibesBrief {
  const made = vibesBrief({ ...FORM, ...over });
  assert.ok(made);
  return made;
}

/// Deterministic ids, so a test can say which element is which.
function counter() {
  let n = 0;
  return () => `id-${(n += 1)}`;
}

test("the board is the purpose, at the preset the form chose", () => {
  const board = vibesBoard({ brief: brief(), makeId: counter() });

  assert.equal(board.title, FORM.purpose);
  assert.deepEqual(board.size, PAGE_PRESETS.PORTRAIT_HD);
});

test("a purpose with runs of blank space in it is one line on the tab row", () => {
  const board = vibesBoard({
    brief: brief({ purpose: "a  welcome\n sign" }),
    makeId: counter(),
  });

  assert.equal(board.title, "a welcome sign");
});

test("every page asked for is drawn, at the preset, in the order they are handed out", () => {
  const board = vibesBoard({ brief: brief({ pages: 3 }), makeId: counter() });
  const pages = pagesInReadingOrder(boardPages(board.elements));

  assert.equal(pages.length, 3);
  assert.deepEqual(
    board.pageIds,
    pages.map((page) => page.id),
  );
  for (const page of pages) {
    assert.equal(page.width, PAGE_PRESETS.PORTRAIT_HD.width);
    assert.equal(page.height, PAGE_PRESETS.PORTRAIT_HD.height);
    assert.equal(page.createdAs, "PORTRAIT_HD");
  }
});

test("the pages are a spread — side by side, in reading order, never overlapping", () => {
  const board = vibesBoard({ brief: brief({ pages: 4 }), makeId: counter() });
  const pages = pagesInReadingOrder(boardPages(board.elements));

  for (let n = 1; n < pages.length; n += 1) {
    const before = pages[n - 1]!;
    const page = pages[n]!;
    assert.ok(
      page.x >= before.x + before.width,
      `page ${n + 1} overlaps the one before it`,
    );
    assert.equal(page.y, before.y);
  }
});

test("each page stands on the theme colour, one ground apiece", () => {
  const board = vibesBoard({ brief: brief({ pages: 3 }), makeId: counter() });
  const pages = boardPages(board.elements);

  for (const page of pages)
    assert.equal(pageBackgroundColour(board.elements, page), "#7a4b2a");
  assert.equal(
    board.elements.filter((element) => isPageBackground(element)).length,
    3,
  );
});

test("the ground is the page's own — its size, its frame, and behind nothing else", () => {
  const board = vibesBoard({ brief: brief({ pages: 2 }), makeId: counter() });
  const pages = pagesInReadingOrder(boardPages(board.elements));

  for (const page of pages) {
    const ground = board.elements.find(
      (element) => isPageBackground(element) && element.frameId === page.id,
    );
    assert.ok(ground);
    assert.equal(ground.x, page.x);
    assert.equal(ground.y, page.y);
    assert.equal(ground.width, page.width);
    assert.equal(ground.height, page.height);
  }
});

test("a painted page is still an empty page — no ground is an object the model can address", () => {
  const board = vibesBoard({ brief: brief({ pages: 2 }), makeId: counter() });
  const read = canvasRead(board.elements);
  assert.ok(read);

  const pages = read.objects.filter((object) => object.kind === "page");
  assert.equal(pages.length, 2);
  assert.equal(read.objects.length, pages.length);
  assert.equal(read.unaddressable, undefined);
  for (const page of pages) assert.equal(page.background, "#7a4b2a");
});

test("one page is a board too", () => {
  const board = vibesBoard({ brief: brief({ pages: 1 }), makeId: counter() });

  assert.equal(board.pageIds.length, 1);
  assert.equal(boardPages(board.elements).length, 1);
});

test("VIBES_PAGE_LIMIT pages is the largest run the form can submit", () => {
  const board = vibesBoard({
    brief: brief({ pages: VIBES_PAGE_LIMIT }),
    makeId: counter(),
  });

  assert.equal(board.pageIds.length, VIBES_PAGE_LIMIT);
  assert.equal(new Set(board.pageIds).size, VIBES_PAGE_LIMIT);
});

test("the theme colour is the first of the palette and not any of the others", () => {
  const board = vibesBoard({
    brief: brief({ palette: ["#112233", "#445566", "#778899"] }),
    makeId: counter(),
  });
  const pages = boardPages(board.elements);

  for (const page of pages)
    assert.equal(pageBackgroundColour(board.elements, page), "#112233");
});

test("the conversation gets the purpose in the user's own words and nothing restated", () => {
  assert.equal(vibesAsk(brief()), `Let's Vibes — ${FORM.purpose}`);
  assert.ok(!vibesAsk(brief()).includes("PORTRAIT_HD"));
});
