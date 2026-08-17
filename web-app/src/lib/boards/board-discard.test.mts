import { test } from "node:test";
import assert from "node:assert/strict";

import { discardKey, discardedBoardNote, type DiscardedBoard } from "@/lib/boards/board-discard";
import { attachmentKey, boardAttachmentOf } from "@/lib/agent/agent-tools";

const GONE: DiscardedBoard = { boardId: "board-1", title: "Act two", pictures: 6 };

test("the note names the board, kills the id and says the pictures are still there", () => {
  const note = discardedBoardNote(GONE);

  assert.match(note, /Act two/);
  assert.match(note, /board-1/);
  /// The id is the point: the boards primed into the next turn are a fresh read
  /// and this one is simply absent, so a model holding the id from the
  /// conversation above would pass it to a tool and be told it does not exist.
  assert.match(note, /no longer names anything/);
  /// And the reassurance, because "I discarded the board" is a sentence a
  /// user can hear as having lost the pictures on it.
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

/// The other door: a board deleted from the tab row. That list carries titles
/// and renders and never a count of what is on a scene, so the note says the
/// photographs are safe without saying how many — which is all the count was for.
test("a board that went from the tab row still says the photographs are safe", () => {
  const note = discardedBoardNote({ boardId: "board-1", title: "Act two" });

  assert.match(note, /Any photographs that were on it are still in the gallery/);
  assert.match(note, /no longer names anything/);
});

test("a board nobody named is still named", () => {
  assert.match(discardedBoardNote({ ...GONE, title: "  " }), /Untitled board/);
});

/// The same pinning `takenOfferKey` gets against a crop's tile: the offer and the
/// act that settles it have to agree on one string, or the tile goes on offering
/// something that is already done.
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
  /// Absent rather than false on an ordinary board tile: a flag nobody set is
  /// not a fact worth carrying, and the two tiles are otherwise the same tile.
  assert.equal("discard" in shown, false);
  assert.deepEqual({ ...offered, discard: undefined }, { ...shown, discard: undefined });
  /// Which is also why it is not a fourth attachment kind: one board has one
  /// tile in the strip however many ways a turn talked about it.
  assert.equal(attachmentKey(offered), attachmentKey(shown));
});
