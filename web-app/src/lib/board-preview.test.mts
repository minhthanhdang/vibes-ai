import { test } from "node:test";
import assert from "node:assert/strict";

import { boardPreview, scenePreview } from "./board-preview";
import type { LayoutBlock, LayoutSlot, Placement } from "./moodboard-layouts";

const PAGE = { width: 1000, height: 500 };

function slot(id: string, box: Partial<LayoutSlot> & { x: number; y: number; width: number; height: number }): LayoutSlot {
  return { id, kind: "image", ...box };
}

function placement(s: LayoutSlot, b: LayoutBlock): Placement {
  return { slot: s, block: b };
}

const thumbs = (id: string) => `/api/references/${id}/image?variant=thumb`;

test("a picture at its slot's shape is the slot, in percent of the page", () => {
  const preview = boardPreview(
    [
      placement(slot("img-1", { x: 100, y: 50, width: 400, height: 200 }), {
        id: "ref-1",
        kind: "image",
        width: 2000,
        height: 1000,
      }),
    ],
    PAGE,
    thumbs,
  );

  assert.ok(preview);
  assert.equal(preview.aspectRatio, 2);
  assert.deepEqual(preview.items, [
    {
      kind: "image",
      left: 10,
      top: 10,
      width: 40,
      height: 40,
      thumbUrl: "/api/references/ref-1/image?variant=thumb",
    },
  ]);
});

test("a picture loose in its slot is drawn loose, centred in the room it does not use", () => {
  /// A square in a 2:1 slot: half the slot's width, all of its height, and the
  /// gap split either side. The board draws it this way, so the miniature has
  /// to as well — the gap is what the reply's crop offer is about.
  const preview = boardPreview(
    [
      placement(slot("img-1", { x: 0, y: 0, width: 400, height: 200 }), {
        id: "ref-1",
        kind: "image",
        width: 800,
        height: 800,
      }),
    ],
    PAGE,
    thumbs,
  );

  assert.ok(preview);
  assert.deepEqual(preview.items[0], {
    kind: "image",
    left: 10,
    top: 0,
    width: 20,
    height: 40,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
  });
});

test("a text slot is its own box and carries no picture", () => {
  const preview = boardPreview(
    [
      placement(slot("text-0", { x: 0, y: 400, width: 1000, height: 100, kind: "text" }), {
        id: "caption-0",
        kind: "text",
        text: "Act one",
      }),
    ],
    PAGE,
    thumbs,
  );

  assert.deepEqual(preview?.items, [{ kind: "text", left: 0, top: 80, width: 100, height: 20 }]);
});

test("captions are drawn after the photographs, the order the scene is written in", () => {
  const preview = boardPreview(
    [
      placement(slot("text-0", { x: 0, y: 400, width: 1000, height: 100, kind: "text" }), {
        id: "caption-0",
        kind: "text",
        text: "Act one",
      }),
      placement(slot("img-1", { x: 0, y: 0, width: 400, height: 200 }), {
        id: "ref-1",
        kind: "image",
        width: 800,
        height: 400,
      }),
    ],
    PAGE,
    thumbs,
  );

  assert.deepEqual(
    preview?.items.map((item) => item.kind),
    ["image", "text"],
  );
});

test("a tilted slot carries its angle in degrees, the unit CSS turns it by", () => {
  const preview = boardPreview(
    [
      placement(slot("img-1", { x: 0, y: 0, width: 200, height: 200, angle: Math.PI / 4 }), {
        id: "ref-1",
        kind: "image",
        width: 800,
        height: 800,
      }),
    ],
    PAGE,
    thumbs,
  );

  assert.equal(preview?.items[0]?.angle, 45);
});

test("a picture with no thumbnail yet still holds its place", () => {
  const preview = boardPreview(
    [
      placement(slot("img-1", { x: 0, y: 0, width: 200, height: 200 }), {
        id: "ref-1",
        kind: "image",
        width: 800,
        height: 800,
      }),
    ],
    PAGE,
    () => null,
  );

  assert.deepEqual(preview?.items, [{ kind: "image", left: 0, top: 0, width: 20, height: 40 }]);
});

test("a box against the top left is at zero rather than at negative zero", () => {
  const preview = boardPreview(
    [
      placement(slot("img-1", { x: 0, y: 0, width: 200, height: 100 }), {
        id: "ref-1",
        kind: "image",
        width: 400,
        height: 200,
      }),
    ],
    PAGE,
    thumbs,
  );

  assert.ok(!Object.is(preview?.items[0]?.left, -0));
  assert.ok(!Object.is(preview?.items[0]?.top, -0));
});

test("nothing placed is nothing to draw, and a page with no size is not a page", () => {
  assert.equal(boardPreview([], PAGE, thumbs), null);
  assert.equal(
    boardPreview(
      [
        placement(slot("img-1", { x: 0, y: 0, width: 200, height: 200 }), {
          id: "ref-1",
          kind: "image",
          width: 800,
          height: 800,
        }),
      ],
      { width: 0, height: 500 },
      thumbs,
    ),
    null,
  );
});

/// The scene half: a board read back off its elements, which is the only
/// description of an arrangement that survives a director rearranging it.
test("a stored scene previews in percent of the rectangle it covers, images before text", () => {
  const preview = scenePreview(
    [
      { kind: "text", referenceId: null, text: "Act one", x: 0, y: 400, width: 500, height: 50 },
      {
        kind: "image",
        referenceId: "ref-1",
        text: null,
        x: 100,
        y: 50,
        width: 400,
        height: 200,
        angle: Math.PI / 2,
      },
    ],
    { x: 0, y: 0, width: 1000, height: 500 },
    thumbs,
  );

  assert.equal(preview?.aspectRatio, 2);
  assert.deepEqual(preview?.items, [
    {
      kind: "image",
      left: 10,
      top: 10,
      width: 40,
      height: 40,
      angle: 90,
      thumbUrl: thumbs("ref-1"),
    },
    { kind: "text", left: 0, top: 80, width: 50, height: 10 },
  ]);
});

/// A board dragged past its own page: the rectangle starts left of zero, so the
/// items are placed against *it* and not against the page they hang off.
test("a scene wider than its page draws against the rectangle that covers it", () => {
  const preview = scenePreview(
    [{ kind: "image", referenceId: "ref-1", text: null, x: -100, y: 0, width: 100, height: 100 }],
    { x: -100, y: 0, width: 200, height: 100 },
    () => null,
  );

  assert.deepEqual(preview?.items, [{ kind: "image", left: 0, top: 0, width: 50, height: 100 }]);
});

test("a scene with nothing on it has no miniature", () => {
  assert.equal(scenePreview([], { x: 0, y: 0, width: 1000, height: 500 }, thumbs), null);
});
