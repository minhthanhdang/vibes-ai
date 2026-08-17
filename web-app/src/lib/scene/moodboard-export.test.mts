import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_EXPORT_FORMATS,
  BOARD_EXPORT_SCALES,
  DEFAULT_BOARD_EXPORT,
  boardExportElements,
  boardExportFileName,
  exportPixelRatio,
  exportedFrame,
  exportedPageName,
  hasExportableSelection,
} from "@/lib/scene/moodboard-export";
import { pageCustomData } from "@/lib/pages/board-pages";
import { pageExportElements } from "@/lib/pages/page-picture";
import { BOARD_IMAGE_PIXEL_RATIO, sceneImageVariants } from "@/lib/scene/moodboard-resolution";
import { DROPPED_IMAGE_MAX_EDGE, droppedImages } from "@/lib/canvas/moodboard-drop";
import { referenceFileId } from "@/lib/scene/moodboard-scene";

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

test("a board's title becomes a file name a user can find again", () => {
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

type BoardElement = {
  id: string;
  type: string;
  name?: string;
  fileId?: string;
  frameId: string | null;
  customData?: unknown;
  isDeleted: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

const page = (overrides: Partial<BoardElement> = {}): BoardElement => ({
  id: "pg_1",
  type: "frame",
  name: "Act two",
  frameId: null,
  customData: pageCustomData(1920, 1080),
  isDeleted: false,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  ...overrides,
});

const photo = (overrides: Partial<BoardElement> = {}): BoardElement => ({
  id: "el_1",
  type: "image",
  fileId: "ref:ref_1",
  frameId: null,
  isDeleted: false,
  x: 100,
  y: 100,
  width: 320,
  height: 213,
  ...overrides,
});

/// §V.3, and the reason a page cannot be exported the way a section is: a photo
/// is on a page because of where it sits, not because a `frameId` says so — one
/// dropped on the page, one dragged over from the page beside it and one the
/// tidy has never touched are all on it, and all of them were left out of the
/// file while the page brief, the page's own picture and every page read
/// described them as being there.
test("selecting a page exports what is on it whatever its frameId says", () => {
  const elements = [
    page(),
    photo({ id: "el_dropped", frameId: null }),
    photo({ id: "el_dragged_over", x: 900, frameId: "pg_2" }),
    photo({ id: "el_owned", x: 1400, frameId: "pg_1" }),
    photo({ id: "el_beside_it", x: 3000 }),
  ];

  assert.deepEqual(
    boardExportElements(elements, selected("pg_1"), true).map((each) => each.id),
    ["pg_1", "el_dropped", "el_dragged_over", "el_owned"],
  );
});

/// The other half of the same rule: excalidraw draws a frame's picture from what
/// overlaps it *and* is owned by nobody else, so the two photos above reach the
/// file only once the copy handed to the exporter says the page owns them.
test("what is on the page is handed to the exporter as the page's own", () => {
  const elements = [
    page(),
    photo({ id: "el_dropped" }),
    photo({ id: "el_dragged_over", x: 900, frameId: "pg_2" }),
  ];
  const chosen = boardExportElements(elements, selected("pg_1"), true);

  assert.deepEqual(
    pageExportElements(chosen, {
      id: "pg_1",
      name: "Act two",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      preset: "LANDSCAPE_HD",
      createdAs: "LANDSCAPE_HD",
    }).map((each) => [each.id, each.frameId]),
    [
      ["pg_1", null],
      ["el_dropped", "pg_1"],
      ["el_dragged_over", "pg_1"],
    ],
  );
});

/// §V: one page is one picture. Excalidraw's own export dialog reads a single
/// selected frame as "the file is this rectangle" — no padding, no outline, no
/// name label — and this board replaced that dialog without carrying the rule
/// across, so exporting a page produced a labelled rectangle floating in 24px of
/// board instead of the page.
test("a page selected on its own is the rectangle the file is of", () => {
  const elements = [page(), photo({ id: "el_1" })];

  assert.equal(exportedFrame(elements, selected("pg_1"), true)?.id, "pg_1");
  assert.equal(exportedFrame(elements, selected("el_1"), true), null);
  assert.equal(exportedFrame(elements, selected("pg_1"), false), null);
});

/// A page picked together with something somewhere else on the canvas is a
/// user asking for both, and the honest answer to that is the box they
/// framed rather than one of the two things in it.
test("a page selected with something beside it is not a page export", () => {
  const elements = [page(), photo({ id: "el_1", x: 3000 })];
  assert.equal(exportedFrame(elements, selected("pg_1", "el_1"), true), null);
});

/// The rule is excalidraw's own and predates pages: a section exported on its
/// own comes out as the section, which is what "selecting one exports the
/// section" has meant all along.
test("a section selected on its own is a rectangle too", () => {
  const elements = [page({ id: "sec_1", name: "Act one", customData: undefined }), photo()];
  assert.equal(exportedFrame(elements, selected("sec_1"), true)?.id, "sec_1");
});

/// What the export's own toggle says. "Only the 1 selected" is a true sentence
/// about a page and the wrong offer: the file is the page, not a corner of the
/// board with the page in it.
test("the export offers the page by the user's own word for it", () => {
  const elements = [page(), photo({ id: "el_1" })];

  assert.equal(exportedPageName(elements, selected("pg_1")), "Act two");
  assert.equal(exportedPageName([page({ name: "" }), photo()], selected("pg_1")), "");
  assert.equal(exportedPageName(elements, selected("el_1")), null);
  assert.equal(
    exportedPageName([page({ id: "sec_1", customData: undefined })], selected("sec_1")),
    null,
  );
});

test("a page carries its own name into the file it exports to", () => {
  assert.equal(boardExportFileName("Cold open", "png", "Act two"), "cold-open-act-two.png");
  assert.equal(boardExportFileName("Cold open", "png", ""), "cold-open.png");
  assert.equal(boardExportFileName("", "png", "Act two"), "act-two.png");
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
