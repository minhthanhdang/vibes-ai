import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DROPPED_IMAGE_GAP,
  DROPPED_IMAGE_MAX_EDGE,
  REFERENCE_DRAG_MIME,
  carriesReferenceDrag,
  decodeReferenceDrag,
  draggedReferenceIds,
  droppedImage,
  droppedImageGrid,
  droppedImageSize,
  droppedImages,
  encodeReferenceDrag,
  scenePointOfDrop,
  scenePointOfViewportCentre,
  toggledDragSelection,
} from "./moodboard-drop";
import { persistableElements, sceneFiles, sceneReferenceIds } from "./moodboard-scene";
import { referenceCanvasImagePath } from "@/server/references/display";

const canvas = { offsetLeft: 0, offsetTop: 0, scrollX: 0, scrollY: 0, zoom: 1 };

test("a dragged selection survives the round trip through dataTransfer", () => {
  const references = [
    { referenceId: "ref_1", width: 1600, height: 900 },
    { referenceId: "ref_2", width: null, height: null },
  ];
  assert.deepEqual(decodeReferenceDrag(encodeReferenceDrag(references)), references);
});

test("a drag that is not ours reads as nothing", () => {
  for (const raw of ["", null, undefined, "not json", "[]", "7", '"ref_1"', "{}"]) {
    assert.equal(decodeReferenceDrag(raw), null, `${JSON.stringify(raw)} is not a reference drag`);
  }
  assert.equal(decodeReferenceDrag(JSON.stringify({ references: [] })), null);
  assert.equal(decodeReferenceDrag(JSON.stringify({ references: "ref_1" })), null);
});

/// The drag payload is written by the page, so a hand-built one must not be
/// able to put a blank id — or a NaN box — on the board.
test("a malformed payload is refused rather than repaired", () => {
  assert.equal(decodeReferenceDrag(JSON.stringify({ references: [{ referenceId: "   " }] })), null);
  assert.equal(decodeReferenceDrag(JSON.stringify({ references: [{ referenceId: 7 }] })), null);

  const odd = decodeReferenceDrag(
    JSON.stringify({ references: [{ referenceId: " ref_1 ", width: "800", height: -3 }] }),
  );
  assert.deepEqual(odd, [{ referenceId: "ref_1", width: null, height: null }]);
});

/// One bad entry in a batch of six is not a reason to land nothing.
test("an unusable entry is dropped and the rest of the batch lands", () => {
  const decoded = decodeReferenceDrag(
    JSON.stringify({
      references: [
        { referenceId: "ref_1", width: 4, height: 3 },
        { referenceId: "" },
        null,
        { referenceId: "ref_1", width: 4, height: 3 },
        { referenceId: "ref_2", width: 4, height: 3 },
      ],
    }),
  );

  assert.deepEqual(decoded?.map((reference) => reference.referenceId), ["ref_1", "ref_2"]);
});

test("dragging a selected tile takes the selection, in the order it is shown", () => {
  const shown = ["ref_1", "ref_2", "ref_3", "ref_4"];
  assert.deepEqual(draggedReferenceIds(shown, ["ref_3", "ref_1"], "ref_3"), ["ref_1", "ref_3"]);
});

/// Dragging something outside the selection is not the moment to argue about
/// what is selected — it is a drag of the thing under the cursor.
test("dragging an unselected tile takes only that tile", () => {
  assert.deepEqual(draggedReferenceIds(["ref_1", "ref_2"], ["ref_2"], "ref_1"), ["ref_1"]);
  assert.deepEqual(draggedReferenceIds(["ref_1"], [], "ref_1"), ["ref_1"]);
});

/// A reference deleted from the gallery while it was selected must not drag
/// onto the board as a box pointing at a row that is gone.
test("a selected reference that is no longer shown does not drag", () => {
  assert.deepEqual(draggedReferenceIds(["ref_1"], ["ref_1", "ref_gone"], "ref_1"), ["ref_1"]);
});

test("the drag selection toggles and keeps the order it was built in", () => {
  assert.deepEqual(toggledDragSelection([], "ref_1"), ["ref_1"]);
  assert.deepEqual(toggledDragSelection(["ref_1"], "ref_2"), ["ref_1", "ref_2"]);
  assert.deepEqual(toggledDragSelection(["ref_1", "ref_2"], "ref_1"), ["ref_2"]);
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

/// Where a paste lands when the pointer is not on the board: the middle of the
/// view, which is the one point on the canvas that is certainly on screen.
test("the viewport centre is the middle of what the director is looking at", () => {
  assert.deepEqual(
    scenePointOfViewportCentre({
      width: 800,
      height: 600,
      offsetLeft: 100,
      offsetTop: 50,
      scrollX: -200,
      scrollY: -100,
      zoom: 2,
    }),
    { x: 400, y: 250 },
  );
  /// Unscrolled and unzoomed it is half the canvas, wherever the canvas sits in
  /// the page.
  assert.deepEqual(
    scenePointOfViewportCentre({ ...canvas, width: 800, height: 600, offsetLeft: 240 }),
    { x: 400, y: 300 },
  );
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

test("a batch is laid out as square a grid as its count allows", () => {
  assert.deepEqual(droppedImageGrid(1), { columns: 1, rows: 1 });
  assert.deepEqual(droppedImageGrid(2), { columns: 2, rows: 1 });
  assert.deepEqual(droppedImageGrid(3), { columns: 2, rows: 2 });
  assert.deepEqual(droppedImageGrid(4), { columns: 2, rows: 2 });
  assert.deepEqual(droppedImageGrid(7), { columns: 3, rows: 3 });
  assert.deepEqual(droppedImageGrid(0), { columns: 1, rows: 1 });
});

/// A drop of one is the drop that already existed — the batch is not a second
/// placement rule that the common case has to be kept in step with.
test("a batch of one lands exactly where a single reference would", () => {
  const reference = { referenceId: "ref_1", width: 1600, height: 900 };
  assert.deepEqual(droppedImages([reference], { x: 40, y: 20 }), [
    droppedImage(reference, { x: 40, y: 20 }),
  ]);
});

test("a batch is centred on the cursor and its images do not overlap", () => {
  const references = ["a", "b", "c", "d"].map((id) => ({
    referenceId: id,
    width: 1000,
    height: 1000,
  }));
  const images = droppedImages(references, { x: 0, y: 0 });

  const centres = images.map((image) => ({
    x: image.x + image.width / 2,
    y: image.y + image.height / 2,
  }));
  const cell = DROPPED_IMAGE_MAX_EDGE + DROPPED_IMAGE_GAP;
  assert.deepEqual(centres, [
    { x: -cell / 2, y: -cell / 2 },
    { x: cell / 2, y: -cell / 2 },
    { x: -cell / 2, y: cell / 2 },
    { x: cell / 2, y: cell / 2 },
  ]);

  for (const [index, image] of images.entries()) {
    for (const other of images.slice(index + 1)) {
      const apart =
        image.x + image.width <= other.x ||
        other.x + other.width <= image.x ||
        image.y + image.height <= other.y ||
        other.y + other.height <= image.y;
      assert.ok(apart, "two dropped images landed on top of each other");
    }
  }
});

/// Three photos read as three photos, not as a block with a corner missing.
test("a short last row is centred under the rows above it", () => {
  const references = ["a", "b", "c"].map((id) => ({ referenceId: id, width: 10, height: 10 }));
  const [, , last] = droppedImages(references, { x: 0, y: 0 });
  assert.equal(last!.x + last!.width / 2, 0);
});

/// Every image in a batch is still an image of its own reference, and still the
/// size a single drop would give it.
test("a batch keeps each reference's own aspect ratio", () => {
  const images = droppedImages(
    [
      { referenceId: "wide", width: 1600, height: 900 },
      { referenceId: "tall", width: 900, height: 1600 },
    ],
    { x: 0, y: 0 },
  );

  assert.deepEqual(
    images.map((image) => [image.fileId, image.width, image.height]),
    [
      ["ref:wide", 320, 180],
      ["ref:tall", 180, 320],
    ],
  );
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
  /// The streaming path, not the redirect one — the drop hands the editor this
  /// same URL, so a board is as exportable the moment a photo lands on it as it
  /// is after a reload.
  assert.equal(file?.dataURL, referenceCanvasImagePath("ref_1"));
});
