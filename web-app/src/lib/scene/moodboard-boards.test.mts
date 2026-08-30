import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_TITLE_LIMIT,
  DEFAULT_BOARD_TITLE,
  activeBoardId,
  boardAfterRemoval,
  duplicateBoardTitle,
  nextBoardTitle,
  normalizedBoardTitle,
  withBoardTitle,
} from "@/lib/scene/moodboard-boards";

const BOARDS = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("a title is collapsed to one line", () => {
  assert.equal(normalizedBoardTitle("  Act   two \n lighting  "), "Act two lighting");
});

test("an empty or whitespace-only title is not a rename", () => {
  assert.equal(normalizedBoardTitle(""), null);
  assert.equal(normalizedBoardTitle("   \n\t "), null);
});

test("a title is truncated to what the server accepts", () => {
  const long = normalizedBoardTitle("x".repeat(BOARD_TITLE_LIMIT + 50));
  assert.equal(long?.length, BOARD_TITLE_LIMIT);
});

test("truncation never leaves a trailing space", () => {
  const title = normalizedBoardTitle(`${"x".repeat(BOARD_TITLE_LIMIT - 1)} tail`);
  assert.equal(title, "x".repeat(BOARD_TITLE_LIMIT - 1));
});

test("the first board keeps the plain default name", () => {
  assert.equal(nextBoardTitle([]), DEFAULT_BOARD_TITLE);
  assert.equal(nextBoardTitle([{ title: "Colour" }]), DEFAULT_BOARD_TITLE);
});

test("a new board is never named the same as an existing one", () => {
  const boards = [{ title: DEFAULT_BOARD_TITLE }];
  assert.equal(nextBoardTitle(boards), "Untitled board 2");
  assert.equal(nextBoardTitle([...boards, { title: "Untitled board 2" }]), "Untitled board 3");
});

test("a gap in the numbering is filled before the end is extended", () => {
  const boards = [{ title: DEFAULT_BOARD_TITLE }, { title: "Untitled board 3" }];
  assert.equal(nextBoardTitle(boards), "Untitled board 2");
});

test("naming ignores the whitespace around a stored title", () => {
  assert.equal(nextBoardTitle([{ title: ` ${DEFAULT_BOARD_TITLE} ` }]), "Untitled board 2");
});

test("a copy says which board it is a copy of", () => {
  assert.equal(duplicateBoardTitle([{ title: "Act two" }], "Act two"), "Act two (copy)");
});

test("copies of one board are numbered rather than stacked", () => {
  const boards = [{ title: "Act two" }, { title: "Act two (copy)" }];
  assert.equal(duplicateBoardTitle(boards, "Act two"), "Act two (copy 2)");
  assert.equal(duplicateBoardTitle(boards, "Act two (copy)"), "Act two (copy 2)");
  assert.equal(
    duplicateBoardTitle([...boards, { title: "Act two (copy 2)" }], "Act two (copy 2)"),
    "Act two (copy 3)",
  );
});

test("a copy fits the title the server accepts, suffix included", () => {
  const title = duplicateBoardTitle([], "x".repeat(BOARD_TITLE_LIMIT));
  assert.equal(title.length, BOARD_TITLE_LIMIT);
  assert.ok(title.endsWith(" (copy)"));
});

test("a copy of a board with no usable name still has one", () => {
  assert.equal(duplicateBoardTitle([], "   "), `${DEFAULT_BOARD_TITLE} (copy)`);
});

test("deleting a board the user is not on leaves them where they are", () => {
  assert.equal(boardAfterRemoval(BOARDS, "c", "a"), "a");
});

test("deleting the open board lands on the next one along", () => {
  assert.equal(boardAfterRemoval(BOARDS, "a", "a"), "b");
  assert.equal(boardAfterRemoval(BOARDS, "b", "b"), "c");
});

test("deleting the last board lands on the previous one", () => {
  assert.equal(boardAfterRemoval(BOARDS, "c", "c"), "b");
});

test("deleting the only board leaves nothing open", () => {
  assert.equal(boardAfterRemoval([{ id: "a" }], "a", "a"), null);
});

test("an active id the list has lost is dropped", () => {
  assert.equal(boardAfterRemoval(BOARDS, "c", "gone"), null);
  assert.equal(boardAfterRemoval(BOARDS, "gone", "a"), "a");
});

test("the active board is the chosen one when the list still has it", () => {
  assert.equal(activeBoardId(BOARDS, "b"), "b");
});

test("an unknown or unset choice falls back to the first board", () => {
  assert.equal(activeBoardId(BOARDS, null), "a");
  assert.equal(activeBoardId(BOARDS, "gone"), "a");
});

test("no boards means no active board", () => {
  assert.equal(activeBoardId([], "a"), null);
  assert.equal(activeBoardId(undefined, "a"), null);
});

test("renaming one board leaves the others untouched", () => {
  const boards = [
    { id: "a", title: "One" },
    { id: "b", title: "Two" },
  ];
  const renamed = withBoardTitle(boards, "b", "Second");
  assert.deepEqual(
    renamed.map((board) => board.title),
    ["One", "Second"],
  );
  assert.equal(boards[1]!.title, "Two");
});
