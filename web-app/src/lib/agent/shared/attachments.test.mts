import { test } from "node:test";
import assert from "node:assert/strict";

import type { ToolReference } from "@/lib/agent/shared/reference";
import { attachmentKey, attachmentOf, attachmentTarget, BOARD_LINE_CHARS, boardAttachmentOf, mergedAttachments } from "@/lib/agent/shared/attachments";

function reference(overrides: Partial<ToolReference> = {}): ToolReference {
  return {
    id: "ref-1",
    title: "Hallway",
    width: 1920,
    height: 1080,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
    ...overrides,
  };
}

test("an attachment of a photograph opens that photograph", () => {
  const target = attachmentTarget(attachmentOf(reference()));
  assert.deepEqual(target, { view: "gallery", inspectId: "ref-1" });
});

test("an attachment of a cut opens the frame it was cut from, at that cut", () => {
  const attachment = attachmentOf(
    reference({
      id: "cut-1",
      title: "Hallway (crop 2)",
      editIntent: "the doorway",
      source: { id: "ref-1", title: "Hallway" },
    }),
  );

  assert.equal(attachment.caption, "Hallway — the doorway");
  assert.deepEqual(attachmentTarget(attachment), {
    view: "gallery",
    inspectId: "ref-1",
    versionId: "cut-1",
  });
});

test("a photograph is not sent to a version of itself", () => {
  const target = attachmentTarget(attachmentOf(reference()));
  assert.equal("versionId" in target, false);
});

test("the same picture shown on two rounds of one exchange is drawn once", () => {
  const first = [attachmentOf(reference({ id: "a" }))];
  const merged = mergedAttachments(first, [
    attachmentOf(reference({ id: "a" })),
    attachmentOf(reference({ id: "b" })),
  ]);

  assert.deepEqual(merged.map(attachmentKey), ["reference:a", "reference:b"]);
});

test("a board and a reference of the same id are two attachments", () => {
  const board = boardAttachmentOf({
    id: "a",
    title: "Act one",
    layout: "GRID_3X3",
    images: 9,
    thumbUrl: null,
  });
  const merged = mergedAttachments([attachmentOf(reference({ id: "a" }))], [board, board]);

  assert.deepEqual(merged.map(attachmentKey), ["reference:a", "board:a"]);
});

test("a board with nothing drawn of it yet falls back to its cover", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "SPLIT",
    images: 1,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
  });

  assert.equal(board.preview, null);
  assert.equal(board.thumbUrl, "/api/references/ref-1/image?variant=thumb");
});

test("a board carries the arrangement it was composed into", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "SPLIT",
    images: 1,
    thumbUrl: null,
    preview: {
      aspectRatio: 16 / 9,
      items: [{ kind: "image", left: 0, top: 0, width: 50, height: 100, thumbUrl: "/t.jpg" }],
    },
  });

  assert.equal(board.preview?.items.length, 1);
  assert.equal(attachmentKey(board), "board:b1");
});

test("a board says what it is rather than what it is called", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "  ",
    layout: "HERO_LEFT",
    images: 1,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
  });

  assert.equal(board.title, "Untitled board");
  assert.equal(board.caption, "1 photograph · Hero left");
});

test("a board attachment opens the board, a cut opens its frame", () => {
  assert.deepEqual(
    attachmentTarget(
      boardAttachmentOf({ id: "b1", title: "Act one", layout: "SPLIT", images: 2, thumbUrl: null }),
    ),
    { view: "moodboard", boardId: "b1" },
  );
  assert.deepEqual(
    attachmentTarget(attachmentOf(reference({ id: "cut", source: { id: "frame", title: "Hallway" } }))),
    { view: "gallery", inspectId: "frame", versionId: "cut" },
  );
});

/// A board read off its own scene has no template — the layout is not stored,
/// and a board the user rearranged is no longer the shape it started as. The
/// page is what is still true about it.
test("a board with no template is captioned by its page", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    page: { width: 1080, height: 1920 },
    images: 6,
    thumbUrl: null,
  });

  assert.equal(board.caption, "6 photographs · 1080×1920");
});

/// The commonest two-tool turn about a board: the instruction tells the model to
/// read one before it changes one, so the read's tile and the edit's tile are the
/// same board a round apart. Drawing the first is drawing the board as it was
/// before the change the user asked for.
test("a board seen twice in one turn is drawn as it last stood, in the place it first appeared", () => {
  const read = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "SPLIT",
    images: 2,
    thumbUrl: null,
  });
  const afterTheEdit = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "TRIPTYCH",
    images: 3,
    thumbUrl: null,
  });

  const merged = mergedAttachments([read, attachmentOf(reference({ id: "a" }))], [afterTheEdit]);

  assert.deepEqual(merged.map(attachmentKey), ["board:b1", "reference:a"]);
  assert.equal(merged[0]?.caption, "3 photographs · Triptych");
});

/// Only a board. A photograph's bytes do not change inside a turn and an offer is
/// keyed by its own box, so replacing either would be redrawing the same tile.
test("a picture shown twice keeps the first drawing of it", () => {
  const first = attachmentOf(reference({ id: "a", title: "Hallway" }));
  const again = attachmentOf(reference({ id: "a", title: "Renamed since" }));

  const merged = mergedAttachments([first], [again]);

  assert.deepEqual(merged.map(attachmentKey), ["reference:a"]);
  assert.equal(merged[0]?.title, "Hallway");
});

/// A board is pictures *and* text, and a reply about the headline came back with
/// a tile that said "4 photographs" beside a miniature drawing the line as a
/// featureless bar — the one thing that had just changed, invisible.
test("a board says what is written on it, not only how many pictures", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Dawn Study",
    layout: "POLAROID_SCATTER",
    images: 4,
    lines: ["ACT TWO"],
    thumbUrl: null,
  });

  assert.deepEqual(board.lines, ["ACT TWO"]);
  assert.equal(board.linesOver, 0);
  assert.equal(board.caption, "4 photographs · 1 line · Polaroid scatter");
});

test("a board carrying nothing written says nothing about lines", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "SPLIT",
    images: 2,
    lines: ["   ", ""],
    thumbUrl: null,
  });

  assert.deepEqual(board.lines, []);
  assert.equal(board.caption, "2 photographs · Split");
});

/// A hand-arranged board has no bound on how much type the user dropped on
/// it, and the tile is a tile. What does not fit is counted rather than left off
/// the end, so the last line shown does not read as the last line there is.
test("a board of more lines than fit counts the rest", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Notes",
    page: { width: 1920, height: 1080 },
    images: 0,
    lines: ["one", "two", "three", "four", "five"],
    thumbUrl: null,
  });

  assert.deepEqual(board.lines, ["one", "two", "three"]);
  assert.equal(board.linesOver, 2);
  assert.equal(board.caption, "0 photographs · 5 lines · 1920×1080");
});

test("a line longer than the tile is cut with an ellipsis rather than wrapped", () => {
  const long = "the light comes over the ridge and everything below it goes to silhouette";
  const board = boardAttachmentOf({
    id: "b1",
    title: "Notes",
    images: 1,
    lines: [`  ${long}  `.replace("comes over", "comes  over")],
    thumbUrl: null,
  });

  const [shown] = board.lines;
  assert.equal(shown?.length, BOARD_LINE_CHARS);
  assert.ok(shown?.endsWith("…"));
  /// Whitespace normalised on the way in, so a retyped double space is not a
  /// different line and does not eat two of the characters that fit.
  assert.ok(shown?.startsWith("the light comes over the ridge"));
});
