import { test } from "node:test";
import assert from "node:assert/strict";

import { VIBES_PAGE_LIMIT } from "@/lib/vibes/vibes-brief";
import {
  vibesLoop,
  vibesLoopNext,
  vibesLoopPages,
  vibesLoopProgress,
  vibesLoopSettled,
  vibesLoopStopped,
  type VibesLoop,
  type VibesStep,
} from "@/lib/vibes/vibes-loop";

/// compositor-v2.md §IX.2. The four claims the sequential browser-driven run is
/// justified by are all claims about this value: bounded work, honest progress,
/// a failure at page four that keeps pages one to three, and a Stop button that
/// means it.

function steps(count: number, from = 0): VibesStep[] {
  return Array.from({ length: count }, (_, at) => ({
    pageId: `page-${from + at}`,
    index: from + at,
  }));
}

function started(total = 3, queue = steps(total)): VibesLoop {
  return vibesLoop({ boardId: "board", title: "A welcome sign", total, steps: queue });
}

function designed(loop: VibesLoop, howMany: number): VibesLoop {
  let walked = loop;
  for (let at = 0; at < howMany; at += 1) {
    const next = vibesLoopNext(walked);
    assert.ok(next);
    walked = vibesLoopSettled(walked, { pageId: next.pageId, line: `Page ${next.index + 1}.` });
  }
  return walked;
}

test("the loop asks for one page at a time, in reading order", () => {
  let loop = started();

  assert.deepEqual(vibesLoopNext(loop), { pageId: "page-0", index: 0 });
  /// Asking twice without an answer is the same page: nothing moves until the
  /// one in flight comes back.
  assert.deepEqual(vibesLoopNext(loop), { pageId: "page-0", index: 0 });

  loop = designed(loop, 1);
  assert.deepEqual(vibesLoopNext(loop), { pageId: "page-1", index: 1 });

  loop = designed(loop, 2);
  assert.equal(vibesLoopNext(loop), null);
  assert.equal(vibesLoopProgress(loop).finished, true);
});

test("a run says which page it is on and how many were asked for", () => {
  const loop = designed(started(6, steps(6)), 2);
  const progress = vibesLoopProgress(loop);

  assert.equal(progress.page, 3);
  assert.equal(progress.total, 6);
  assert.equal(progress.designed, 2);
  assert.equal(progress.running, true);
  assert.equal(progress.label, "Designing page 3 of 6…");
});

test("a refusal at page four keeps pages one to three", () => {
  let loop = designed(started(6, steps(6)), 3);
  loop = vibesLoopSettled(loop, { pageId: "page-3", error: "no pictures left to place" });

  /// The loop stops rather than spending two more calls on whatever refused the
  /// first one.
  assert.equal(loop.halt, "refused");
  assert.equal(vibesLoopNext(loop), null);

  const progress = vibesLoopProgress(loop);
  assert.equal(progress.designed, 3);
  assert.equal(progress.refusal, "no pictures left to place");
  assert.equal(progress.label, "Page 4 was not designed — no pictures left to place");
});

test("Stop means no more pages are asked for", () => {
  let loop = designed(started(6, steps(6)), 2);
  loop = vibesLoopStopped(loop);

  assert.equal(vibesLoopNext(loop), null);
  assert.equal(vibesLoopProgress(loop).label, "Stopped — 2 pages of 6 designed");
});

test("the page in flight when Stop was pressed is still recorded", () => {
  let loop = vibesLoopStopped(started(3));
  /// The request was already out and the design really was written to the
  /// board — a loop that dropped it would be under-reporting work the user paid
  /// for, and `vibes.resume` would then hand the page back to be designed twice.
  loop = vibesLoopSettled(loop, { pageId: "page-0", line: "Page 1." });

  assert.equal(loop.settled.length, 1);
  assert.equal(loop.halt, "stopped");
  assert.equal(vibesLoopProgress(loop).designed, 1);
});

test("an outcome for a page the loop is not waiting on changes nothing", () => {
  const loop = started(3);
  assert.equal(vibesLoopSettled(loop, { pageId: "page-2", line: "Page 3." }), loop);
});

test("an outcome after the last page changes nothing", () => {
  const loop = designed(started(1), 1);
  assert.equal(vibesLoopSettled(loop, { pageId: "page-0", line: "again" }), loop);
});

test("a resumed run counts the pages it did not have to design", () => {
  /// Three of six were already there when the tab was reopened, so the loop
  /// walks the last three and the user is watching all six.
  let loop = started(6, steps(3, 3));

  assert.equal(vibesLoopProgress(loop).designed, 3);
  assert.equal(vibesLoopProgress(loop).label, "Designing page 4 of 6…");

  loop = designed(loop, 3);
  assert.equal(vibesLoopProgress(loop).label, "6 pages designed");
});

test("a hole in the middle is numbered by the page, not by the loop", () => {
  /// `vibesPending` hands back every blank page, so a run whose second page was
  /// discarded and redrawn by hand walks [1, 4, 5] — and the sentence has to be
  /// about the page the user is looking at.
  const loop = started(6, [
    { pageId: "page-1", index: 1 },
    { pageId: "page-4", index: 4 },
  ]);

  assert.equal(vibesLoopProgress(loop).label, "Designing page 2 of 6…");
  assert.equal(vibesLoopProgress(designed(loop, 1)).label, "Designing page 5 of 6…");
});

test("one page reads as one page", () => {
  const loop = designed(started(1), 1);
  assert.equal(vibesLoopProgress(loop).label, "1 page designed");
  assert.equal(vibesLoopProgress(vibesLoopStopped(started(1))).label, "Stopped — 0 pages of 1 designed");
});

test("a full run of the limit finishes on the limit", () => {
  const loop = designed(started(VIBES_PAGE_LIMIT, steps(VIBES_PAGE_LIMIT)), VIBES_PAGE_LIMIT);
  const progress = vibesLoopProgress(loop);

  assert.equal(progress.designed, VIBES_PAGE_LIMIT);
  assert.equal(progress.running, false);
  assert.equal(progress.refusal, null);
  assert.equal(progress.label, `${VIBES_PAGE_LIMIT} pages designed`);
});

test("a stop after a refusal leaves the refusal as the reason", () => {
  let loop = vibesLoopSettled(started(3), { pageId: "page-0", error: "the board went away" });
  loop = vibesLoopStopped(loop);

  assert.equal(loop.halt, "refused");
  assert.equal(vibesLoopProgress(loop).label, "Page 1 was not designed — the board went away");
});

test("every page says what is happening to it", () => {
  const loop = designed(started(4, steps(4)), 1);

  assert.deepEqual(vibesLoopPages(loop), [
    { index: 0, state: "designed" },
    { index: 1, state: "designing" },
    { index: 2, state: "waiting" },
    { index: 3, state: "waiting" },
  ]);
});

test("a resumed run's untouched pages are the ones already designed", () => {
  /// Pages one and three were there when the tab was reopened; the loop was
  /// handed two and four, and page four is refused.
  let loop = started(4, [
    { pageId: "page-1", index: 1 },
    { pageId: "page-3", index: 3 },
  ]);
  loop = vibesLoopSettled(loop, { pageId: "page-1", line: "Page 2." });
  loop = vibesLoopSettled(loop, { pageId: "page-3", error: "out of pictures" });

  assert.deepEqual(vibesLoopPages(loop), [
    { index: 0, state: "designed" },
    { index: 1, state: "designed" },
    { index: 2, state: "designed" },
    { index: 3, state: "refused" },
  ]);
  /// Which is also the arithmetic the sentence is made of: three of the four
  /// carry a design and the fourth is why it stopped.
  assert.equal(vibesLoopProgress(loop).designed, 3);
});

test("a stopped run's unasked pages stop saying they are next", () => {
  const loop = vibesLoopStopped(started(2, steps(2)));

  assert.deepEqual(vibesLoopPages(loop), [
    { index: 0, state: "waiting" },
    { index: 1, state: "waiting" },
  ]);
});

/// §IX.5. A design that runs out of rounds answers with agent 8's own line and
/// leaves the page blank. The run's account is what is on the board, so that
/// page is not a designed page — and it is not a refusal either, because
/// nothing failed and the next page is as likely to finish as this one was.
test("a page that came back empty does not stop the run and does not count", () => {
  let loop = designed(started(3), 1);
  loop = vibesLoopSettled(loop, {
    pageId: "page-1",
    line: "I ran out of steps before I could finish.",
    empty: true,
  });

  assert.equal(loop.halt, null);
  assert.deepEqual(vibesLoopNext(loop), { pageId: "page-2", index: 2 });

  const progress = vibesLoopProgress(loop);
  assert.equal(progress.designed, 1);
  assert.equal(progress.empty, 1);
  assert.equal(progress.refusal, null);
});

test("a run that walked every page and came up short says so", () => {
  let loop = designed(started(3), 2);
  loop = vibesLoopSettled(loop, { pageId: "page-2", line: "out of steps", empty: true });

  const progress = vibesLoopProgress(loop);
  assert.ok(progress.finished);
  assert.equal(progress.label, "2 pages of 3 designed — 1 page came back empty");
});

/// The mark on an empty page is its own, because "waiting" would say a page is
/// still coming and "refused" would say the run broke.
test("an empty page carries its own mark", () => {
  let loop = designed(started(3), 1);
  loop = vibesLoopSettled(loop, { pageId: "page-1", line: "out of steps", empty: true });

  assert.deepEqual(vibesLoopPages(loop), [
    { index: 0, state: "designed" },
    { index: 1, state: "empty" },
    { index: 2, state: "designing" },
  ]);
});

/// `empty: false` is the ordinary answer and has to read exactly as the field's
/// absence does — the flag arrives on every answer the mutation makes.
test("an answer that says it is not empty is a designed page", () => {
  const loop = vibesLoopSettled(started(1), { pageId: "page-0", line: "Done.", empty: false });

  assert.equal(vibesLoopProgress(loop).empty, 0);
  assert.equal(vibesLoopProgress(loop).label, "1 page designed");
});

/// A run whose last page came back empty is still a run that stopped when the
/// user pressed Stop, not one that came up short — the reason on screen is the
/// press, and the count is what is on the board either way.
test("stop is still the reason when the page in flight came back empty", () => {
  let loop = vibesLoopStopped(designed(started(3), 1));
  loop = vibesLoopSettled(loop, { pageId: "page-1", line: "out of steps", empty: true });

  assert.equal(loop.halt, "stopped");
  assert.equal(vibesLoopProgress(loop).label, "Stopped — 1 page of 3 designed");
});
