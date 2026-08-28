import { test } from "node:test";
import assert from "node:assert/strict";

import { dragSeat, moveInOrder, orderedPages } from "@/lib/pages/page-order";
import { boardPages, pageCustomData } from "@/lib/pages/board-pages";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The stored preview order against the pages that actually exist (§III.5).
/// The contract under every case: the reader never invents a page and never
/// loses one — stale ids fall out, unheard-of pages append in reading order.

const HD = PAGE_PRESETS.LANDSCAPE_HD;

function page(id: string, x: number): SceneElement {
  return {
    id,
    type: "frame",
    x,
    y: 0,
    width: HD.width,
    height: HD.height,
    name: id,
    customData: pageCustomData(HD.width, HD.height),
  };
}

/// Three pages laid out left to right, handed to `boardPages` out of reading
/// order so the reading-order tail below is proven derived, not inherited.
function threePages() {
  return boardPages([page("c", 2 * (HD.width + PAGE_GAP)), page("a", 0), page("b", HD.width + PAGE_GAP)]);
}

function ids(pages: readonly { id: string }[]): string[] {
  return pages.map(({ id }) => id);
}

test("an empty stored list is reading order", () => {
  assert.deepEqual(ids(orderedPages(threePages(), [])), ["a", "b", "c"]);
});

test("the stored list decides, whatever reading order says", () => {
  assert.deepEqual(ids(orderedPages(threePages(), ["c", "a", "b"])), ["c", "a", "b"]);
});

test("ids of deleted pages fall out of the order", () => {
  assert.deepEqual(ids(orderedPages(threePages(), ["gone", "b", "also-gone", "a", "c"])), [
    "b",
    "a",
    "c",
  ]);
});

test("pages the list has never heard of append in reading order", () => {
  /// Only "c" was ever arranged; "a" and "b" arrived later. They land after the
  /// arrangement, ordered between themselves by the board's own geometry.
  assert.deepEqual(ids(orderedPages(threePages(), ["c"])), ["c", "a", "b"]);
});

test("a duplicated id counts once, at its first seat", () => {
  assert.deepEqual(ids(orderedPages(threePages(), ["b", "a", "b"])), ["b", "a", "c"]);
});

test("no pages reads as no pages, whatever the list claims", () => {
  assert.deepEqual(orderedPages([], ["a", "b"]), []);
});

test("moveInOrder moves one id and returns the full list", () => {
  assert.deepEqual(moveInOrder(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
});

test("a move off either end of the list is refused unchanged", () => {
  assert.deepEqual(moveInOrder(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], 2, 3), ["a", "b", "c"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], -1, 0), ["a", "b", "c"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], 3, 1), ["a", "b", "c"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], 1, 1.5), ["a", "b", "c"]);
});

test("a move to the same seat is the same list", () => {
  assert.deepEqual(moveInOrder(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
});

test("moveInOrder copies rather than mutating", () => {
  const stored = ["a", "b", "c"];
  const moved = moveInOrder(stored, 0, 2);
  assert.deepEqual(stored, ["a", "b", "c"]);
  assert.notEqual(moved, stored);
});

/// Three rows resting at midpoints 10, 30, 50 — the rail's drag against them.
const MIDPOINTS = [10, 30, 50];

test("a drag that crosses no neighbour's midpoint stays in its seat", () => {
  /// Row 0 dragged down to 25: past its own midpoint, short of row 1's.
  assert.equal(dragSeat(MIDPOINTS, 0, 25), 0);
  /// Row 2 dragged up to 35: short of row 1's midpoint from below.
  assert.equal(dragSeat(MIDPOINTS, 2, 35), 2);
  /// Row 1 sitting exactly where it was picked up.
  assert.equal(dragSeat(MIDPOINTS, 1, 30), 1);
});

test("crossing a neighbour's midpoint takes that seat", () => {
  assert.equal(dragSeat(MIDPOINTS, 0, 35), 1);
  assert.equal(dragSeat(MIDPOINTS, 2, 25), 1);
  assert.equal(dragSeat(MIDPOINTS, 1, 5), 0);
  assert.equal(dragSeat(MIDPOINTS, 1, 55), 2);
});

test("a drag past either end lands on the end seat", () => {
  assert.equal(dragSeat(MIDPOINTS, 0, 999), 2);
  assert.equal(dragSeat(MIDPOINTS, 2, -999), 0);
});

test("no rows is seat zero", () => {
  assert.equal(dragSeat([], 0, 40), 0);
});
