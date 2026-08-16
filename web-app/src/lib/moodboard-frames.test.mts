import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FRAME_PADDING,
  boardFrames,
  frameHolding,
  frameInnerBox,
  frameOf,
} from "./moodboard-frames";
import { droppedImages } from "./moodboard-drop";
import { persistableElements } from "./moodboard-scene";

function frame(id: string, box: { x: number; y: number; width: number; height: number }) {
  return { id, type: "frame", name: id, ...box };
}

test("frames are read in z-order and anything else is not one", () => {
  const frames = boardFrames([
    frame("back", { x: 0, y: 0, width: 400, height: 300 }),
    { id: "photo", type: "image", x: 10, y: 10, width: 50, height: 50 },
    { id: "note", type: "rectangle", x: 10, y: 10, width: 50, height: 50 },
    { ...frame("magic", { x: 500, y: 0, width: 200, height: 200 }), type: "magicframe" },
  ]);

  assert.deepEqual(
    frames.map((entry) => entry.id),
    ["back", "magic"],
  );
});

test("a deleted or unmeasurable frame is not a section", () => {
  const frames = boardFrames([
    { ...frame("gone", { x: 0, y: 0, width: 400, height: 300 }), isDeleted: true },
    { id: "flat", type: "frame", x: 0, y: 0, width: 0, height: 300 },
    { id: "nowhere", type: "frame", y: 0, width: 100, height: 100 },
    frame("real", { x: 0, y: 0, width: 400, height: 300 }),
  ]);

  assert.deepEqual(
    frames.map((entry) => entry.id),
    ["real"],
  );
});

/// Excalidraw clears membership when a frame is deleted, but a scene written by
/// anything else can still name one that is not there — and a photo in a frame
/// that does not exist is a photo on the canvas.
test("a frameId naming no frame on the board resolves to nothing", () => {
  const frames = boardFrames([frame("act-one", { x: 0, y: 0, width: 400, height: 300 })]);

  assert.equal(frameOf(frames, "act-one")?.id, "act-one");
  assert.equal(frameOf(frames, "act-two"), null);
  assert.equal(frameOf(frames, null), null);
  assert.equal(frameOf(frames, 7), null);
});

test("a frame's inner box is its own box less the padding on every side", () => {
  const inner = frameInnerBox({ id: "f", x: 100, y: 50, width: 400, height: 300 });

  assert.deepEqual(inner, {
    x: 100 + FRAME_PADDING,
    y: 50 + FRAME_PADDING,
    width: 400 - FRAME_PADDING * 2,
    height: 300 - FRAME_PADDING * 2,
  });
});

test("a photo joins the frame it lands entirely inside, and not one it hangs out of", () => {
  const frames = boardFrames([frame("act-one", { x: 0, y: 0, width: 400, height: 400 })]);

  assert.equal(frameHolding(frames, { x: 10, y: 10, width: 100, height: 100 }), "act-one");
  assert.equal(frameHolding(frames, { x: 0, y: 0, width: 400, height: 400 }), "act-one");
  /// Overhanging by a unit: excalidraw would draw it clipped at the edge, which
  /// on arrival reads as a photo that lost a side rather than as a section.
  assert.equal(frameHolding(frames, { x: 350, y: 10, width: 100, height: 100 }), null);
  assert.equal(frameHolding(frames, { x: 500, y: 0, width: 50, height: 50 }), null);
  assert.equal(frameHolding([], { x: 10, y: 10, width: 10, height: 10 }), null);
});

test("overlapping frames hand a photo to the one on top", () => {
  const frames = boardFrames([
    frame("under", { x: 0, y: 0, width: 400, height: 400 }),
    frame("over", { x: 50, y: 50, width: 200, height: 200 }),
  ]);

  assert.equal(frameHolding(frames, { x: 60, y: 60, width: 50, height: 50 }), "over");
  /// Inside the big one only: the small one on top does not contain it.
  assert.equal(frameHolding(frames, { x: 300, y: 300, width: 50, height: 50 }), "under");
});

/// The contract between the drop and the frame: a batch dropped over a section
/// joins it, and the membership survives the filter every scene is stored
/// through — otherwise a photo would belong to a frame until the next reload.
test("a dropped batch lands in the frame it was dropped on, and stays there", () => {
  const frames = boardFrames([frame("act-one", { x: 0, y: 0, width: 2000, height: 2000 })]);
  const images = droppedImages(
    [
      { referenceId: "one", width: 1600, height: 900 },
      { referenceId: "two", width: 900, height: 1600 },
    ],
    { x: 1000, y: 1000 },
  );

  const elements = images.map((image, index) => ({
    ...image,
    id: `e${index}`,
    frameId: frameHolding(frames, image),
  }));
  assert.deepEqual(
    elements.map((element) => element.frameId),
    ["act-one", "act-one"],
  );

  const stored = persistableElements(elements);
  assert.deepEqual(
    stored.map((element) => element.frameId),
    ["act-one", "act-one"],
  );
});
