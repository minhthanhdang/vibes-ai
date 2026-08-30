import { test } from "node:test";
import assert from "node:assert/strict";

import { PAGE_BLOCK_CAP, pageBlocks } from "@/lib/pages/page-blocks";
import { PAGE_GAP, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { BoardItem, Rect } from "@/lib/boards/board-contents";

const HD = PAGE_PRESETS.LANDSCAPE_HD;
const FIRST: Rect = { x: 0, y: 0, ...HD };
const SECOND: Rect = { x: HD.width + PAGE_GAP, y: 0, ...HD };

function picture(
  referenceId: string,
  box: { x: number; y: number; width: number; height: number },
  opacity?: number,
): BoardItem {
  return { kind: "image", referenceId, text: null, ...box, ...(opacity !== undefined && { opacity }) };
}

function words(
  text: string,
  box: { x: number; y: number; width: number; height: number },
  opacity?: number,
): BoardItem {
  return { kind: "text", referenceId: null, text, ...box, ...(opacity !== undefined && { opacity }) };
}

function block(
  shape: "rectangle" | "ellipse" | "line",
  box: { x: number; y: number; width: number; height: number },
  { opacity, ...appearance }: Partial<BoardItem["style"] & { opacity: number }> = {},
): BoardItem {
  return {
    kind: "shape",
    referenceId: null,
    text: null,
    shape,
    style: {
      fill: "transparent",
      stroke: "#1e1e1e",
      strokeWidth: 1,
      strokeStyle: "solid",
      rounded: false,
      ...appearance,
    },
    ...(opacity !== undefined && { opacity }),
    ...box,
  };
}

test("a picture filling the left half of the page is a box from 0 to 500 across", () => {
  const { blocks } = pageBlocks([picture("a", { x: 0, y: 0, width: 960, height: 1080 })], FIRST);

  assert.deepEqual(blocks, [{ kind: "image", referenceId: "a", box: [0, 0, 1000, 500], z: 0 }]);
});

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
    blocks.map((block) =>
      block.kind === "text" ? block.text : block.kind === "image" ? block.referenceId : block.shape,
    ),
    ["WHAT THE CITY KEEPS", "under", "beside"],
  );
});

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

test("an image naming nothing the project holds is still a block, with no reference id", () => {
  const { blocks } = pageBlocks(
    [{ kind: "image", referenceId: null, text: null, x: 0, y: 0, width: 960, height: 1080 }],
    FIRST,
  );

  assert.deepEqual(blocks, [{ kind: "image", referenceId: null, box: [0, 0, 1000, 500], z: 0 }]);
});

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

test("past the cap it is the small print that goes, not the foot of the page", () => {
  const top = Array.from({ length: PAGE_BLOCK_CAP }, (_, index) =>
    words(`caption ${index}`, { x: (index % 6) * 300, y: Math.floor(index / 6) * 60, width: 200, height: 40 }),
  );
  const foot = picture("hero", { x: 0, y: 700, width: 1900, height: 340 });

  const { blocks, omitted } = pageBlocks([...top, foot], FIRST);

  assert.equal(omitted, 1);
  assert.equal(
    blocks.filter((entry) => entry.kind === "image").length,
    1,
    "the widest thing on the page was dropped for a caption",
  );
  assert.equal(blocks.at(-1)!.kind, "image");
});

test("a rule across the page outranks a caption for the cap", () => {
  const captions = Array.from({ length: PAGE_BLOCK_CAP }, (_, index) =>
    words(`caption ${index}`, { x: 0, y: index * 40, width: 300, height: 30 }),
  );
  const rule = block("line", { x: 96, y: 1000, width: 1728, height: 0 });

  const { blocks, omitted } = pageBlocks([...captions, rule], FIRST);

  assert.equal(omitted, 1);
  assert.equal(blocks.filter((entry) => entry.kind === "shape").length, 1);
});

test("the blocks the cap keeps are still in reading order", () => {
  const many = Array.from({ length: PAGE_BLOCK_CAP + 1 }, (_, index) =>
    picture(`ref-${index}`, {
      x: 0,
      y: index * 40,
      width: 100 + index * 70,
      height: 30,
    }),
  );

  const { blocks } = pageBlocks(many, FIRST);

  assert.deepEqual(
    blocks.map((entry) => (entry.kind === "image" ? entry.referenceId : null)),
    Array.from({ length: PAGE_BLOCK_CAP }, (_, index) => `ref-${index + 1}`),
  );
});

test("a page holding nothing is no blocks and nothing omitted", () => {
  assert.deepEqual(pageBlocks([], FIRST), { blocks: [], omitted: 0 });
});


test("a shape on the page is a block, with what it is and what colour it is standing there in", () => {
  const { blocks } = pageBlocks(
    [
      block("rectangle", { x: 0, y: 0, width: 1920, height: 1080 }, { fill: "#0c111c" }),
      picture("a", { x: 100, y: 100, width: 400, height: 400 }),
    ],
    FIRST,
  );

  assert.deepEqual(blocks, [
    {
      kind: "shape",
      shape: "rectangle",
      fill: "#0c111c",
      stroke: "#1e1e1e",
      box: [0, 0, 1000, 1000],
      z: 0,
    },
    { kind: "image", referenceId: "a", box: [93, 52, 463, 260], z: 1 },
  ]);
});

test("a shape's opacity is carried when it is less than whole", () => {
  const { blocks } = pageBlocks(
    [
      block("rectangle", { x: 0, y: 0, width: 960, height: 1080 }, { fill: "#000000", opacity: 40 }),
      block("line", { x: 100, y: 540, width: 800, height: 0 }, { opacity: 100 }),
    ],
    FIRST,
  );

  assert.deepEqual(
    blocks.map((entry) => (entry.kind === "shape" ? [entry.shape, entry.opacity] : null)),
    [
      ["rectangle", 40],
      ["line", undefined],
    ],
  );
});

test("a faded photograph and a faded line of type carry their opacity too", () => {
  const { blocks } = pageBlocks(
    [
      picture("ref-a", { x: 0, y: 0, width: 960, height: 1080 }, 40),
      picture("ref-b", { x: 960, y: 0, width: 400, height: 400 }),
      words("under it", { x: 100, y: 900, width: 400, height: 40 }, 30),
    ],
    FIRST,
  );

  assert.deepEqual(
    blocks.map((entry) => entry.opacity),
    [40, undefined, 30],
  );
});

test("shapes compete with pictures for the block cap", () => {
  const items: BoardItem[] = [];
  for (let at = 0; at < PAGE_BLOCK_CAP; at += 1) {
    items.push(block("rectangle", { x: at * 10, y: 0, width: 40, height: 40 }));
  }
  items.push(picture("late", { x: 0, y: 800, width: 200, height: 200 }));

  const { blocks, omitted } = pageBlocks(items, FIRST);

  assert.equal(blocks.length, PAGE_BLOCK_CAP);
  assert.equal(omitted, 1);
});
