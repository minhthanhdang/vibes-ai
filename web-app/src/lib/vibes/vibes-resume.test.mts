import { test } from "node:test";
import assert from "node:assert/strict";

import { addPage } from "@/lib/pages/page-add";
import { boardPages, pagesInReadingOrder, type BoardPage } from "@/lib/pages/board-pages";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import { vibesBrief, VIBES_PAGE_LIMIT, type VibesBrief } from "@/lib/vibes/vibes-brief";
import { vibesBoard } from "@/lib/vibes/vibes-start";
import {
  vibesPageDesigned,
  vibesPending,
  vibesResumeOffer,
  vibesRun,
} from "@/lib/vibes/vibes-resume";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// compositor-v2.md §IX.5. A closed tab stops the run; this is where the next
/// one picks up. Every case below is asked of a scene rather than of a record,
/// because the scene is the only thing that cannot be wrong about whether
/// anything is on a page.

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

function counter() {
  let n = 0;
  return () => `id-${(n += 1)}`;
}

function started(over: Partial<typeof FORM> = {}) {
  const made = brief(over);
  const board = vibesBoard({ brief: made, makeId: counter() });
  return { brief: made, elements: board.elements, pageIds: board.pageIds };
}

function pageOf(elements: readonly SceneElement[], pageId: string): BoardPage {
  const page = boardPages(elements).find((one) => one.id === pageId);
  assert.ok(page);
  return page;
}

/// Something on a page, of whatever kind the case is about — placed inside the
/// page's own box, which is the only thing that makes it the page's.
function drawn(
  page: BoardPage,
  over: Partial<SceneElement> & { id: string; type: string },
): SceneElement {
  return {
    x: page.x + 40,
    y: page.y + 40,
    width: 200,
    height: 100,
    frameId: page.id,
    ...over,
  } as SceneElement;
}

test("a board nothing has been designed on yet is every page pending, in order", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 3 });

  const run = vibesRun({ elements, brief: asked });
  assert.deepEqual(
    run,
    pageIds.map((pageId, index) => ({ pageId, index, designed: false })),
  );
  assert.deepEqual(vibesPending(run), run);
});

test("a run stopped at page three picks up at page three, keeping the two before it", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 4 });
  const scene = [
    ...elements,
    drawn(pageOf(elements, pageIds[0]!), { id: "t1", type: "text", text: "WELCOME" }),
    drawn(pageOf(elements, pageIds[1]!), { id: "i1", type: "image", fileId: "ref:a" }),
  ];

  const run = vibesRun({ elements: scene, brief: asked });
  assert.deepEqual(
    run.map((page) => page.designed),
    [true, true, false, false],
  );
  assert.deepEqual(
    vibesPending(run).map((page) => page.index),
    [2, 3],
  );
});

test("the index a pending page carries is its place in the run, not its place in the queue", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 3 });
  const scene = [
    ...elements,
    drawn(pageOf(elements, pageIds[1]!), { id: "t1", type: "text", text: "TWO" }),
  ];

  const pending = vibesPending(vibesRun({ elements: scene, brief: asked }));
  assert.deepEqual(pending, [
    { pageId: pageIds[0]!, index: 0, designed: false },
    { pageId: pageIds[2]!, index: 2, designed: false },
  ]);
});

test("a page's own ground is not something on it — a painted page is still blank", () => {
  const { brief: asked, elements } = started({ pages: 2 });

  assert.deepEqual(
    vibesRun({ elements, brief: asked }).map((page) => page.designed),
    [false, false],
  );
});

test("a page somebody drew an arrow on counts as designed, though no read can address it", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 2 });
  const scene = [
    ...elements,
    drawn(pageOf(elements, pageIds[0]!), { id: "a1", type: "arrow" }),
  ];

  assert.deepEqual(
    vibesRun({ elements: scene, brief: asked }).map((page) => page.designed),
    [true, false],
  );
});

test("an erased element leaves the page blank again", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 2 });
  const scene = [
    ...elements,
    drawn(pageOf(elements, pageIds[0]!), {
      id: "t1",
      type: "text",
      text: "GONE",
      isDeleted: true,
    }),
  ];

  assert.deepEqual(
    vibesRun({ elements: scene, brief: asked }).map((page) => page.designed),
    [false, false],
  );
});

test("a page added by hand after the form is not part of the run", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 2 });
  const added = addPage({
    elements,
    defaultSize: PAGE_PRESETS.PORTRAIT_HD,
    makeId: () => "by-hand",
  });

  const run = vibesRun({ elements: added.elements, brief: asked });
  assert.equal(run.length, 2);
  assert.deepEqual(
    run.map((page) => page.pageId),
    pageIds,
  );
  assert.equal(pagesInReadingOrder(boardPages(added.elements)).length, 3);
});

test("a run whose pages were discarded is the pages that are left", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 3 });
  const kept = elements.filter(
    (element) => element.id !== pageIds[2] && element.frameId !== pageIds[2],
  );

  const run = vibesRun({ elements: kept, brief: asked });
  assert.deepEqual(
    run.map((page) => page.pageId),
    [pageIds[0]!, pageIds[1]!],
  );
});

test("a board with no pages on it at all has nothing to resume", () => {
  assert.deepEqual(vibesRun({ elements: [], brief: brief() }), []);
});

test("VIBES_PAGE_LIMIT pages resume the same way one does", () => {
  const { brief: asked, elements, pageIds } = started({ pages: VIBES_PAGE_LIMIT });
  const scene = [
    ...elements,
    drawn(pageOf(elements, pageIds[0]!), { id: "t1", type: "text", text: "ONE" }),
  ];

  const pending = vibesPending(vibesRun({ elements: scene, brief: asked }));
  assert.equal(pending.length, VIBES_PAGE_LIMIT - 1);
  assert.deepEqual(
    pending.map((page) => page.index),
    Array.from({ length: VIBES_PAGE_LIMIT - 1 }, (_, n) => n + 1),
  );
});

test("a board with nothing on it offers the whole run", () => {
  const { brief: asked, elements } = started({ pages: 3 });
  const offer = vibesResumeOffer(vibesRun({ elements, brief: asked }));

  assert.deepEqual(offer, {
    total: 3,
    designed: 0,
    remaining: 3,
    label: "0 of 3 pages designed",
    action: "Design 3 pages",
  });
});

test("a run stopped at page three offers what is left and says how far it got", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 6 });
  const scene = [
    ...elements,
    ...pageIds
      .slice(0, 3)
      .map((pageId, at) => drawn(pageOf(elements, pageId), { id: `t${at}`, type: "text", text: "X" })),
  ];

  const offer = vibesResumeOffer(vibesRun({ elements: scene, brief: asked }));
  assert.equal(offer?.designed, 3);
  assert.equal(offer?.remaining, 3);
  assert.equal(offer?.label, "3 of 6 pages designed");
  assert.equal(offer?.action, "Design 3 pages");
});

test("one page left is said as the last page rather than as one page", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 3 });
  const scene = [
    ...elements,
    ...pageIds
      .slice(0, 2)
      .map((pageId, at) => drawn(pageOf(elements, pageId), { id: `t${at}`, type: "text", text: "X" })),
  ];

  const offer = vibesResumeOffer(vibesRun({ elements: scene, brief: asked }));
  assert.equal(offer?.remaining, 1);
  assert.equal(offer?.action, "Design the last page");
});

/// The offer is what puts the card on screen, so a finished board making one
/// is a button that spends six model calls redesigning pages that are already
/// there.
test("a finished board offers nothing at all", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 3 });
  const scene = [
    ...elements,
    ...pageIds.map((pageId, at) =>
      drawn(pageOf(elements, pageId), { id: `t${at}`, type: "text", text: "X" }),
    ),
  ];

  assert.equal(vibesResumeOffer(vibesRun({ elements: scene, brief: asked })), null);
});

test("a board whose pages were all discarded offers nothing", () => {
  assert.equal(vibesResumeOffer(vibesRun({ elements: [], brief: brief() })), null);
});

/// A hole in the middle is counted as a page still owed, not as a run that
/// finished — the numbers on the card and the pages the loop walks are the same
/// reading of the same board.
test("a hole in the middle is offered and counted", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 3 });
  const scene = [
    ...elements,
    drawn(pageOf(elements, pageIds[0]!), { id: "t1", type: "text", text: "X" }),
    drawn(pageOf(elements, pageIds[2]!), { id: "t3", type: "text", text: "X" }),
  ];

  const run = vibesRun({ elements: scene, brief: asked });
  const offer = vibesResumeOffer(run);
  assert.equal(offer?.label, "2 of 3 pages designed");
  assert.deepEqual(
    vibesPending(run).map((page) => page.index),
    [1],
  );
});

test("a one-page run says page rather than pages", () => {
  const { brief: asked, elements } = started({ pages: 1 });
  const offer = vibesResumeOffer(vibesRun({ elements, brief: asked }));
  assert.equal(offer?.label, "0 of 1 page designed");
  assert.equal(offer?.action, "Design the last page");
});

/// §IX.5. The question `vibes.designPage` asks the moment a design answers, so
/// that a page that came back with a line and nothing on it is not counted a
/// designed page. It has to be the same reading the resume offer makes, or the
/// walk and the board would say different things about the same page.
test("one page, asked by id, answers what the whole run would have said about it", () => {
  const { brief: asked, elements, pageIds } = started({ pages: 3 });
  const scene = [
    ...elements,
    drawn(pageOf(elements, pageIds[1]!), { id: "t1", type: "text", text: "WELCOME" }),
  ];

  for (const [index, pageId] of pageIds.entries())
    assert.equal(
      vibesPageDesigned({ elements: scene, pageId }),
      vibesRun({ elements: scene, brief: asked })[index]!.designed,
    );
});

test("a page standing on nothing but the ground the form painted is not designed", () => {
  const { elements, pageIds } = started({ pages: 2 });

  assert.equal(vibesPageDesigned({ elements, pageId: pageIds[0]! }), false);
});

/// A page discarded while the run was walking it: there is nothing there to
/// have designed, and the answer is the one that leaves it out of the count
/// rather than the one that claims a design nobody can see.
test("a page that is no longer on the board is not a designed page", () => {
  const { elements } = started({ pages: 2 });

  assert.equal(vibesPageDesigned({ elements, pageId: "a page that went away" }), false);
});
