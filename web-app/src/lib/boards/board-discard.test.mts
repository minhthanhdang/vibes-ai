import { test } from "node:test";
import assert from "node:assert/strict";

import { discardKey, discardedBoardNote, type DiscardedBoard } from "@/lib/boards/board-discard";
import { attachmentKey, boardAttachmentOf } from "@/lib/agent/shared/attachments";

const GONE: DiscardedBoard = { boardId: "board-1", title: "Act two", pictures: 6 };

test("the note names the board, kills the id and says the pictures are still there", () => {
  const note = discardedBoardNote(GONE);

  assert.match(note, /Act two/);
  assert.match(note, /board-1/);
  assert.match(note, /no longer names anything/);
  assert.match(note, /6 photographs that were on it are still in the gallery/);
});

test("a board with nothing on it says nothing about photographs", () => {
  const note = discardedBoardNote({ ...GONE, pictures: 0 });

  assert.doesNotMatch(note, /gallery/);
  assert.match(note, /gone from the project/);
});

test("one photograph is one photograph", () => {
  const note = discardedBoardNote({ ...GONE, pictures: 1 });
  assert.match(note, /The photograph that was on it is still in the gallery/);
});

test("a board that went from the tab row still says the photographs are safe", () => {
  const note = discardedBoardNote({ boardId: "board-1", title: "Act two" });

  assert.match(note, /Any photographs that were on it are still in the gallery/);
  assert.match(note, /no longer names anything/);
});

test("a board nobody named is still named", () => {
  assert.match(discardedBoardNote({ ...GONE, title: "  " }), /Untitled board/);
});

test("a discarded board is keyed exactly as its own tile is", () => {
  const tile = boardAttachmentOf({
    id: "board-1",
    title: "Act two",
    page: { width: 1920, height: 1080 },
    images: 6,
    thumbUrl: null,
    discard: true,
  });

  assert.equal(discardKey(GONE.boardId), attachmentKey(tile));
});

test("the tile an offer draws is the board's own tile, plus the question", () => {
  const offered = boardAttachmentOf({
    id: "board-1",
    title: "Act two",
    page: { width: 1920, height: 1080 },
    images: 6,
    lines: ["Dawn pitch"],
    thumbUrl: "/thumb",
    discard: true,
  });
  const shown = boardAttachmentOf({
    id: "board-1",
    title: "Act two",
    page: { width: 1920, height: 1080 },
    images: 6,
    lines: ["Dawn pitch"],
    thumbUrl: "/thumb",
  });

  assert.equal(offered.discard, true);
  assert.equal("discard" in shown, false);
  assert.deepEqual({ ...offered, discard: undefined }, { ...shown, discard: undefined });
  assert.equal(attachmentKey(offered), attachmentKey(shown));
});
