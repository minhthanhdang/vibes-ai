import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CROP_TITLE_LIMIT,
  cropOutputType,
  cropRegion,
  croppablePhotos,
  croppedPixels,
  croppedReferenceTitle,
  croppingElementId,
} from "@/lib/canvas/moodboard-crop";
import { boardImageVariant } from "@/lib/scene/moodboard-resolution";
import { persistableElements, referenceFileId, sceneReferenceIds } from "@/lib/scene/moodboard-scene";
import { THUMBNAIL_MAX_EDGE } from "@/lib/intake/thumbnail";

function image(overrides: Record<string, unknown> = {}) {
  return {
    id: "photo",
    type: "image",
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    fileId: referenceFileId("ref-1"),
    ...overrides,
  };
}

function crop(overrides: Record<string, unknown> = {}) {
  return {
    x: 0,
    y: 0,
    width: 5568,
    height: 3712,
    naturalWidth: 5568,
    naturalHeight: 3712,
    ...overrides,
  };
}

test("a crop is read as fractions of its source, not as pixels of it", () => {
  const region = cropRegion(
    image({ crop: crop({ x: 1392, y: 928, width: 2784, height: 1856 }) }),
  );

  assert.deepEqual(region, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
});

test("the same crop read off a thumbnail and off the original is the same region", () => {
  /// §II.6 serves the board a 640px copy whenever it is enough, so the editor's
  /// `naturalWidth` is the size of whichever copy was loaded. Both readings have
  /// to name the same part of the photo, or a kept crop is cut in the wrong place.
  const fromOriginal = cropRegion(
    image({ crop: crop({ x: 1392, y: 928, width: 2784, height: 1856 }) }),
  );
  const fromThumbnail = cropRegion(
    image({
      crop: crop({ x: 160, y: 106.67, width: 320, height: 213.33, naturalWidth: 640, naturalHeight: 426.67 }),
    }),
  );

  assert.ok(fromOriginal && fromThumbnail);
  for (const key of ["x", "y", "width", "height"] as const) {
    assert.ok(Math.abs(fromOriginal[key] - fromThumbnail[key]) < 1e-3, key);
  }
});

test("an element showing its whole frame is not a crop, however it got there", () => {
  assert.equal(cropRegion(image()), null);
  assert.equal(cropRegion(image({ crop: null })), null);
  /// Dragged out to the full frame again: excalidraw leaves the object behind.
  assert.equal(cropRegion(image({ crop: crop() })), null);
  /// A sub-pixel difference on a 5568px source is not a crop either.
  assert.equal(cropRegion(image({ crop: crop({ width: 5566, height: 3711 }) })), null);
});

test("unreadable crop geometry reads as no crop rather than as some crop", () => {
  assert.equal(cropRegion(image({ crop: crop({ naturalWidth: 0 }) })), null);
  assert.equal(cropRegion(image({ crop: crop({ width: Number.NaN }) })), null);
  assert.equal(cropRegion(image({ crop: crop({ x: "12" }) })), null);
  assert.equal(cropRegion(image({ crop: [] })), null);
  assert.equal(cropRegion(null), null);
});

test("a region becomes whole pixels of the original, clamped inside it", () => {
  const region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  assert.deepEqual(croppedPixels(region, { width: 5568, height: 3712 }), {
    x: 1392,
    y: 928,
    width: 2784,
    height: 1856,
  });

  /// A region that rounds past the edge is cut at it rather than asking for
  /// pixels the source does not have.
  assert.deepEqual(croppedPixels({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, { width: 100, height: 100 }), {
    x: 90,
    y: 90,
    width: 10,
    height: 10,
  });

  /// A sliver still has to be an image.
  const sliver = croppedPixels({ x: 0, y: 0, width: 0.0001, height: 0.0001 }, { width: 100, height: 100 });
  assert.deepEqual(sliver, { x: 0, y: 0, width: 1, height: 1 });
});

test("a kept crop is named after the frame it came out of, and cropping a crop counts up", () => {
  assert.equal(croppedReferenceTitle("Hallway, night"), "Hallway, night (crop)");
  assert.equal(croppedReferenceTitle("Hallway, night (crop)"), "Hallway, night (crop 2)");
  assert.equal(croppedReferenceTitle("Hallway, night (crop 2)"), "Hallway, night (crop 3)");
  assert.equal(croppedReferenceTitle("   "), "Reference (crop)");

  /// The base is what gets cut, so the name still says what it is.
  const long = croppedReferenceTitle("x".repeat(400));
  assert.equal(long.length, CROP_TITLE_LIMIT);
  assert.ok(long.endsWith(" (crop)"));
});

test("the crop is encoded as a still, and a transparent source stays one", () => {
  assert.equal(cropOutputType("image/png"), "image/png");
  assert.equal(cropOutputType("image/jpeg"), "image/jpeg");
  assert.equal(cropOutputType("image/webp"), "image/jpeg");
  /// A crop of an animation is a frame of it.
  assert.equal(cropOutputType("image/gif"), "image/jpeg");
  assert.equal(cropOutputType("IMAGE/PNG; charset=binary"), "image/png");
  assert.equal(cropOutputType("application/octet-stream"), "image/jpeg");
});

test("what can be kept is a selected, unlocked, cropped photo of this project", () => {
  const cropped = crop({ x: 1392, y: 928, width: 2784, height: 1856 });
  const elements = [
    image({ id: "a", crop: cropped }),
    image({ id: "b" }),
    image({ id: "c", crop: cropped, locked: true }),
    image({ id: "d", crop: cropped, isDeleted: true }),
    /// Excalidraw's own bytes: adoption has to make it a reference first.
    image({ id: "e", crop: cropped, fileId: "0f9c2b" }),
    { id: "f", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
    /// Cropped but not selected.
    image({ id: "g", crop: cropped }),
  ];
  const appState = {
    selectedElementIds: { a: true, b: true, c: true, d: true, e: true, f: true, g: false },
  };

  assert.deepEqual(
    croppablePhotos(elements, appState).map((photo) => photo.elementId),
    ["a"],
  );
  assert.deepEqual(croppablePhotos(elements, { selectedElementIds: {} }), []);
  assert.deepEqual(croppablePhotos(elements, {}), []);
});

test("the offer follows crop mode, which the selection alone cannot see", () => {
  assert.equal(croppingElementId({ croppingElementId: "photo" }), "photo");
  assert.equal(croppingElementId({ croppingElementId: null }), "");
  assert.equal(croppingElementId({}), "");
  assert.equal(croppingElementId(null), "");
});

test("contract: a kept crop's element is an ordinary reference image again", () => {
  const kept = image({ crop: null, fileId: referenceFileId("ref-crop") });
  const stored = persistableElements([kept]);

  assert.deepEqual(sceneReferenceIds(stored), ["ref-crop"]);
  assert.deepEqual(croppablePhotos(stored, { selectedElementIds: { photo: true } }), []);
});

test("contract: keeping a crop is what stops the board loading the whole photograph", () => {
  /// A window onto a tenth of a photo needs ten times the source resolution, so a
  /// cropped element pulls the original however small it is on the board. The
  /// same element repointed at the crop itself is an ordinary 320-unit tile.
  const before = image({ crop: crop({ x: 0, y: 0, width: 557, height: 371 }) });
  assert.equal(boardImageVariant(before), "full");

  const after = image({ crop: null, fileId: referenceFileId("ref-crop") });
  assert.equal(boardImageVariant(after), "thumb");

  /// And what "thumb" now answers with is the crop and not the photograph: a
  /// tenth of a 5568px frame is 557px, already inside the box, so the kept row
  /// needs no thumbnail of its own and the board is served it whole.
  const pixels = croppedPixels({ x: 0, y: 0, width: 0.1, height: 0.1 }, { width: 5568, height: 3712 });
  assert.deepEqual(pixels, { x: 0, y: 0, width: 557, height: 371 });
  assert.ok(Math.max(pixels.width, pixels.height) <= THUMBNAIL_MAX_EDGE);
});
