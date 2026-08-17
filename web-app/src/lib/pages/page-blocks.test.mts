import { test } from "node:test";
import assert from "node:assert/strict";

import { PAGE_BLOCK_CAP, pageBlocks } from "@/lib/pages/page-blocks";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { BoardItem, Rect } from "@/lib/boards/board-contents";

const HD = PAGE_PRESETS.LANDSCAPE_HD;
const FIRST: Rect = { x: 0, y: 0, ...HD };
/// Where a board's second page stands — the corner the boxes have to be a share
/// of rather than the origin.
const SECOND: Rect = { x: HD.width + PAGE_GAP, y: 0, ...HD };

function picture(referenceId: string, box: { x: number; y: number; width: number; height: number }): BoardItem {
  return { kind: "image", referenceId, text: null, ...box };
}

function words(text: string, box: { x: number; y: number; width: number; height: number }): BoardItem {
  return { kind: "text", referenceId: null, text, ...box };
}

test("a picture filling the left half of the page is a box from 0 to 500 across", () => {
  const { blocks } = pageBlocks([picture("a", { x: 0, y: 0, width: 960, height: 1080 })], FIRST);

  assert.deepEqual(blocks, [{ kind: "image", referenceId: "a", box: [0, 0, 1000, 500], z: 0 }]);
});

/// The whole reason the box is a share and not a pixel: the same arrangement on
/// page 2 says the same thing about the page it is on.
test("a picture on the second page is measured against that page, not against the board", () => {
  const onFirst = pageBlocks([picture("a", { x: 480, y: 270, width: 960, height: 540 })], FIRST);
  const onSecond = pageBlocks(
    [picture("a", { x: SECOND.x + 480, y: 270, width: 960, height: 540 })],
    SECOND,
  );

  assert.deepEqual(onSecond.blocks[0]!.box, [250, 250, 750, 750]);
  assert.deepEqual(onSecond.blocks[0]!.box, onFirst.blocks[0]!.box);
});

test("a page of a different shape is described in the same 0-1000 vocabulary", () => {
  const tall: Rect = { x: 0, y: 0, ...PAGE_PRESETS.PORTRAIT_HD };
  const { blocks } = pageBlocks(
    [picture("a", { x: 0, y: 0, width: tall.width / 2, height: tall.height / 4 })],
    tall,
  );

  assert.deepEqual(blocks[0]!.box, [0, 0, 250, 500]);
});

test("the blocks are in reading order and a line on the page is one of them", () => {
  const { blocks } = pageBlocks(
    [
      picture("under", { x: 100, y: 700, width: 400, height: 300 }),
      words("WHAT THE CITY KEEPS", { x: 100, y: 100, width: 800, height: 100 }),
      picture("beside", { x: 1000, y: 700, width: 400, height: 300 }),
    ],
    FIRST,
  );

  assert.deepEqual(
    blocks.map((block) => (block.kind === "text" ? block.text : block.referenceId)),
    ["WHAT THE CITY KEEPS", "under", "beside"],
  );
});

/// Reading order is the list's order; z is the array's. A collage says which of
/// two overlapping pictures is on top and nothing else in the answer does.
test("z is the scene's stacking order even when reading order disagrees with it", () => {
  const { blocks } = pageBlocks(
    [
      picture("back", { x: 700, y: 100, width: 400, height: 300 }),
      picture("front", { x: 100, y: 120, width: 400, height: 300 }),
    ],
    FIRST,
  );

  assert.deepEqual(
    blocks.map((block) => [block.kind === "image" ? block.referenceId : "", block.z]),
    [
      ["front", 1],
      ["back", 0],
    ],
  );
});

test("a picture hanging over the page edge is marked clipped and its box stops at the edge", () => {
  const { blocks } = pageBlocks([picture("over", { x: -200, y: 540, width: 600, height: 800 })], FIRST);

  assert.equal(blocks[0]!.clipped, true);
  assert.deepEqual(blocks[0]!.box, [500, 0, 1000, 208]);
});

test("a picture sitting fully inside the page is not marked clipped at all", () => {
  const { blocks } = pageBlocks([picture("in", { x: 10, y: 10, width: 400, height: 300 })], FIRST);

  assert.equal("clipped" in blocks[0]!, false);
});

/// Membership is the entity's own rule, so the block list and the page read
/// describe the same set of things.
test("a picture whose centre is on another page is not a block on this one", () => {
  const { blocks } = pageBlocks(
    [
      picture("here", { x: 100, y: 100, width: 400, height: 300 }),
      picture("there", { x: SECOND.x + 100, y: 100, width: 400, height: 300 }),
    ],
    FIRST,
  );

  assert.deepEqual(
    blocks.map((block) => (block.kind === "image" ? block.referenceId : "")),
    ["here"],
  );
});

/// It cannot be named, but it is on the page taking up that room — left out, the
/// arrangement reads as empty page where a photograph is.
test("an image naming nothing the project holds is still a block, with no reference id", () => {
  const { blocks } = pageBlocks(
    [{ kind: "image", referenceId: null, text: null, x: 0, y: 0, width: 960, height: 1080 }],
    FIRST,
  );

  assert.deepEqual(blocks, [{ kind: "image", referenceId: null, box: [0, 0, 1000, 500], z: 0 }]);
});

/// A reference is one picture in the page read — one thing the director can name
/// — and two boxes here, because two copies of it occupy two places.
test("a reference placed twice on one page is two blocks", () => {
  const { blocks } = pageBlocks(
    [
      picture("twice", { x: 100, y: 100, width: 400, height: 300 }),
      picture("twice", { x: 1000, y: 100, width: 400, height: 300 }),
    ],
    FIRST,
  );

  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0]!.box, [93, 52, 370, 260]);
  assert.deepEqual(blocks[1]!.box, [93, 521, 370, 729]);
});

test("a long line is clamped and says so, a caption is said in full", () => {
  const long = "the city keeps ".repeat(20);
  const { blocks } = pageBlocks(
    [
      words(long, { x: 0, y: 0, width: 1900, height: 100 }),
      words("  ACT ONE  ", { x: 0, y: 400, width: 900, height: 100 }),
    ],
    FIRST,
  );

  const said = blocks.flatMap((block) => (block.kind === "text" ? [block] : []));
  assert.equal(said[0]!.clamped, true);
  assert.ok(said[0]!.text.length < long.length);
  assert.ok(said[0]!.text.endsWith("…"));
  assert.equal(said[1]!.text, "ACT ONE");
  assert.equal("clamped" in said[1]!, false);
});

test("past the cap the blocks stop and what was dropped is counted", () => {
  const many = Array.from({ length: PAGE_BLOCK_CAP + 3 }, (_, index) =>
    picture(`ref-${index}`, { x: (index % 6) * 300, y: Math.floor(index / 6) * 200, width: 280, height: 180 }),
  );

  const { blocks, omitted } = pageBlocks(many, FIRST);

  assert.equal(blocks.length, PAGE_BLOCK_CAP);
  assert.equal(omitted, 3);
});

test("a page holding nothing is no blocks and nothing omitted", () => {
  assert.deepEqual(pageBlocks([], FIRST), { blocks: [], omitted: 0 });
});
