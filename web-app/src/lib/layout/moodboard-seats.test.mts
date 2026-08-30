import { test } from "node:test";
import assert from "node:assert/strict";

import { keptSeats } from "@/lib/layout/moodboard-seats";
import type { BoardItem } from "@/lib/boards/board-contents";
import type { LayoutBlock, LayoutSlot, MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import { fitInSlot, layoutById, slotFontSize } from "@/lib/layout/moodboard-layouts";
import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";

const STRIP = layoutById("FILMSTRIP")!;
const HERO = layoutById("HERO_LEFT")!;

function picture(id: string, width: number, height: number): LayoutBlock {
  return { id, kind: "image", width, height };
}

function line(id: string, text: string): LayoutBlock {
  return { id, kind: "text", text };
}

function seated(layout: MoodboardLayout, slotId: string, block: LayoutBlock): BoardItem {
  const slot = layout.slots.find((entry) => entry.id === slotId)!;
  const box = fitInSlot(slot, block);
  return {
    kind: "image",
    referenceId: block.id,
    text: null,
    ...box,
    ...(slot.angle ? { angle: slot.angle } : {}),
  };
}

function setAt(layout: MoodboardLayout, slotId: string, text: string): BoardItem {
  const slot = layout.slots.find((entry) => entry.id === slotId)!;
  return {
    kind: "text",
    referenceId: null,
    text,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: Math.round(slotFontSize(slot) * TEXT_LINE_HEIGHT),
    ...(slot.angle ? { angle: slot.angle } : {}),
  };
}

const ids = (blocks: readonly LayoutBlock[]) => blocks.map((block) => block.id);
const slotIds = (slots: readonly LayoutSlot[]) => slots.map((slot) => slot.id);

test("a picture still in its slot keeps it, and the joining one gets the free slots", () => {
  const a = picture("a", 400, 300);
  const b = picture("b", 400, 300);
  const c = picture("c", 400, 300);
  const seats = keptSeats({
    items: [seated(STRIP, "img-1", a), seated(STRIP, "img-2", b)],
    layout: STRIP,
    blocks: [a, b, c],
  });

  assert.deepEqual(
    seats.kept.map(({ slot, block }) => [slot.id, block.id]),
    [
      ["img-1", "a"],
      ["img-2", "b"],
    ],
  );
  assert.deepEqual(slotIds(seats.free), ["img-3", "img-4"]);
  assert.deepEqual(ids(seats.joining), ["c"]);
});

test("the block kept is the offered one, so a rebuild re-draws from the reference's own size", () => {
  const a = picture("a", 400, 300);
  const seats = keptSeats({
    items: [seated(STRIP, "img-1", a)],
    layout: STRIP,
    blocks: [a],
  });

  assert.deepEqual(seats.kept[0]!.block, a);
});

test("a picture taken off the board frees its slot", () => {
  const a = picture("a", 400, 300);
  const b = picture("b", 400, 300);
  const seats = keptSeats({
    items: [seated(STRIP, "img-1", a), seated(STRIP, "img-2", b)],
    layout: STRIP,
    blocks: [a],
  });

  assert.deepEqual(ids(seats.kept.map(({ block }) => block)), ["a"]);
  assert.deepEqual(slotIds(seats.free), ["img-2", "img-3", "img-4"]);
  assert.deepEqual(seats.joining, []);
});

test("a picture the user dragged is in no slot, so it joins rather than stays", () => {
  const a = picture("a", 400, 300);
  const moved = { ...seated(STRIP, "img-1", a), x: 12 };
  const seats = keptSeats({ items: [moved], layout: STRIP, blocks: [a] });

  assert.deepEqual(seats.kept, []);
  assert.deepEqual(ids(seats.joining), ["a"]);
  assert.deepEqual(slotIds(seats.free), slotIds(STRIP.slots));
});

test("a line still set at its text slot keeps it, matched on the words", () => {
  const a = picture("a", 400, 300);
  const headline = line("caption-1", "act  TWO");
  const seats = keptSeats({
    items: [seated(HERO, "img-1", a), setAt(HERO, "text-1", "Act two")],
    layout: HERO,
    blocks: [headline, a],
  });

  assert.deepEqual(
    seats.kept.map(({ slot, block }) => [slot.id, block.id]),
    [
      ["img-1", "a"],
      ["text-1", "caption-1"],
    ],
  );
  assert.equal(
    seats.free.some((slot) => slot.kind === "text"),
    false,
  );
  assert.deepEqual(seats.joining, []);
});

test("a line whose words changed is a joining block, not a kept one", () => {
  const seats = keptSeats({
    items: [setAt(HERO, "text-1", "Act two")],
    layout: HERO,
    blocks: [line("caption-1", "Act three")],
  });

  assert.deepEqual(seats.joining.map((block) => block.text), ["Act three"]);
  assert.equal(seats.kept.length, 0);
});

test("kept placements come back in the template's own order", () => {
  const a = picture("a", 400, 300);
  const b = picture("b", 400, 300);
  const seats = keptSeats({
    items: [seated(STRIP, "img-3", b), seated(STRIP, "img-1", a)],
    layout: STRIP,
    blocks: [a, b],
  });

  assert.deepEqual(slotIds(seats.kept.map(({ slot }) => slot)), ["img-1", "img-3"]);
});

test("a picture on the board that is not among the blocks holds no slot", () => {
  const a = picture("a", 400, 300);
  const gone = picture("gone", 400, 300);
  const seats = keptSeats({
    items: [seated(STRIP, "img-1", gone), seated(STRIP, "img-2", a)],
    layout: STRIP,
    blocks: [a],
  });

  assert.deepEqual(slotIds(seats.free), ["img-1", "img-3", "img-4"]);
  assert.deepEqual(
    seats.kept.map(({ slot, block }) => [slot.id, block.id]),
    [["img-2", "a"]],
  );
});

test("an empty board keeps nothing and frees everything", () => {
  const a = picture("a", 400, 300);
  const seats = keptSeats({ items: [], layout: STRIP, blocks: [a] });

  assert.deepEqual(seats.kept, []);
  assert.deepEqual(slotIds(seats.free), slotIds(STRIP.slots));
  assert.deepEqual(ids(seats.joining), ["a"]);
});
