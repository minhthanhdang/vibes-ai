import { test } from "node:test";
import assert from "node:assert/strict";

import {
  pageExportElements,
  pagesToPicture,
  pictureIsOfStoredScene,
} from "@/lib/pages/page-picture";
import type { BoardPage } from "@/lib/pages/board-pages";

function choice(boardId: string, pageId: string) {
  return { boardId, pageId, revision: 4, name: pageId };
}

function page(over: Partial<BoardPage> = {}): BoardPage {
  return {
    id: "page_2",
    name: "Act two",
    x: 2000,
    y: 0,
    width: 1920,
    height: 1080,
    preset: "LANDSCAPE_HD",
    createdAs: "LANDSCAPE_HD",
    ...over,
  };
}

function photo(x: number, over: Partial<{ frameId: string | null }> = {}) {
  return { id: `image_${x}`, x, y: 100, width: 400, height: 300, frameId: null, ...over };
}

test("the pages of the board the tab is showing are the ones it can draw", () => {
  const picked = [choice("board_1", "page_1"), choice("board_2", "page_9")];
  assert.deepEqual(
    pagesToPicture(picked, "board_1").map((page) => page.pageId),
    ["page_1"],
  );
});

test("a page of a board nothing has open is not drawn, so it goes up as text alone", () => {
  assert.deepEqual(pagesToPicture([choice("board_2", "page_9")], "board_1"), []);
});

test("no board open at all is no picture rather than a picture of the wrong board", () => {
  assert.deepEqual(pagesToPicture([choice("board_1", "page_1")], null), []);
});

test("the picks keep the order they were picked in", () => {
  const picked = [choice("board_1", "page_2"), choice("board_1", "page_1")];
  assert.deepEqual(
    pagesToPicture(picked, "board_1").map((page) => page.pageId),
    ["page_2", "page_1"],
  );
});

test("a saved board is drawn", () => {
  assert.equal(pictureIsOfStoredScene("idle"), true);
});

test("a board with a save on its way is not drawn — its revision is about to move", () => {
  assert.equal(pictureIsOfStoredScene("pending"), false);
  assert.equal(pictureIsOfStoredScene("saving"), false);
});

test("a board whose save failed is not drawn: the revision has stopped while the canvas has not", () => {
  assert.equal(pictureIsOfStoredScene("error"), false);
  assert.equal(pictureIsOfStoredScene("conflict"), false);
});

test("a photograph on the page whose frameId still names another page is drawn with it", () => {
  const drawn = pageExportElements([photo(2100, { frameId: "page_1" })], page());
  assert.deepEqual(
    drawn.map((element) => element.frameId),
    ["page_2"],
  );
});

test("nothing is written back — the scene keeps the frameId the director's board has", () => {
  const scene = [photo(2100, { frameId: "page_1" })];
  pageExportElements(scene, page());
  assert.equal(scene[0]!.frameId, "page_1");
});

test("an element the page already owns is handed to the exporter as itself", () => {
  const scene = [photo(2100, { frameId: "page_2" })];
  assert.equal(pageExportElements(scene, page())[0], scene[0]);
});

test("an element on no page but sitting on this one is adopted for the export", () => {
  const drawn = pageExportElements([photo(2100)], page());
  assert.equal(drawn[0]!.frameId, "page_2");
});

test("an element off the page is left alone, whatever it says it belongs to", () => {
  const scene = [photo(100, { frameId: "page_1" }), photo(200)];
  assert.deepEqual(
    pageExportElements(scene, page()).map((element) => element.frameId),
    ["page_1", null],
  );
});

test("an element the page owns but that has been dragged off it keeps the page", () => {
  const scene = [photo(100, { frameId: "page_2" })];
  assert.equal(pageExportElements(scene, page())[0], scene[0]);
});

/// §V.1: a page cannot contain a section, because excalidraw does not nest
/// frames. The page frame itself is the case that happens on every export — its
/// own centre is inside its own rectangle — and handing the exporter a frame that
/// is its own child is a scene excalidraw has no rendering for.
test("the page frame itself is handed to the exporter as itself, never as its own child", () => {
  const frame = { id: "page_2", type: "frame", x: 2000, y: 0, width: 1920, height: 1080 };
  assert.equal(pageExportElements([frame], page())[0], frame);
});

test("a section the page was drawn over is not adopted for the export, but its pictures are", () => {
  const scene = [
    { id: "section_1", type: "frame", x: 2100, y: 100, width: 800, height: 600, frameId: null },
    { ...photo(2200), frameId: "section_1" },
  ];
  assert.deepEqual(
    pageExportElements(scene, page()).map((element) => element.frameId),
    /// The section is drawn anyway — a frame owned by nothing is picked up by the
    /// exporter's own overlap — and its photograph is adopted so the picture shows
    /// what the page read describes as being on the page.
    [null, "page_2"],
  );
});

test("membership is by centre, so a photograph mostly off the page is not adopted", () => {
  /// 400 wide at x=1750: its centre is at 1950, short of the page's own edge.
  const drawn = pageExportElements([photo(1750)], page());
  assert.equal(drawn[0]!.frameId, null);
});
