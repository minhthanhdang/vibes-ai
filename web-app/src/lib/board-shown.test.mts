import { test } from "node:test";
import assert from "node:assert/strict";

import { boardShown } from "./board-shown";
import { fitInSlot, layoutById } from "./moodboard-layouts";
import type { MoodboardLayout } from "./moodboard-layouts";
import type { SceneElement } from "./moodboard-scene";

/// One board, one name — asserted here rather than at three doors. The read,
/// the model's swap and the browser's swap all draw this tile, and the naming
/// rule is the whole reason it is one function.

const SPLIT = layoutById("SPLIT")!;

const thumbs = (id: string) => `/thumb/${id}`;

function seated(
  layout: MoodboardLayout,
  placed: readonly [string, string, number, number][],
): SceneElement[] {
  return placed.map(([referenceId, slotId, width, height], index) => ({
    id: `el-${index}`,
    type: "image",
    fileId: `ref:${referenceId}`,
    ...fitInSlot(layout.slots.find((slot) => slot.id === slotId)!, {
      id: referenceId,
      kind: "image",
      width,
      height,
    }),
  })) as unknown as SceneElement[];
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
