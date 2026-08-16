import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DROPPED_IMAGE_MAX_EDGE,
  REFERENCE_DRAG_MIME,
  carriesReferenceDrag,
  decodeReferenceDrag,
  droppedImage,
  droppedImageSize,
  encodeReferenceDrag,
  scenePointOfDrop,
} from "./moodboard-drop";
import { persistableElements, sceneFiles, sceneReferenceIds } from "./moodboard-scene";

const canvas = { offsetLeft: 0, offsetTop: 0, scrollX: 0, scrollY: 0, zoom: 1 };

test("a dragged reference survives the round trip through dataTransfer", () => {
  const payload = { referenceId: "ref_1", width: 1600, height: 900 };
  assert.deepEqual(decodeReferenceDrag(encodeReferenceDrag(payload)), payload);
});

test("a drag that is not ours reads as nothing", () => {
  for (const raw of ["", null, undefined, "not json", "[]", "7", '"ref_1"', "{}"]) {
    assert.equal(decodeReferenceDrag(raw), null, `${JSON.stringify(raw)} is not a reference drag`);
  }
});

/// The drag payload is written by the page, so a hand-built one must not be
/// able to put a blank id — or a NaN box — on the board.
test("a malformed payload is refused rather than repaired", () => {
  assert.equal(decodeReferenceDrag(JSON.stringify({ referenceId: "   " })), null);
  assert.equal(decodeReferenceDrag(JSON.stringify({ referenceId: 7 })), null);

  const odd = decodeReferenceDrag(
    JSON.stringify({ referenceId: " ref_1 ", width: "800", height: -3 }),
  );
  assert.deepEqual(odd, { referenceId: "ref_1", width: null, height: null });
});

test("dragover decides on the type list alone", () => {
  assert.equal(carriesReferenceDrag([REFERENCE_DRAG_MIME, "text/plain"]), true);
  assert.equal(carriesReferenceDrag(["Files"]), false);
  assert.equal(carriesReferenceDrag([]), false);
  assert.equal(carriesReferenceDrag(undefined), false);
});

test("a dropped image keeps its aspect ratio at board size", () => {
  assert.deepEqual(droppedImageSize(1600, 900), { width: 320, height: 180 });
  assert.deepEqual(droppedImageSize(900, 1600), { width: 180, height: 320 });
  assert.deepEqual(droppedImageSize(1000, 1000), { width: 320, height: 320 });
});

/// A thumbnail-sized reference and a 6000px one land the same size: the board
/// is about arrangement, and a drop sized to the source would be either
/// invisible or the whole canvas.
test("every reference lands at the same longest edge", () => {
  for (const [width, height] of [
    [40, 30],
    [6000, 4500],
    [1200, 900],
  ]) {
    const size = droppedImageSize(width, height);
    assert.equal(Math.max(size.width, size.height), DROPPED_IMAGE_MAX_EDGE);
    assert.equal(Math.round((size.width / size.height) * 100), Math.round((width / height) * 100));
  }
});

test("a reference with no stored dimensions lands square", () => {
  const square = { width: DROPPED_IMAGE_MAX_EDGE, height: DROPPED_IMAGE_MAX_EDGE };
  assert.deepEqual(droppedImageSize(null, null), square);
  assert.deepEqual(droppedImageSize(1600, null), square);
  assert.deepEqual(droppedImageSize(0, 0), square);
});

test("a drop at the canvas origin is the scene origin", () => {
  assert.deepEqual(scenePointOfDrop({ clientX: 0, clientY: 0 }, canvas), { x: 0, y: 0 });
});

/// The canvas is inset in the page and the director has scrolled and zoomed;
/// the image has to land under the cursor anyway.
test("a drop is placed through the canvas offset, scroll and zoom", () => {
  const point = scenePointOfDrop(
    { clientX: 500, clientY: 300 },
    { offsetLeft: 100, offsetTop: 50, scrollX: -200, scrollY: -100, zoom: 2 },
  );
  assert.deepEqual(point, { x: 400, y: 225 });
});

test("a zoom that is missing or nonsense places the drop unscaled", () => {
  for (const zoom of [0, Number.NaN, -1]) {
    assert.deepEqual(scenePointOfDrop({ clientX: 10, clientY: 20 }, { ...canvas, zoom }), {
      x: 10,
      y: 20,
    });
  }
});

test("the dropped image points at its reference and is centred on the cursor", () => {
  const element = droppedImage({ referenceId: "ref_1", width: 1600, height: 900 }, { x: 0, y: 0 });
  assert.deepEqual(element, {
    type: "image",
    fileId: "ref:ref_1",
    status: "saved",
    x: -160,
    y: -90,
    width: 320,
    height: 180,
  });
});

/// The whole point of the drop: what lands on the board is a pointer the
/// server can turn back into a signed URL. If these two ever disagree about
/// the `ref:` shape, a dropped photo reloads as an empty box.
test("a dropped reference reloads as the reference it was dragged from", () => {
  const element = { id: "el_1", ...droppedImage({ referenceId: "ref_1", width: 4, height: 3 }, { x: 0, y: 0 }) };
  const stored = persistableElements([element]);

  assert.deepEqual(sceneReferenceIds(stored), ["ref_1"]);
  const [file] = sceneFiles([
    { id: "ref_1", gcsUri: "gs://bucket/projects/p/ref_1.png", createdAt: new Date(0) },
  ]);
  assert.equal(file?.id, element.fileId);
  assert.equal(file?.dataURL, "/api/references/ref_1/image");
});
