import { test } from "node:test";
import assert from "node:assert/strict";

import { ADD_BOARD, DISCARD_BOARD, DISCARD_PAGE, DUPLICATE_BOARD, DUPLICATE_PAGE, GET_BOARD_BRIEF, INSPECT_BOARD, LIST_BOARDS, MOVE_LIMIT, MOVE_TO_PAGE, RESIZE_PAGE, REWORD_ON_BOARD, SWAP_ON_BOARD, addBoardFor } from "@/lib/agent/orchestrator/board-tools";
import { PAGE_PRESET_IDS } from "@/lib/layout/moodboard-layouts";

test("list_boards takes nothing, and says it is the cheap way to name a board", () => {
  assert.equal(LIST_BOARDS.name, "list_boards");
  assert.deepEqual(Object.keys(LIST_BOARDS.parameters.properties as object), []);
  assert.match(LIST_BOARDS.description, /only the board the user has open/);
  assert.match(LIST_BOARDS.description, /inspect_board is the answer to what is on one/);
  assert.match(LIST_BOARDS.description, /however many that is/);
});

test("get_board_brief takes one board and says what it is not for", () => {
  assert.equal(GET_BOARD_BRIEF.name, "get_board_brief");
  assert.deepEqual(GET_BOARD_BRIEF.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(GET_BOARD_BRIEF.parameters.properties as object), ["boardId"]);
  assert.match(GET_BOARD_BRIEF.description, /the same line your instructions carry/);
  assert.match(
    GET_BOARD_BRIEF.description,
    /call inspect_board instead when the question is what is on it/,
  );
  assert.match(
    (GET_BOARD_BRIEF.parameters.properties as Record<string, { description: string }>).boardId!
      .description,
    /list_boards/,
  );
});

test("inspect_board takes a board, and one page of it at most", () => {
  assert.equal(INSPECT_BOARD.name, "inspect_board");
  assert.deepEqual(INSPECT_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(INSPECT_BOARD.parameters.properties as object), [
    "boardId",
    "pageId",
  ]);
  assert.match(INSPECT_BOARD.description, /never rebuild a board/);
  assert.match(INSPECT_BOARD.description, /without a pageId/);
});

test("duplicate_board takes a board, and says what it is for before it is called", () => {
  assert.equal(DUPLICATE_BOARD.name, "duplicate_board");
  assert.deepEqual(DUPLICATE_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(DUPLICATE_BOARD.parameters.properties as object), [
    "boardId",
    "title",
  ]);
  assert.match(DUPLICATE_BOARD.description, /leave the original untouched/);
  assert.match(DUPLICATE_BOARD.description, /then change the copy/);
});

test("duplicate_page says which of the three copies it is, before it is called", () => {
  assert.equal(DUPLICATE_PAGE.name, "duplicate_page");
  assert.deepEqual(DUPLICATE_PAGE.parameters.required, ["boardId", "pageId"]);
  assert.deepEqual(Object.keys(DUPLICATE_PAGE.parameters.properties as object), [
    "boardId",
    "pageId",
    "name",
  ]);
  assert.match(DUPLICATE_PAGE.description, /then design the copy/);
  assert.match(DUPLICATE_PAGE.description, /Do not use duplicate_board/);
  assert.match(DUPLICATE_PAGE.description, /newPage/);
});

test("resize_page offers the three page shapes and says what it is instead of", () => {
  assert.equal(RESIZE_PAGE.name, "resize_page");
  assert.deepEqual(RESIZE_PAGE.parameters.required, ["boardId", "pageId", "preset"]);
  assert.deepEqual(Object.keys(RESIZE_PAGE.parameters.properties as object), [
    "boardId",
    "pageId",
    "preset",
  ]);
  const preset = (RESIZE_PAGE.parameters.properties as { preset: { enum: string[] } }).preset;
  assert.deepEqual(preset.enum, ["LANDSCAPE_HD", "PORTRAIT_HD", "SQUARE"]);
  assert.match(RESIZE_PAGE.description, /lay nothing out again/);
  assert.match(RESIZE_PAGE.description, /design_page would decide the whole page again/);
  assert.match(RESIZE_PAGE.description, /a page made smaller leaves pictures beside it/);
  assert.match(RESIZE_PAGE.description, /a page made larger takes in whatever it now covers/);
});

test("discard_board offers rather than deletes, and says so before it is called", () => {
  assert.equal(DISCARD_BOARD.name, "discard_board");
  assert.deepEqual(DISCARD_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(DISCARD_BOARD.parameters.properties as object), ["boardId"]);
  assert.match(DISCARD_BOARD.description, /This deletes nothing/);
  assert.match(DISCARD_BOARD.description, /never that the board is gone/);
  assert.match(DISCARD_BOARD.description, /Offer only the board they named/);
  assert.match(DISCARD_BOARD.description, /takes none of its photographs out of the gallery/);
});

test("discard_page takes a page rather than the board, and says which is which", () => {
  assert.equal(DISCARD_PAGE.name, "discard_page");
  assert.deepEqual(DISCARD_PAGE.parameters.required, ["boardId", "pageId"]);
  assert.deepEqual(Object.keys(DISCARD_PAGE.parameters.properties as object), [
    "boardId",
    "pageId",
  ]);
  assert.match(DISCARD_PAGE.description, /this deletes nothing/);
  assert.match(DISCARD_PAGE.description, /never that the page is gone/);
  assert.match(DISCARD_PAGE.description, /Offer only the page they named/);
  assert.match(DISCARD_PAGE.description, /photographs standing on that page come off the board/);
  assert.match(DISCARD_PAGE.description, /takes none of its photographs out of the gallery/);
  assert.match(DISCARD_PAGE.description, /Use discard_board instead when they want the whole board/);
  assert.match(DISCARD_BOARD.description, /Offer only the board they named/);
});

test("move_to_page names both pages and says why it is not a swap", () => {
  assert.equal(MOVE_TO_PAGE.name, "move_to_page");
  assert.deepEqual(MOVE_TO_PAGE.parameters.required, [
    "boardId",
    "fromPageId",
    "toPageId",
    "referenceIds",
  ]);
  assert.deepEqual(Object.keys(MOVE_TO_PAGE.parameters.properties as object), [
    "boardId",
    "fromPageId",
    "toPageId",
    "referenceIds",
  ]);
  assert.match(MOVE_TO_PAGE.description, /holds each of them once/);
  assert.match(MOVE_TO_PAGE.description, /Do not use swap_on_board for it/);
  assert.match(MOVE_TO_PAGE.description, /carrying it twice/);
  assert.match(MOVE_TO_PAGE.description, /prefer it over design_page/);
  assert.match(MOVE_TO_PAGE.description, new RegExp(`At most ${MOVE_LIMIT} pictures a call`));
});

test("swap_on_board asks for the pair rather than for two lists", () => {
  assert.equal(SWAP_ON_BOARD.name, "swap_on_board");
  assert.deepEqual(SWAP_ON_BOARD.parameters.required, ["boardId", "swaps"]);

  const properties = SWAP_ON_BOARD.parameters.properties as Record<
    string,
    { items?: { properties?: object; required?: string[] } }
  >;
  assert.deepEqual(Object.keys(properties.swaps!.items!.properties!), ["takeOff", "putOn"]);
  assert.deepEqual(properties.swaps!.items!.required, ["takeOff", "putOn"]);
  assert.match(SWAP_ON_BOARD.description, /prefer it over design_page/);
});

test("reword_on_board asks for the pair, and routes the other two text edits away", () => {
  assert.equal(REWORD_ON_BOARD.name, "reword_on_board");
  assert.deepEqual(REWORD_ON_BOARD.parameters.required, ["boardId", "rewordings"]);

  const properties = REWORD_ON_BOARD.parameters.properties as Record<
    string,
    { items?: { properties?: object; required?: string[] } }
  >;
  assert.deepEqual(Object.keys(properties.rewordings!.items!.properties!), ["from", "to"]);
  assert.deepEqual(properties.rewordings!.items!.required, ["from", "to"]);
  assert.match(REWORD_ON_BOARD.description, /prefer it over design_page/);
  assert.match(REWORD_ON_BOARD.description, /put_on_canvas to add a line the board does not carry/);
  assert.match(REWORD_ON_BOARD.description, /remove_from_canvas to take one off/);
});

test("add_board asks for nothing and decides nothing", () => {
  assert.equal(ADD_BOARD.name, "add_board");
  assert.equal(ADD_BOARD.parameters.required, undefined);
  assert.deepEqual(Object.keys(ADD_BOARD.parameters.properties as object), [
    "title",
    "preset",
    "pageName",
  ]);

  assert.match(ADD_BOARD.description, /makes no model call, chooses no picture/);
  assert.match(ADD_BOARD.description, /then call design_page/);
  assert.match(ADD_BOARD.description, /Both in the same turn/);
});

test("add_board offers the three page shapes the app has, and no others", () => {
  const preset = (ADD_BOARD.parameters.properties as Record<string, { enum?: string[] }>).preset!;
  assert.deepEqual(preset.enum, [...PAGE_PRESET_IDS]);
  const said = (RESIZE_PAGE.parameters.properties as Record<string, { enum?: string[] }>).preset!;
  assert.deepEqual(preset.enum, said.enum);
});

test("add_board routes away from itself only where there is a board to copy", () => {
  const first = addBoardFor({ photographs: 3, crops: 0, boards: 0 }).description;
  assert.ok(!first.includes("duplicate_board"));
  assert.ok(!first.includes("newPage"));

  const another = addBoardFor({ photographs: 3, crops: 0, boards: 1 }).description;
  assert.match(another, /Use duplicate_board instead/);
  assert.match(another, /design_page with newPage/);
});
