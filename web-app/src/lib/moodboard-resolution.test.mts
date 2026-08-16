import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_IMAGE_PIXEL_RATIO,
  boardImageSourceEdge,
  boardImageVariant,
  sceneImageVariants,
} from "./moodboard-resolution";
import { DROPPED_IMAGE_MAX_EDGE, droppedImages } from "./moodboard-drop";
import { persistableElements, sceneFiles } from "./moodboard-scene";
import { THUMBNAIL_MAX_EDGE } from "./thumbnail";
import { referenceCanvasImagePath } from "@/server/references/display";

const image = (overrides: Record<string, unknown> = {}) => ({
  id: "el_1",
  type: "image",
  fileId: "ref:ref_1",
  width: 320,
  height: 213,
  ...overrides,
});

test("a photo drawn small enough is served the copy the upload already made", () => {
  assert.equal(boardImageVariant(image({ width: 320, height: 213 })), "thumb");
  assert.equal(boardImageSourceEdge(image({ width: 320, height: 213 })), 640);
});

test("a photo drawn larger than the thumbnail can fill is served the original", () => {
  assert.equal(boardImageVariant(image({ width: 900, height: 600 })), "full");
});

/// The boundary is where a served copy is *exactly* enough, not where it starts
/// being visibly short — an image scaled up by a pixel is a decision to load
/// twenty times the bytes.
test("the boundary is the thumbnail's own longest edge, at the display's pixel ratio", () => {
  const exact = THUMBNAIL_MAX_EDGE / BOARD_IMAGE_PIXEL_RATIO;
  assert.equal(boardImageVariant(image({ width: exact, height: exact })), "thumb");
  assert.equal(boardImageVariant(image({ width: exact + 1, height: exact })), "full");
});

test("geometry that cannot be read resolves to the original rather than to small", () => {
  for (const broken of [{ width: 0 }, { height: Number.NaN }, { width: "320" }, { height: -10 }]) {
    assert.equal(boardImageVariant(image(broken)), "full");
  }
});

/// A crop is the case where a thumbnail is most visibly wrong: the element is
/// small on the board but the pixels come from a fraction of the frame, so the
/// source has to be that much larger.
test("a cropped photo is sized by the region it shows, not by the element", () => {
  const cropped = image({
    width: 320,
    height: 213,
    crop: { x: 0, y: 0, width: 557, height: 371, naturalWidth: 5568, naturalHeight: 3712 },
  });
  assert.equal(boardImageVariant(cropped), "full");

  const wholeFrame = image({
    width: 320,
    height: 213,
    crop: { x: 0, y: 0, width: 5568, height: 3712, naturalWidth: 5568, naturalHeight: 3712 },
  });
  assert.equal(boardImageVariant(wholeFrame), "thumb");
});

test("a crop missing its natural size falls back to the element's own size", () => {
  const element = image({ crop: { x: 0, y: 0, width: 557, height: 371 } });
  assert.equal(boardImageVariant(element), "thumb");
});

/// One reference is one file entry, so the element that needs the most wins —
/// excalidraw keys both its files map and its decoded-image cache on the
/// `fileId`, and there is no way to hold two resolutions of one photo.
test("a reference shown twice is served what its largest element needs", () => {
  const variants = sceneImageVariants(
    persistableElements([
      image({ id: "a", fileId: "ref:ref_1", width: 320, height: 213 }),
      image({ id: "b", fileId: "ref:ref_1", width: 1800, height: 1200 }),
      image({ id: "c", fileId: "ref:ref_2", width: 320, height: 213 }),
    ]),
  );
  assert.deepEqual([...variants], [
    ["ref_1", "full"],
    ["ref_2", "thumb"],
  ]);
});

test("elements that are not reference images are not asked about", () => {
  const variants = sceneImageVariants(
    persistableElements([
      { id: "a", type: "rectangle", width: 4000, height: 4000 },
      image({ id: "b", fileId: "sha256hash", width: 4000, height: 4000 }),
      image({ id: "c", fileId: "ref:ref_1" }),
    ]),
  );
  assert.deepEqual([...variants.keys()], ["ref_1"]);
});

/// The link that cannot be seen by looking at the board: a photo dropped from
/// the sidebar and the same photo after a reload have to resolve to the *same*
/// URL, or every board open downloads each image twice — once as whatever the
/// drop asked for and once as whatever the load asks for.
test("a dropped photo and the reloaded one ask for the same copy", () => {
  const [dropped] = droppedImages(
    [{ referenceId: "ref_1", width: 5568, height: 3712 }],
    { x: 0, y: 0 },
  );
  assert.ok(dropped);

  const stored = persistableElements([{ id: "el_1", ...dropped }]);
  const [file] = sceneFiles(
    [
      {
        id: "ref_1",
        gcsUri: "gs://bucket/projects/p1/references/one.jpg",
        thumbGcsUri: "gs://bucket/projects/p1/references/one-thumb.jpg",
        createdAt: new Date(0),
      },
    ],
    sceneImageVariants(stored),
  );

  const droppedVariant = boardImageVariant(dropped) === "thumb" ? "thumb" : undefined;
  assert.equal(file?.dataURL, referenceCanvasImagePath("ref_1", droppedVariant));
});

/// The whole point of the rule: the size a drop lands at is inside what the
/// upload's thumbnail can fill, so building a board never pulls an original.
test("a photo dropped at board size never needs the original", () => {
  assert.ok(DROPPED_IMAGE_MAX_EDGE * BOARD_IMAGE_PIXEL_RATIO <= THUMBNAIL_MAX_EDGE);
  const [dropped] = droppedImages([{ referenceId: "ref_1", width: 8, height: 8 }], { x: 0, y: 0 });
  assert.equal(boardImageVariant(dropped!), "thumb");
});
