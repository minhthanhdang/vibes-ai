import { test } from "node:test";
import assert from "node:assert/strict";

import {
  liveVibesCount,
  vibesDismissKey,
  visibleVibesBoards,
} from "@/lib/vibes/vibes-panel";
import type { VibesBoardProgress } from "@/lib/vibes/vibes-batch";

function board(over: Partial<VibesBoardProgress> = {}): VibesBoardProgress {
  return {
    boardId: "board",
    title: "Board",
    total: 3,
    designed: 0,
    empty: 0,
    settled: 0,
    live: false,
    finished: false,
    refusal: null,
    pages: [],
    label: "",
    ...over,
  };
}

test("the dismiss key pairs the board with how many pages have settled", () => {
  assert.equal(vibesDismissKey(board({ boardId: "abc", settled: 2 })), "abc@2");
});

test("a dismissed board stays hidden while nothing new settles", () => {
  const settled = board({ boardId: "abc", settled: 2 });
  assert.deepEqual(visibleVibesBoards([settled], new Set(["abc@2"])), []);
});

test("a live board is shown even when its key was dismissed", () => {
  const live = board({ boardId: "abc", settled: 2, live: true });
  assert.deepEqual(visibleVibesBoards([live], new Set(["abc@2"])), [live]);
});

test("a dismissed board comes back once another page settles", () => {
  const later = board({ boardId: "abc", settled: 3 });
  assert.deepEqual(visibleVibesBoards([later], new Set(["abc@2"])), [later]);
});

test("boards nobody dismissed are all shown", () => {
  const boards = [board({ boardId: "one" }), board({ boardId: "two" })];
  assert.deepEqual(visibleVibesBoards(boards, new Set()), boards);
});

test("the live count ignores boards that have stopped running", () => {
  const boards = [
    board({ boardId: "one", live: true }),
    board({ boardId: "two", live: false }),
    board({ boardId: "three", live: true }),
  ];
  assert.equal(liveVibesCount(boards), 2);
});

test("the live count is zero when no board is running", () => {
  assert.equal(liveVibesCount([board(), board({ boardId: "two" })]), 0);
});
