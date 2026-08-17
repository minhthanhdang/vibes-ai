import { test } from "node:test";
import assert from "node:assert/strict";

import { boardShown } from "@/lib/boards/board-shown";
import { PAGE_GAP, fitInSlot, layoutById } from "@/lib/layout/moodboard-layouts";
import type { MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import { pageFrame } from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// One board, one name — asserted here rather than at three doors. The read,
/// the model's swap and the browser's swap all draw this tile, and the naming
/// rule is the whole reason it is one function.

const SPLIT = layoutById("SPLIT")!;

const thumbs = (id: string) => `/thumb/${id}`;

function seated(
  layout: MoodboardLayout,
  placed: readonly [string, string, number, number][],
  at = { x: 0, y: 0 },
): SceneElement[] {
  return placed.map(([referenceId, slotId, width, height], index) => {
    const box = fitInSlot(layout.slots.find((slot) => slot.id === slotId)!, {
      id: referenceId,
      kind: "image",
      width,
      height,
    });
    return {
      id: `el-${referenceId}-${index}`,
      type: "image",
      fileId: `ref:${referenceId}`,
      ...box,
      x: box.x + at.x,
      y: box.y + at.y,
    };
  }) as unknown as SceneElement[];
}

/// Where a board's second page stands, and the two pages of the spread every
/// page-scoped test below is about.
const SECOND = SPLIT.page.width + PAGE_GAP;

function spread(): SceneElement[] {
  const slots = SPLIT.slots.filter((slot) => slot.kind === "image");
  return [
    ...seated(SPLIT, [
      ["a", slots[0]!.id, slots[0]!.width, slots[0]!.height],
      ["b", slots[1]!.id, slots[1]!.width, slots[1]!.height],
    ]),
    pageFrame({ x: 0, y: 0, ...SPLIT.page }, { name: "Cold open", makeId: () => "page-1" }),
    ...seated(
      SPLIT,
      [["c", slots[0]!.id, slots[0]!.width, slots[0]!.height]],
      { x: SECOND, y: 0 },
    ),
    pageFrame({ x: SECOND, y: 0, ...SPLIT.page }, { name: "Act two", makeId: () => "page-2" }),
  ];
}

function boardRow(over: Partial<Parameters<typeof boardShown>[0]["board"]> = {}) {
  return {
    id: "bd1",
    title: "Ridge study",
    widthPx: SPLIT.page.width,
    heightPx: SPLIT.page.height,
    layout: SPLIT.id,
    ...over,
  };
}

test("a board still sitting in its slots is named by its template", () => {
  const slots = SPLIT.slots.filter((slot) => slot.kind === "image");
  const attachment = boardShown({
    board: boardRow(),
    elements: seated(SPLIT, [
      ["a", slots[0]!.id, slots[0]!.width, slots[0]!.height],
      ["b", slots[1]!.id, slots[1]!.width, slots[1]!.height],
    ]),
    thumbUrlOf: thumbs,
  });

  assert.equal(attachment.kind, "board");
  assert.equal(attachment.boardId, "bd1");
  assert.equal(attachment.caption, "2 photographs · Split");
  /// The cover is the first picture in reading order, which is the one a board
  /// nobody has drawn yet shows.
  assert.equal(attachment.thumbUrl, "/thumb/a");
  assert.equal(attachment.preview?.items.length, 2);
});

test("a board with a picture dragged out of its slot is named by its page", () => {
  const slots = SPLIT.slots.filter((slot) => slot.kind === "image");
  const elements = seated(SPLIT, [
    ["a", slots[0]!.id, slots[0]!.width, slots[0]!.height],
    ["b", slots[1]!.id, slots[1]!.width, slots[1]!.height],
  ]);
  const moved = elements.map((element, index) =>
    index === 1 ? { ...element, x: (element as unknown as { x: number }).x + 300 } : element,
  );

  const attachment = boardShown({ board: boardRow(), elements: moved, thumbUrlOf: thumbs });
  assert.equal(attachment.caption, `2 photographs · ${SPLIT.page.width}×${SPLIT.page.height}`);
});

test("a board the director dragged together has no template to be named by", () => {
  const attachment = boardShown({
    board: boardRow({ layout: null }),
    elements: [
      { id: "e1", type: "image", fileId: "ref:a", x: 10, y: 10, width: 200, height: 100 },
    ] as unknown as SceneElement[],
    thumbUrlOf: thumbs,
  });

  assert.equal(attachment.caption, `1 photograph · ${SPLIT.page.width}×${SPLIT.page.height}`);
  assert.equal(attachment.preview?.items.length, 1);
});

test("a board with nothing on it has no cover and nothing to draw", () => {
  const attachment = boardShown({ board: boardRow(), elements: [], thumbUrlOf: thumbs });
  assert.equal(attachment.thumbUrl, null);
  assert.equal(attachment.preview, null);
});

/// A picture the gallery no longer holds keeps its place on the board, so it is
/// counted — but there is no thumbnail for it, and the cover falls through to
/// the next one rather than to nothing.
test("a picture with no thumbnail is still counted and the cover moves on", () => {
  const slots = SPLIT.slots.filter((slot) => slot.kind === "image");
  const attachment = boardShown({
    board: boardRow(),
    elements: seated(SPLIT, [
      ["gone", slots[0]!.id, slots[0]!.width, slots[0]!.height],
      ["b", slots[1]!.id, slots[1]!.width, slots[1]!.height],
    ]),
    thumbUrlOf: (id) => (id === "gone" ? null : `/thumb/${id}`),
  });

  assert.equal(attachment.caption, "2 photographs · Split");
  assert.equal(attachment.thumbUrl, "/thumb/b");
});

/// tech-spec §V: the answers this tile rides with are page-scoped now, and a
/// miniature of the whole spread under a sentence about one page shows the
/// director the pages it says nothing about.

test("a tile of one page is drawn from that page alone", () => {
  const attachment = boardShown({
    board: boardRow(),
    elements: spread(),
    thumbUrlOf: thumbs,
    pageId: "page-2",
  });

  /// One picture, because the two on page 1 are not what this tile is of.
  assert.equal(attachment.caption, "“Act two”, page 2 of 2 · 1 photograph · Split");
  assert.equal(attachment.images, 1);
  assert.equal(attachment.thumbUrl, "/thumb/c");
  assert.equal(attachment.preview?.items.length, 1);
});

/// The page's own corner, not the scene's: read in board coordinates the picture
/// on page 2 sits a page and a gutter to the right of everything, which as a
/// percentage of the miniature is off the end of it.
test("a page's picture is drawn where it sits on that page rather than on the board", () => {
  const elements = spread();
  const second = boardShown({ board: boardRow(), elements, thumbUrlOf: thumbs, pageId: "page-2" });
  const first = boardShown({ board: boardRow(), elements, thumbUrlOf: thumbs, pageId: "page-1" });

  assert.deepEqual(
    { left: second.preview!.items[0]!.left, top: second.preview!.items[0]!.top },
    { left: first.preview!.items[0]!.left, top: first.preview!.items[0]!.top },
  );
  assert.equal(second.preview?.aspectRatio, SPLIT.page.width / SPLIT.page.height);
});

/// The page rect is the frame the render is cut to, so a picture hanging over
/// the edge runs off the tile exactly as excalidraw draws it running off the
/// page — which is the difference between an overflow and a crop.
test("a picture over the page edge is drawn running off the tile", () => {
  const elements = [
    ...spread(),
    {
      id: "over",
      type: "image",
      fileId: "ref:d",
      /// Its centre is on page 2 — which is what puts it on the page (§V.3) —
      /// and its right edge is past the page's.
      x: SECOND + SPLIT.page.width - 250,
      y: 0,
      width: 400,
      height: 300,
    },
  ] as unknown as SceneElement[];

  const drawn = boardShown({
    board: boardRow(),
    elements,
    thumbUrlOf: thumbs,
    pageId: "page-2",
  }).preview!.items;

  assert.equal(drawn.length, 2);
  assert.ok(drawn.some((item) => item.left + item.width > 100));
});

/// The caller has already refused the id in its own answer; a blank tile beside
/// that refusal would read as the board having been emptied.
test("a pageId the board has not got falls back to the whole board", () => {
  const elements = spread();
  const attachment = boardShown({
    board: boardRow(),
    elements,
    thumbUrlOf: thumbs,
    pageId: "page-9",
  });

  assert.deepEqual(
    attachment,
    boardShown({ board: boardRow(), elements, thumbUrlOf: thumbs }),
  );
});

/// The only page of a board is the board. Its name is on the tile above the
/// caption already, and "page 1 of 1" under it disambiguates nothing.
test("a board of one page says no page in its caption", () => {
  const slots = SPLIT.slots.filter((slot) => slot.kind === "image");
  const elements = [
    ...seated(SPLIT, [
      ["a", slots[0]!.id, slots[0]!.width, slots[0]!.height],
      ["b", slots[1]!.id, slots[1]!.width, slots[1]!.height],
    ]),
    pageFrame({ x: 0, y: 0, ...SPLIT.page }, { name: "Cold open", makeId: () => "page-1" }),
  ] as SceneElement[];

  const attachment = boardShown({
    board: boardRow(),
    elements,
    thumbUrlOf: thumbs,
    pageId: "page-1",
  });

  assert.equal(attachment.caption, "2 photographs · Split");
});
