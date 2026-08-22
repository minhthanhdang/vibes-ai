import { test } from "node:test";
import assert from "node:assert/strict";

import { rewordOnBoard } from "@/lib/boards/board-text";
import { boardPages, pageFrame } from "@/lib/pages/board-pages";
import { setWidth } from "@/lib/render/text-set";
import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

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

/// tech-spec §V: the pages of a spread carry the same words as often as not — a
/// template puts a heading in the same place on each — so a flat match rewrites
/// whichever page the scene array carries first, which is a headline the user
/// was not talking about.
const PAGE_ONE = { x: 0, y: 0, width: 1920, height: 1080 };
const PAGE_TWO = { ...PAGE_ONE, x: 2200 };

/// The page as the board carries it: membership is asked of the frames in the
/// scene, so a fixture that only wrote the rectangle out beside them would be a
/// board with no pages on it.
const pageTwoOf = (elements: readonly SceneElement[]) =>
  boardPages(elements).find((page) => page.id === "page-2")!;

function spread(pageOne: readonly string[], pageTwo: readonly string[]): SceneElement[] {
  const lines = (texts: readonly string[], x: number, named: string) =>
    texts.map((text, index) => ({
      id: `${named}-txt-${index}`,
      type: "text",
      text,
      originalText: text,
      x,
      y: 400 + index * 60,
      width: 600,
      height: 40,
      fontSize: 32,
      autoResize: false,
    }));

  return [
    ...lines(pageOne, 0, "page-1"),
    pageFrame(PAGE_ONE, { name: "page-1", makeId: () => "page-1" }),
    ...lines(pageTwo, PAGE_TWO.x, "page-2"),
    pageFrame(PAGE_TWO, { name: "page-2", makeId: () => "page-2" }),
  ];
}

test("the line rewritten is the one on the page named, not the first the board carries", () => {
  const elements = spread(["THE HEADING"], ["THE HEADING"]);

  const { elements: after, reworded } = rewordOnBoard({
    elements,
    rewordings: [{ from: "THE HEADING", to: "ACT TWO" }],
    onPage: pageTwoOf(elements),
  });

  assert.deepEqual(reworded, [{ from: "THE HEADING", to: "ACT TWO" }]);
  assert.deepEqual(
    after.filter((element) => element.type === "text").map((element) => element.text),
    ["THE HEADING", "ACT TWO"],
  );
});

test("a wording only on another page is reported rather than rewritten there", () => {
  const elements = spread(["THE HEADING"], ["ACT TWO"]);

  const { elements: after, reworded, notOnBoard } = rewordOnBoard({
    elements,
    rewordings: [{ from: "the heading", to: "ACT ONE" }],
    onPage: pageTwoOf(elements),
  });

  assert.deepEqual([reworded, notOnBoard], [[], ["the heading"]]);
  assert.deepEqual(after, elements);
});

/// Two pages the user dragged together hold one line between them, and it is
/// the topmost page's (§V.3). Matched against this page's rectangle alone, a
/// reword scoped to the page underneath reaches into the page lying over it —
/// which is the wrong copy in exactly the way a flat match was.
test("a line where two pages overlap is reworded on the page holding it, not on the one under it", () => {
  const lines = spread([], ["THE HEADING"]);
  const elements = [
    ...lines.filter((element) => element.type === "text"),
    pageFrame(PAGE_ONE, { name: "page-1", makeId: () => "page-1" }),
    pageFrame({ ...PAGE_ONE, x: 1800 }, { name: "page-2", makeId: () => "page-2" }),
    /// Centre at 1850, inside page 1 (0–1920) and inside page 2 (1800–3720).
  ].map((element) => (element.type === "text" ? { ...element, x: 1550 } : element)) as SceneElement[];

  const under = rewordOnBoard({
    elements,
    rewordings: [{ from: "THE HEADING", to: "ACT ONE" }],
    onPage: boardPages(elements).find((page) => page.id === "page-1")!,
  });
  assert.deepEqual([under.reworded, under.notOnBoard], [[], ["THE HEADING"]]);

  const over = rewordOnBoard({
    elements,
    rewordings: [{ from: "THE HEADING", to: "ACT TWO" }],
    onPage: boardPages(elements).find((page) => page.id === "page-2")!,
  });
  assert.deepEqual(over.reworded, [{ from: "THE HEADING", to: "ACT TWO" }]);
});

/// By the centre of the block's box, the rule every page read uses: a caption
/// straddling the page's edge is on the page it is mostly on.
test("a line hanging over the page edge, centre and all, is not on it", () => {
  const elements = spread([], ["CREDITS"]).map((element) =>
    element.type === "text" ? { ...element, x: PAGE_TWO.x + PAGE_TWO.width - 100 } : element,
  );

  const { reworded } = rewordOnBoard({
    elements,
    rewordings: [{ from: "CREDITS", to: "END CREDITS" }],
    onPage: pageTwoOf(elements),
  });

  assert.deepEqual(reworded, []);
});

/// The fourth door onto the same fact as `put_on_canvas` and
/// `restyle_on_canvas`: excalidraw draws `text` exactly as it is stored, so a
/// headline reworded into a sentence was one long line running out of the slot
/// it was composed into.
test("a wording longer than the slot is broken to the slot", () => {
  const elements = board(["ACT TWO"]);

  const { elements: after, reworded } = rewordOnBoard({
    elements,
    rewordings: [
      { from: "ACT TWO", to: "Act two, exteriors, shot over three mornings on the north coast" },
    ],
  });

  const line = after.find((element) => element.type === "text")!;
  const lines = String(line.text).split("\n");
  assert.ok(lines.length > 1, "the sentence does not fit a 600 box at 32px");
  for (const one of lines) assert.ok(setWidth(one, 32) <= 600, `over the slot: ${one}`);
  assert.equal(lines.join(" "), reworded[0]!.to, "the words are the ones that were said");
  /// The width is the slot's and the height is what the words came to.
  assert.equal(line.width, 600);
  assert.equal(line.x, 0);
  assert.equal(line.height, Math.round(lines.length * 32 * TEXT_LINE_HEIGHT));
});

test("what was said goes in originalText whole, so opening the block re-wraps it", () => {
  const said = "Act two, exteriors, shot over three mornings on the north coast";
  const { elements: after } = rewordOnBoard({
    elements: board(["ACT TWO"]),
    rewordings: [{ from: "ACT TWO", to: said }],
  });

  const line = after.find((element) => element.type === "text")!;
  assert.equal(line.originalText, said);
  assert.notEqual(line.text, said, "the drawn string is the broken one");
});

/// The wrap and the match are the same property `lineKey` already had: a line
/// stored with breaks in it is still the line the model quotes back.
test("a block already broken is matched by the sentence it says", () => {
  const said = "Act two, exteriors, shot over three mornings on the north coast";
  const once = rewordOnBoard({
    elements: board(["ACT TWO"]),
    rewordings: [{ from: "ACT TWO", to: said }],
  });

  const twice = rewordOnBoard({
    elements: once.elements,
    rewordings: [{ from: said, to: "ACT TWO" }],
  });

  assert.deepEqual(twice.notOnBoard, []);
  const line = twice.elements.find((element) => element.type === "text")!;
  assert.equal(line.text, "ACT TWO");
  /// And the block comes back down to the one line it now says.
  assert.equal(line.height, Math.round(32 * TEXT_LINE_HEIGHT));
});

/// The other half of the same rule: a block left to size itself has a width
/// that is a measurement of the string it used to carry, so breaking new words
/// to it would break them to a width nobody chose.
test("a block that sizes itself takes the words whole and keeps its box", () => {
  const elements = board(["ACT TWO"]).map((element) =>
    element.type === "text" ? { ...element, autoResize: true } : element,
  );
  const said = "Act two, exteriors, shot over three mornings on the north coast";

  const { elements: after } = rewordOnBoard({ elements, rewordings: [{ from: "ACT TWO", to: said }] });

  const line = after.find((element) => element.type === "text")!;
  assert.equal(line.text, said);
  assert.equal(line.originalText, said);
  assert.equal(line.height, 40, "the box excalidraw will re-measure itself is left alone");
  assert.equal(line.width, 600);
});
