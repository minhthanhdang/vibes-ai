import { test } from "node:test";
import assert from "node:assert/strict";

import { takenCutAttachment, takenCutNote, takenOfferKey, type TakenCut } from "./cut-taken";
import { attachmentKey, attachmentTarget, cropAttachmentOf } from "./agent-tools";
import type { CropOffer } from "./crop-offer";

const TAKEN: TakenCut = {
  referenceId: "cut-1",
  frameId: "frame-1",
  title: "Hall doorway (crop 2)",
  keeps: "the doorway alone",
  aspect: "2.39:1",
  thumbUrl: "/api/references/cut-1/image?variant=thumb",
  cropBox: [100, 200, 600, 900],
};

const OFFER: CropOffer = {
  referenceId: "frame-1",
  region: { x: 0.2, y: 0.1, width: 0.7, height: 0.5 },
  cropBox: [100, 200, 600, 900],
  editIntent: "the doorway alone",
  editRationale: "the doorway is the shot",
  aspect: "2.39:1",
};

test("the note names both ids, what the cut keeps and the shape it was held to", () => {
  const note = takenCutNote(TAKEN);

  assert.match(note, /Hall doorway \(crop 2\)/);
  assert.match(note, /the doorway alone/);
  assert.match(note, /2\.39:1/);
  /// The two ids are the whole reason the note exists: the cut to name, and the
  /// frame it replaces on a board.
  assert.match(note, /cut-1/);
  assert.match(note, /frame-1/);
  /// The permission, said because this id is not in the primed list the
  /// instruction calls the project.
  assert.match(note, /pass that id to a tool/);
});

test("a cut asked for at no particular shape says nothing about a shape", () => {
  const note = takenCutNote({ ...TAKEN, aspect: null });

  assert.match(note, /keeps “the doorway alone”/);
  assert.doesNotMatch(note, /\bat \d/);
});

/// The chat tile said "Roughly square" when the cut was offered. A note that
/// only ever names ratios would then say nothing at all about the one thing the
/// director asked for — and "at" is the wrong preposition for a shape nothing was
/// held to.
test("a cut framed loosely says so, and says it as framing rather than as a ratio", () => {
  const note = takenCutNote({ ...TAKEN, aspect: null, framed: "square" });

  assert.match(note, /framed roughly square/);
  assert.doesNotMatch(note, /\bat \d/);
});

test("a cut held to a ratio is said at that ratio, whatever else rode along", () => {
  /// Not a state a caller should reach, and the same rule `cropOffer` resolves it
  /// by: the exact shape is the one with arithmetic behind it, so it wins.
  const note = takenCutNote({ ...TAKEN, framed: "square" });

  assert.match(note, /at 2\.39:1/);
  assert.doesNotMatch(note, /framed/);
});

test("a word that is not a loose shape is not framing", () => {
  const note = takenCutNote({ ...TAKEN, aspect: null, framed: "squarish" });

  assert.doesNotMatch(note, /framed/);
  assert.match(note, /keeps “the doorway alone”/);
});

test("a cut with no words on it is still named and still filed", () => {
  const note = takenCutNote({ ...TAKEN, keeps: "  ", aspect: null });

  assert.match(note, /“Hall doorway \(crop 2\)”\./);
  assert.doesNotMatch(note, /keeps/);
  assert.match(note, /filed as cut-1/);
});

test("a cut filed under no title at all is still a sentence", () => {
  const note = takenCutNote({ ...TAKEN, title: "", keeps: "", aspect: null });

  assert.match(note, /“the cut”/);
  assert.match(note, /filed as cut-1, a cut of frame-1/);
});

test("the cut is attached as a picture the project holds, not as an offer", () => {
  const attachment = takenCutAttachment(TAKEN);

  assert.equal(attachment.kind, "reference");
  assert.equal(attachment.referenceId, "cut-1");
  assert.equal(attachment.frameId, "frame-1");
  assert.equal(attachment.thumbUrl, TAKEN.thumbUrl);
  /// Captioned by what it keeps rather than by the frame's title said twice —
  /// the title above it already carries the photograph's name.
  assert.equal(attachment.caption, "the doorway alone");
  assert.equal(attachmentKey(attachment), "reference:cut-1");
});

test("clicking the taken cut opens the frame at that cut", () => {
  assert.deepEqual(attachmentTarget(takenCutAttachment(TAKEN)), {
    view: "gallery",
    inspectId: "frame-1",
    versionId: "cut-1",
  });
});

test("a cut nobody put words to is captioned by its own title", () => {
  const attachment = takenCutAttachment({ ...TAKEN, keeps: "" });

  assert.equal(attachment.caption, "Hall doorway (crop 2)");
});

test("the taken cut settles the offer tile the chat is still showing", () => {
  const offered = cropAttachmentOf(
    { id: "frame-1", thumbUrl: "/api/references/frame-1/image?variant=thumb", width: 4000, height: 3000 },
    OFFER,
  );

  assert.equal(takenOfferKey(TAKEN), attachmentKey(offered));
});

test("a cut whose box was nudged away from the offer settles nothing", () => {
  /// The tile is still drawing the box that was offered, and that box was not
  /// the one filed — so it is an offer of it, honestly.
  assert.notEqual(takenOfferKey({ ...TAKEN, cropBox: [110, 200, 600, 900] }), attachmentKey(
    cropAttachmentOf(
      { id: "frame-1", thumbUrl: "/api/references/frame-1/image?variant=thumb", width: 4000, height: 3000 },
      OFFER,
    ),
  ));
});

test("two cuts of one frame settle their own offers and not each other's", () => {
  const other = { ...TAKEN, referenceId: "cut-2", cropBox: [0, 0, 500, 500] };

  assert.notEqual(takenOfferKey(TAKEN), takenOfferKey(other));
});

/// The cut that was asked for a board is on it by the time the note is read, so
/// the note has to close that off: the model's next move otherwise is the swap
/// that would be refused for a picture already on the board.
test("a cut taken for a board says it is already there and that no swap is left", () => {
  const note = takenCutNote({
    ...TAKEN,
    board: {
      kind: "board",
      boardId: "bd-1",
      title: "Ridge study",
      caption: "2 photographs · Split",
      thumbUrl: null,
      preview: null,
      lines: [],
      linesOver: 0,
      images: 2,
    },
  });

  assert.match(note, /already on “Ridge study” \(bd-1\)/);
  /// The frame it took the place of, since that is the picture the assistant
  /// last said was loose in its slot.
  assert.match(note, /the place frame-1 had/);
  assert.match(note, /no swap left to make/);
});

test("a cut taken for nothing in particular says nothing about a board", () => {
  const note = takenCutNote(TAKEN);

  assert.ok(!note.includes("board"));
  assert.ok(!note.includes("swap"));
});
