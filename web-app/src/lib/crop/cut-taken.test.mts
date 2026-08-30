import { test } from "node:test";
import assert from "node:assert/strict";

import { takenCutAttachment, takenCutNote, type TakenCut } from "@/lib/crop/cut-taken";
import { attachmentKey, attachmentTarget } from "@/lib/agent/shared/attachments";

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
  assert.match(note, /cut-1/);
  assert.match(note, /frame-1/);
  assert.match(note, /pass that id to a tool/);
});

test("the note says the user cropped this themselves", () => {
  assert.match(takenCutNote(TAKEN), /^I cropped this myself: “Hall doorway \(crop 2\)” — /);
  assert.match(
    takenCutNote({ ...TAKEN, keeps: "  ", aspect: null }),
    /^I cropped this myself: “Hall doorway \(crop 2\)”\./,
  );
});

test("the note does not say the assistant offered the cut, or that a board changed", () => {
  for (const cut of [TAKEN, { ...TAKEN, keeps: "  ", aspect: null }]) {
    const note = takenCutNote(cut);
    assert.doesNotMatch(note, /Took the cut you offered/);
    assert.doesNotMatch(note, /no swap left to make/);
  }
});

test("a cut asked for at no particular shape says nothing about a shape", () => {
  const note = takenCutNote({ ...TAKEN, aspect: null });

  assert.match(note, /keeps “the doorway alone”/);
  assert.doesNotMatch(note, /\bat \d/);
});

test("a cut framed loosely says so, and says it as framing rather than as a ratio", () => {
  const note = takenCutNote({ ...TAKEN, aspect: null, framed: "square" });

  assert.match(note, /framed roughly square/);
  assert.doesNotMatch(note, /\bat \d/);
});

test("a cut held to a ratio is said at that ratio, whatever else rode along", () => {
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
