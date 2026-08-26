import { test } from "node:test";
import assert from "node:assert/strict";

import { ADD_BOARD, DISCARD_BOARD, DISCARD_PAGE, DUPLICATE_BOARD, DUPLICATE_PAGE, GET_BOARD_BRIEF, INSPECT_BOARD, LIST_BOARDS, MOVE_LIMIT, MOVE_TO_PAGE, RESIZE_PAGE, REWORD_ON_BOARD, SWAP_ON_BOARD, addBoardFor } from "@/lib/agent/orchestrator/board-tools";
import { PAGE_PRESET_IDS } from "@/lib/layout/moodboard-layouts";

/// The pair the priming's cap became. What has to be in the description is the
/// split from `inspect_board` — *which board was that* against *what is on it* —
/// because a model that reaches for the second to answer the first pays a scene
/// read for a line it could have had for a query.
test("list_boards takes nothing, and says it is the cheap way to name a board", () => {
  assert.equal(LIST_BOARDS.name, "list_boards");
  assert.deepEqual(Object.keys(LIST_BOARDS.parameters.properties as object), []);
  /// The whole point of the change behind it: the instruction names one board,
  /// so this is where every other id comes from.
  assert.match(LIST_BOARDS.description, /only the board the user has open/);
  assert.match(LIST_BOARDS.description, /inspect_board is the answer to what is on one/);
  /// And no cap said, because there is none — the answer carries the project.
  assert.match(LIST_BOARDS.description, /however many that is/);
});

test("get_board_brief takes one board and says what it is not for", () => {
  assert.equal(GET_BOARD_BRIEF.name, "get_board_brief");
  assert.deepEqual(GET_BOARD_BRIEF.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(GET_BOARD_BRIEF.parameters.properties as object), ["boardId"]);
  /// The same line the instruction carries, which is why nothing has to say
  /// which of the two the model is holding.
  assert.match(GET_BOARD_BRIEF.description, /the same line your instructions carry/);
  assert.match(
    GET_BOARD_BRIEF.description,
    /call inspect_board instead when the question is what is on it/,
  );
  /// Where an id comes from, said on the parameter: an id out of the
  /// conversation is the failure this tool exists to catch.
  assert.match(
    (GET_BOARD_BRIEF.parameters.properties as Record<string, { description: string }>).boardId!
      .description,
    /list_boards/,
  );
});

test("inspect_board takes a board, and one page of it at most", () => {
  assert.equal(INSPECT_BOARD.name, "inspect_board");
  /// The page is optional, and that is the whole of the read's story: a board
  /// with no pageId is the board, which is what every board made until pages
  /// existed still is.
  assert.deepEqual(INSPECT_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(INSPECT_BOARD.parameters.properties as object), [
    "boardId",
    "pageId",
  ]);
  /// The one tool whose description is about another tool: the call it exists to
  /// stop being made is a rebuild, and a ceiling written into a description is
  /// obeyed before the call rather than refused after it.
  assert.match(INSPECT_BOARD.description, /never rebuild a board/);
  /// Where a page id comes from, said in the declaration: the model cannot
  /// invent one, so the unscoped read has to be named as what hands them out.
  assert.match(INSPECT_BOARD.description, /without a pageId/);
});

test("duplicate_board takes a board, and says what it is for before it is called", () => {
  assert.equal(DUPLICATE_BOARD.name, "duplicate_board");
  assert.deepEqual(DUPLICATE_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(DUPLICATE_BOARD.parameters.properties as object), [
    "boardId",
    "title",
  ]);
  /// The routing is the whole point of the tool and it lives in the description,
  /// where it is obeyed before the call: every other board tool changes the board
  /// the user is looking at, so the copy has to be made *before* the change.
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
  /// The same routing `duplicate_board` carries, one level down — and the two
  /// calls it has to be told apart from, because both are reachable, neither
  /// errors, and each is wrong in a way the user finds out about later.
  assert.match(DUPLICATE_PAGE.description, /then design the copy/);
  assert.match(DUPLICATE_PAGE.description, /Do not use duplicate_board/);
  assert.match(DUPLICATE_PAGE.description, /newPage/);
});

/// "Resizing a page is allowed and changes nothing else": the shape and the
/// arrangement are two requests, and the model's only route to the first was a
/// call that answers with both.
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
  /// The routing is obeyed before the call: a compose at a template of another
  /// shape resizes the page too, and hands back an arrangement nobody asked for.
  assert.match(RESIZE_PAGE.description, /lay nothing out again/);
  assert.match(RESIZE_PAGE.description, /design_page would decide the whole page again/);
  /// The two consequences of writing a rectangle nothing else follows.
  assert.match(RESIZE_PAGE.description, /a page made smaller leaves pictures beside it/);
  assert.match(RESIZE_PAGE.description, /a page made larger takes in whatever it now covers/);
});

test("discard_board offers rather than deletes, and says so before it is called", () => {
  assert.equal(DISCARD_BOARD.name, "discard_board");
  assert.deepEqual(DISCARD_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(DISCARD_BOARD.parameters.properties as object), ["boardId"]);
  /// The whole tool is in its description, where it is obeyed before the call:
  /// it deletes nothing, the user presses the button, and a model that reads
  /// it as a deletion writes "I have deleted that board" over a board that is
  /// still there.
  assert.match(DISCARD_BOARD.description, /This deletes nothing/);
  assert.match(DISCARD_BOARD.description, /never that the board is gone/);
  /// And the ceiling that matters for an act nothing can undo: the board they
  /// named, not the ones it would be tidy to be rid of.
  assert.match(DISCARD_BOARD.description, /Offer only the board they named/);
  assert.match(DISCARD_BOARD.description, /takes none of its photographs out of the gallery/);
});

/// The two discards are a routing decision the model makes before it calls
/// either, and getting it wrong costs the user the pages they asked to keep.
/// Both descriptions carry the fork.
test("discard_page takes a page rather than the board, and says which is which", () => {
  assert.equal(DISCARD_PAGE.name, "discard_page");
  /// No default page to throw away: unlike every other page-scoped tool here, a
  /// missing pageId cannot fall back to the board's first page.
  assert.deepEqual(DISCARD_PAGE.parameters.required, ["boardId", "pageId"]);
  assert.deepEqual(Object.keys(DISCARD_PAGE.parameters.properties as object), [
    "boardId",
    "pageId",
  ]);
  assert.match(DISCARD_PAGE.description, /this deletes nothing/);
  assert.match(DISCARD_PAGE.description, /never that the page is gone/);
  assert.match(DISCARD_PAGE.description, /Offer only the page they named/);
  /// The two things the user hears differently from what the call does: the
  /// photographs on the page come off the board, and the gallery keeps them.
  assert.match(DISCARD_PAGE.description, /photographs standing on that page come off the board/);
  assert.match(DISCARD_PAGE.description, /takes none of its photographs out of the gallery/);
  /// And the fork itself, said in both directions.
  assert.match(DISCARD_PAGE.description, /Use discard_board instead when they want the whole board/);
  assert.match(DISCARD_BOARD.description, /Offer only the board they named/);
});

/// The call that carries a picture between the pages of one board. The
/// declaration has to say what it is *instead of*, because both
/// alternatives are calls the model already has and both are wrong in ways the
/// answer hides.
test("move_to_page names both pages and says why it is not a swap", () => {
  assert.equal(MOVE_TO_PAGE.name, "move_to_page");
  /// Neither end falls back: a picture is taken off a page and put on a page, and
  /// a default for either would be a page the user did not name.
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
  /// The guarantee: once on the board afterwards, which is the thing a swap
  /// cannot promise.
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
  /// Objects, not two arrays paired by position: a misaligned pair would put the
  /// wrong cut in the wrong place, and it would do it silently.
  assert.deepEqual(Object.keys(properties.swaps!.items!.properties!), ["takeOff", "putOn"]);
  assert.deepEqual(properties.swaps!.items!.required, ["takeOff", "putOn"]);
  /// The routing lives in the description, where it is obeyed before the call
  /// rather than refused after it — the call it exists to stop being made is a
  /// rebuild that reflows a board nobody asked to rearrange.
  assert.match(SWAP_ON_BOARD.description, /prefer it over design_page/);
});

test("reword_on_board asks for the pair, and routes the other two text edits away", () => {
  assert.equal(REWORD_ON_BOARD.name, "reword_on_board");
  assert.deepEqual(REWORD_ON_BOARD.parameters.required, ["boardId", "rewordings"]);

  const properties = REWORD_ON_BOARD.parameters.properties as Record<
    string,
    { items?: { properties?: object; required?: string[] } }
  >;
  /// Objects for the same reason a swap's are: two parallel arrays of wordings
  /// would misalign into a line that reads as correct whichever way it was meant,
  /// and here the mistake is written onto the board in words.
  assert.deepEqual(Object.keys(properties.rewordings!.items!.properties!), ["from", "to"]);
  assert.deepEqual(properties.rewordings!.items!.required, ["from", "to"]);
  /// The routing is in the description, obeyed before the call: a rebuild is what
  /// this exists to stop, and add/remove of a line is what it must not swallow.
  assert.match(REWORD_ON_BOARD.description, /prefer it over design_page/);
  /// The two calls that add and remove a line, now that the compose that used
  /// to do both is retired.
  assert.match(REWORD_ON_BOARD.description, /put_on_canvas to add a line the board does not carry/);
  assert.match(REWORD_ON_BOARD.description, /remove_from_canvas to take one off/);
});

/// The tool that makes a board, which is the one thing agent 6 could not do for
/// itself once `compose_moodboard` was retired: `duplicate_board` needs a source
/// and `design_page` needs a boardId, so without this there is no first board.

test("add_board asks for nothing and decides nothing", () => {
  assert.equal(ADD_BOARD.name, "add_board");
  /// Every argument optional, which is what an ungated tool has to be: the
  /// empty project can call it and the call still means something.
  assert.equal(ADD_BOARD.parameters.required, undefined);
  assert.deepEqual(Object.keys(ADD_BOARD.parameters.properties as object), [
    "title",
    "preset",
    "pageName",
  ]);

  /// What it is: the rectangle and the tab, and no judgement at all. The model
  /// has to know this or it will hold the call back waiting to have decided
  /// something first.
  assert.match(ADD_BOARD.description, /makes no model call, chooses no picture/);
  /// And the second half of the call, in the same turn — a board filed and left
  /// blank is a tab the user opened for nothing.
  assert.match(ADD_BOARD.description, /then call design_page/);
  assert.match(ADD_BOARD.description, /Both in the same turn/);
});

test("add_board offers the three page shapes the app has, and no others", () => {
  const preset = (ADD_BOARD.parameters.properties as Record<string, { enum?: string[] }>).preset!;
  assert.deepEqual(preset.enum, [...PAGE_PRESET_IDS]);
  /// The same three RESIZE_PAGE names, so the model chooses between rectangles
  /// it can see the size of rather than between three words.
  const said = (RESIZE_PAGE.parameters.properties as Record<string, { enum?: string[] }>).preset!;
  assert.deepEqual(preset.enum, said.enum);
});

/// The one clause this declaration is a function of the state for. A second
/// board is very often the wrong answer to "another version of this" — but only
/// a project that already has one can be told so, because the tool it would be
/// sent to is not declared before then.
test("add_board routes away from itself only where there is a board to copy", () => {
  const first = addBoardFor({ photographs: 3, crops: 0, boards: 0 }).description;
  assert.ok(!first.includes("duplicate_board"));
  assert.ok(!first.includes("newPage"));

  const another = addBoardFor({ photographs: 3, crops: 0, boards: 1 }).description;
  assert.match(another, /Use duplicate_board instead/);
  /// And the other thing a second board is usually the wrong answer to.
  assert.match(another, /design_page with newPage/);
});
