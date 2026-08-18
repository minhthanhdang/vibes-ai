import { test } from "node:test";
import assert from "node:assert/strict";

import { takenCutAttachment, takenCutNote, type TakenCut } from "@/lib/crop/cut-taken";
import { attachmentKey, attachmentTarget } from "@/lib/agent/agent-tools";

const TAKEN: TakenCut = {
  referenceId: "cut-1",
  frameId: "frame-1",
  title: "Hall doorway (crop 2)",
  keeps: "the doorway alone",
  aspect: "2.39:1",
  thumbUrl: "/api/references/cut-1/image?variant=thumb",
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

/// The review card said "Roughly square" while the box was on screen. A note
/// that only ever names ratios would then say nothing at all about the one thing
/// the user asked for — and "at" is the wrong preposition for a shape nothing was
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

test("the cut is attached as a picture the project holds", () => {
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
