import { test } from "node:test";
import assert from "node:assert/strict";

import { rewordOnBoard } from "./board-text";
import type { SceneElement } from "./moodboard-scene";

/// The edit that replaced a rebuild for the wording of a line. Everything here is
/// about the two things a reword promises — the block says something else, and
/// nothing on the board moves — plus what it says about the lines it could not
/// find.

function board(lines: readonly string[], pictures: readonly string[] = []): SceneElement[] {
  return [
    ...pictures.map((referenceId, index) => ({
      id: `img-${index}`,
      type: "image",
      fileId: `ref:${referenceId}`,
      x: index * 100,
      y: 0,
      width: 100,
      height: 100,
    })),
    ...lines.map((text, index) => ({
      id: `txt-${index}`,
      type: "text",
      text,
      originalText: text,
      x: 0,
      y: 400,
      width: 600,
      height: 40,
      fontSize: 32,
      autoResize: false,
    })),
  ];
}

test("the line says something else and keeps its box", () => {
  const elements = board(["Act two exteriors"], ["a"]);

  const { elements: after, reworded } = rewordOnBoard({
    elements,
    rewordings: [{ from: "Act two exteriors", to: "Act two, exteriors" }],
  });

  assert.deepEqual(reworded, [{ from: "Act two exteriors", to: "Act two, exteriors" }]);
  const line = after.find((element) => element.type === "text")!;
  assert.equal(line.text, "Act two, exteriors");
  /// Both strings, or the block resurrects the old wording the moment it is
  /// opened for editing.
  assert.equal(line.originalText, "Act two, exteriors");
  assert.deepEqual(
    { x: line.x, y: line.y, width: line.width, height: line.height },
    { x: 0, y: 400, width: 600, height: 40 },
  );
});

test("nothing else on the board is touched, and the array order holds", () => {
  const elements = board(["Headline", "A note"], ["a", "b"]);

  const { elements: after } = rewordOnBoard({
    elements,
    rewordings: [{ from: "a note", to: "Another note" }],
  });

  assert.deepEqual(
    after.map((element) => element.id),
    elements.map((element) => element.id),
  );
  /// The pictures and the other line come back as the very same objects.
  assert.equal(after[0], elements[0]);
  assert.equal(after[1], elements[1]);
  assert.equal(after[2], elements[2]);
  assert.notEqual(after[3], elements[3]);
});

test("matching survives a retyped capital and a doubled space", () => {
  const elements = board(["The  long   afternoon"]);

  const { reworded, notOnBoard } = rewordOnBoard({
    elements,
    rewordings: [{ from: "the long afternoon", to: "The long evening" }],
  });

  assert.deepEqual(notOnBoard, []);
  /// The `from` reported back is the board's own wording, whitespace collapsed —
  /// not the model's approximation of it.
  assert.deepEqual(reworded, [{ from: "The long afternoon", to: "The long evening" }]);
});

test("a change of case alone is a change, since the key ignores case only to match", () => {
  const elements = board(["ACT TWO"]);

  const { elements: after, reworded, unchanged } = rewordOnBoard({
    elements,
    rewordings: [{ from: "act two", to: "Act two" }],
  });

  assert.deepEqual(unchanged, []);
  assert.deepEqual(reworded, [{ from: "ACT TWO", to: "Act two" }]);
  assert.equal(after.find((element) => element.type === "text")!.text, "Act two");
});

test("a line already saying exactly that is named rather than rewritten", () => {
  const elements = board(["Act two"]);

  const { elements: after, reworded, unchanged } = rewordOnBoard({
    elements,
    rewordings: [{ from: "Act two", to: "Act  two " }],
  });

  assert.deepEqual(reworded, []);
  assert.deepEqual(unchanged, ["Act two"]);
  assert.equal(after[0], elements[0]);
});

test("a wording the board does not carry is reported, not guessed at", () => {
  const elements = board(["Act two"]);

  const { elements: after, reworded, notOnBoard } = rewordOnBoard({
    elements,
    rewordings: [{ from: "Act three", to: "Act four" }],
  });

  assert.deepEqual(reworded, []);
  assert.deepEqual(notOnBoard, ["Act three"]);
  assert.deepEqual(after, elements);
});

test("an image whose caption-like id matches is never reworded — only text blocks are", () => {
  const elements: SceneElement[] = [
    { id: "img-0", type: "image", fileId: "ref:a", text: "Act two", x: 0, y: 0, width: 10, height: 10 },
  ];

  const { notOnBoard, reworded } = rewordOnBoard({
    elements,
    rewordings: [{ from: "Act two", to: "Act three" }],
  });

  assert.deepEqual(reworded, []);
  assert.deepEqual(notOnBoard, ["Act two"]);
});

test("a block matched only by originalText is still found", () => {
  /// Excalidraw wraps `text` and leaves `originalText` as typed, so a long line
  /// on the board is quoted back out of `inspect_board` with the newlines in it.
  const elements: SceneElement[] = [
    { id: "txt-0", type: "text", text: "", originalText: "Act two", x: 0, y: 0, width: 10, height: 10 },
  ];

  const { elements: after, reworded } = rewordOnBoard({
    elements,
    rewordings: [{ from: "act two", to: "Act three" }],
  });

  assert.deepEqual(reworded, [{ from: "Act two", to: "Act three" }]);
  assert.equal(after[0]!.text, "Act three");
});

test("two rewordings each land on their own block", () => {
  const elements = board(["Headline", "A note"]);

  const { elements: after, reworded } = rewordOnBoard({
    elements,
    rewordings: [
      { from: "Headline", to: "A better headline" },
      { from: "A note", to: "A better note" },
    ],
  });

  assert.deepEqual(reworded, [
    { from: "Headline", to: "A better headline" },
    { from: "A note", to: "A better note" },
  ]);
  assert.deepEqual(
    after.filter((element) => element.type === "text").map((element) => element.text),
    ["A better headline", "A better note"],
  );
});

test("the same line named twice rewrites one block and reports the second as gone", () => {
  const elements = board(["Headline"]);

  const { elements: after, reworded, notOnBoard } = rewordOnBoard({
    elements,
    rewordings: [
      { from: "Headline", to: "First" },
      { from: "Headline", to: "Second" },
    ],
  });

  assert.deepEqual(reworded, [{ from: "Headline", to: "First" }]);
  /// The second would have overwritten the first, so it is reported as what it
  /// now is rather than silently winning.
  assert.deepEqual(notOnBoard, ["Headline"]);
  assert.equal(after.find((element) => element.type === "text")!.text, "First");
});

test("two blocks carrying the same words are reworded one apiece", () => {
  const elements = board(["Same", "Same"]);

  const { elements: after } = rewordOnBoard({
    elements,
    rewordings: [
      { from: "Same", to: "First" },
      { from: "Same", to: "Second" },
    ],
  });

  assert.deepEqual(
    after.filter((element) => element.type === "text").map((element) => element.text),
    ["First", "Second"],
  );
});

test("a blank end of a pair changes nothing", () => {
  const elements = board(["Headline"]);

  const { elements: after, reworded, notOnBoard } = rewordOnBoard({
    elements,
    rewordings: [
      { from: "Headline", to: "   " },
      { from: "  ", to: "Something" },
    ],
  });

  assert.deepEqual(reworded, []);
  assert.deepEqual(notOnBoard, []);
  assert.deepEqual(after, elements);
});
