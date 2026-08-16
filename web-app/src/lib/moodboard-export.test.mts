import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_EXPORT_FORMATS,
  BOARD_EXPORT_SCALES,
  DEFAULT_BOARD_EXPORT,
  boardExportElements,
  boardExportFileName,
  exportPixelRatio,
  hasExportableSelection,
} from "./moodboard-export";
import { BOARD_IMAGE_PIXEL_RATIO, sceneImageVariants } from "./moodboard-resolution";
import { DROPPED_IMAGE_MAX_EDGE, droppedImages } from "./moodboard-drop";
import { referenceFileId } from "./moodboard-scene";

const element = (overrides: Record<string, unknown> = {}) => ({
  id: "el_1",
  type: "image",
  fileId: "ref:ref_1",
  frameId: null,
  isDeleted: false,
  width: 320,
  height: 213,
  ...overrides,
});

const selected = (...ids: string[]) => ({
  selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
});

test("a board's title becomes a file name a director can find again", () => {
  assert.equal(boardExportFileName("Act two — the cold half", "png"), "act-two-the-cold-half.png");
  assert.equal(boardExportFileName("Act two", "svg"), "act-two.svg");
});

/// A title in any script is still a title. Stripping to ASCII would send every
/// board named in Vietnamese, Japanese or Arabic to the same generic name.
test("a title outside the latin alphabet survives the file name", () => {
  assert.equal(boardExportFileName("Cảnh mở đầu", "png"), "cảnh-mở-đầu.png");
});

test("a board with no usable name still exports to something", () => {
  assert.equal(boardExportFileName("   ", "png"), "moodboard.png");
  assert.equal(boardExportFileName("···", "png"), "moodboard.png");
  assert.equal(boardExportFileName(undefined, "png"), "moodboard.png");
});

test("a long title is cut without leaving the separator dangling", () => {
  const name = boardExportFileName("x".repeat(200), "png");
  assert.equal(name, `${"x".repeat(80)}.png`);
  assert.ok(!boardExportFileName(`${"a".repeat(80)} tail`, "png").includes("-."));
});

test("the whole board is everything that is not a tombstone", () => {
  const elements = [element(), element({ id: "el_2" }), element({ id: "el_3", isDeleted: true })];
  assert.deepEqual(
    boardExportElements(elements, selected("el_1"), false).map((each) => each.id),
    ["el_1", "el_2"],
  );
});

test("only-selected exports what is selected", () => {
  const elements = [element(), element({ id: "el_2" })];
  assert.deepEqual(
    boardExportElements(elements, selected("el_2"), true).map((each) => each.id),
    ["el_2"],
  );
});

/// Selecting a frame is selecting the section, which is the whole point of
/// having drawn one — without this, exporting a selected frame produces a
/// labelled outline with none of its photos in it.
test("selecting a frame exports the photos inside it", () => {
  const elements = [
    element({ id: "frame_1", type: "frame", fileId: undefined }),
    element({ id: "el_1", frameId: "frame_1" }),
    element({ id: "el_2", frameId: null }),
  ];
  assert.deepEqual(
    boardExportElements(elements, selected("frame_1"), true).map((each) => each.id),
    ["frame_1", "el_1"],
  );
});

/// The setting outlives the selection it was made about, and an export of
/// nothing is never the request — the board is the honest fallback.
test("only-selected with nothing selected falls back to the whole board", () => {
  const elements = [element(), element({ id: "el_2" })];
  assert.equal(boardExportElements(elements, selected(), true).length, 2);
  assert.equal(hasExportableSelection(elements, selected()), false);
  assert.equal(hasExportableSelection(elements, selected("el_1")), true);
});

/// Excalidraw leaves `false` entries behind rather than deleting keys, so a
/// deselected element reads as selected to anything counting keys alone.
test("a deselected element is not part of the selection", () => {
  const elements = [element()];
  const appState = { selectedElementIds: { el_1: false } };
  assert.equal(hasExportableSelection(elements, appState), false);
  assert.equal(boardExportElements(elements, appState, true).length, 1);
});

/// The defect this module exists for: the board's file map is built at the
/// display's pixel ratio, and an export at 3× draws every scene unit as three
/// pixels — so the copy that is exactly enough on screen is upscaled by half
/// again in the file, and nothing on the board says so.
test("an export past the board's own pixel ratio asks for the original", () => {
  const board = [element({ width: DROPPED_IMAGE_MAX_EDGE, height: 213 })];

  assert.equal(sceneImageVariants(board).get("ref_1"), "thumb");
  assert.equal(sceneImageVariants(board, exportPixelRatio({ scale: 1 })).get("ref_1"), "thumb");
  assert.equal(
    sceneImageVariants(board, exportPixelRatio({ scale: BOARD_IMAGE_PIXEL_RATIO })).get("ref_1"),
    "thumb",
  );
  assert.equal(sceneImageVariants(board, exportPixelRatio({ scale: 3 })).get("ref_1"), "full");
});

/// The link that cannot be seen by looking at the file: the export fetches by
/// reference id and excalidraw draws by `fileId`, so a photo dropped from the
/// sidebar has to come back as exactly the entry the exporter will look up.
test("a dropped photo is one the export knows how to fetch", () => {
  const images = droppedImages([{ referenceId: "ref_9", width: 4000, height: 3000 }], {
    x: 0,
    y: 0,
  });

  const variants = sceneImageVariants(
    images.map((image, index) => ({ ...image, id: `el_${index}` })),
    exportPixelRatio({ scale: 3 }),
  );

  assert.deepEqual([...variants.keys()], ["ref_9"]);
  assert.equal(referenceFileId("ref_9"), images[0]!.fileId);
});

test("the default export is the resolution the board is judged at", () => {
  assert.equal(DEFAULT_BOARD_EXPORT.scale, BOARD_IMAGE_PIXEL_RATIO);
  assert.ok(BOARD_EXPORT_SCALES.includes(DEFAULT_BOARD_EXPORT.scale));
  assert.equal(DEFAULT_BOARD_EXPORT.background, true);
  assert.equal(BOARD_EXPORT_FORMATS[DEFAULT_BOARD_EXPORT.format].extension, "png");
});
