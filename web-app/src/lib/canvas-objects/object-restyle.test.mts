import { test } from "node:test";
import assert from "node:assert/strict";

import { canvasObjects } from "@/lib/canvas-objects/object-read";
import { restyleObjects } from "@/lib/canvas-objects/object-restyle";
import { FONT_FAMILIES } from "@/lib/canvas-objects/object-style";
import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

type Box = { x: number; y: number; width: number; height: number };

function pageFrame(id: string, box: Box, extra: object = {}): SceneElement {
  return { id, type: "frame", name: "Page 1", ...box, customData: { page: true }, ...extra };
}

function photo(id: string, box: Box, extra: object = {}): SceneElement {
  return { id, type: "image", fileId: "ref:ref-a", ...box, ...extra };
}

/// `autoResize: false` because every text element on the development database
/// carries it — 440 of 440, none auto and none without the field — which is
/// what the compose, the dropped line and the put all write. A block that sizes
/// itself is the other fixture, below.
function words(id: string, text: string, box: Box, extra: object = {}): SceneElement {
  return { id, type: "text", text, autoResize: false, ...box, ...extra };
}

function shape(id: string, type: string, box: Box, extra: object = {}): SceneElement {
  return { id, type, ...box, ...extra };
}

function byId(elements: readonly SceneElement[] | null, id: string): SceneElement {
  const found = elements?.find((element) => element.id === id);
  assert.ok(found, `no element ${id}`);
  return found;
}

const BLOCK = shape("block", "rectangle", { x: 0, y: 0, width: 960, height: 1080 }, {
  backgroundColor: "transparent",
  strokeColor: "#1e1e1e",
  strokeWidth: 1,
});

test("a shape takes its fill, outline and opacity, and nothing about it moves", () => {
  const result = restyleObjects(
    [pageFrame("p1", { x: 0, y: 0, ...HD }), BLOCK],
    [{ objectId: "block", fill: "#0c111c", stroke: "transparent", strokeWidth: 4, opacity: 45 }],
  );

  assert.deepEqual(result.restyled, [
    { objectId: "block", set: ["fill", "stroke", "strokeWidth", "opacity"] },
  ]);
  const block = byId(result.elements, "block");
  assert.equal(block.backgroundColor, "#0c111c");
  assert.equal(block.strokeColor, "transparent");
  assert.equal(block.strokeWidth, 4);
  assert.equal(block.opacity, 45);
  /// The whole of the argument for a sixth tool rather than nine fields on the
  /// transform: geometry is untouched.
  assert.equal(block.x, 0);
  assert.equal(block.y, 0);
  assert.equal(block.width, 960);
  assert.equal(block.height, 1080);
});

/// The refusal grain, and the one place this differs from the put: an object
/// that already exists keeps every field the call could not set, so a bad field
/// costs that field and not the whole change.
test("a field of the wrong kind is named back and the rest of the change is still made", () => {
  const result = restyleObjects(
    [photo("shot", { x: 0, y: 0, width: 400, height: 300 })],
    [{ objectId: "shot", opacity: 40, fill: "#0c111c" }],
  );

  assert.deepEqual(result.restyled, [
    {
      objectId: "shot",
      set: ["opacity"],
      refused: ["fill is a shape's, and this is an image"],
    },
  ]);
  assert.equal(byId(result.elements, "shot").opacity, 40);
  assert.equal("backgroundColor" in byId(result.elements, "shot"), false);
});

test("a change whose every field is refused sets nothing and lands in refused", () => {
  const result = restyleObjects(
    [photo("shot", { x: 0, y: 0, width: 400, height: 300 })],
    [{ objectId: "shot", font: "display" }],
  );

  assert.deepEqual(result.restyled, []);
  assert.deepEqual(result.refused, [
    { objectId: "shot", reason: "font is a text block's, and this is an image" },
  ]);
  assert.equal(result.elements, null);
});

/// §XI.4: a frame's own fill is drawn by neither excalidraw nor `rasterise`, so
/// writing it would give the model a coloured page and the user a white one.
test("a page takes no style fields, and neither does a section", () => {
  const result = restyleObjects(
    [
      pageFrame("p1", { x: 0, y: 0, ...HD }),
      { id: "section", type: "frame", x: 100, y: 100, width: 500, height: 500 },
    ],
    [
      { objectId: "p1", fill: "#0c111c" },
      { objectId: "section", fill: "#0c111c" },
    ],
  );

  assert.equal(result.refused.length, 2);
  for (const refusal of result.refused) {
    assert.match(refusal.reason, /takes no style fields/);
  }
  assert.equal(result.elements, null);
});

/// §XI.4's own open item, closed: the page refusal names the call that does set
/// a ground now that both agents hold it, rather than describing the thing.
test("a page is refused toward set_page_background by name", () => {
  const result = restyleObjects(
    [pageFrame("p1", { x: 0, y: 0, ...HD })],
    [{ objectId: "p1", fill: "#0c111c" }],
  );

  assert.equal(result.refused.length, 1);
  assert.match(result.refused[0]!.reason, /set_page_background/);
});

/// And a section is refused *without* it: `setPageBackground` takes a page, so
/// a section sent to that tool is a second refusal a round later.
test("a section is refused without naming a tool that would refuse it back", () => {
  const result = restyleObjects(
    [{ id: "section", type: "frame", x: 100, y: 100, width: 500, height: 500 }],
    [{ objectId: "section", fill: "#0c111c" }],
  );

  assert.equal(result.refused.length, 1);
  assert.doesNotMatch(result.refused[0]!.reason, /set_page_background/);
  assert.match(result.refused[0]!.reason, /a section takes no style fields/);
});

/// Invariant 13's other half at a write door: the read is the single answer to
/// what is addressable, so a tool that could write what no read surfaces would
/// be writing a board the model is not looking at.
test("what read_canvas cannot surface, this cannot write", () => {
  const scene = [
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    shape("arrow", "arrow", { x: 100, y: 100, width: 200, height: 10 }, { points: [[0, 0]] }),
    shape("scribble", "freedraw", { x: 100, y: 300, width: 200, height: 100 }),
    shape("point", "rectangle", { x: 100, y: 500, width: 0, height: 0 }),
  ];
  const readable = canvasObjects(scene)!.map((object) => object.objectId);
  assert.deepEqual(readable, ["p1"]);

  const result = restyleObjects(scene, [
    { objectId: "arrow", stroke: "#ffffff" },
    { objectId: "scribble", stroke: "#ffffff" },
    { objectId: "point", fill: "#ffffff" },
  ]);
  assert.deepEqual(result.notFound, ["arrow", "scribble", "point"]);
  assert.equal(result.elements, null);
});

/// The loop stage 0 closed, held shut at the sixth door: a handle no read hands
/// back must never be one a write half-honours.
test("a bound label is refused toward its container, the way a transform refuses it", () => {
  const result = restyleObjects(
    [
      shape("chip", "rectangle", { x: 0, y: 0, width: 96, height: 128 }),
      words("hex", "#8B2F1D", { x: 0, y: 100, width: 96, height: 25 }, { containerId: "chip" }),
    ],
    [{ objectId: "hex", colour: "#ffffff" }],
  );

  assert.deepEqual(result.refused, [
    { objectId: "hex", reason: "a bound label is styled with its container — restyle chip instead" },
  ]);
});

test("locked is refused, never half-honoured", () => {
  const result = restyleObjects(
    [shape("block", "rectangle", { x: 0, y: 0, width: 100, height: 100 }, { locked: true })],
    [{ objectId: "block", fill: "#0c111c" }],
  );

  assert.deepEqual(result.refused, [{ objectId: "block", reason: "locked" }]);
  assert.equal(result.elements, null);
});

test("an id the board does not carry is notOnBoard, never a silent nothing", () => {
  const result = restyleObjects([BLOCK], [{ objectId: "ref-a", fill: "#0c111c" }]);
  assert.deepEqual(result.notFound, ["ref-a"]);
});

/// Per field rather than per change: echoing a read back and changing one
/// colour spends one column, not ten.
test("a field already set to what was asked writes nothing, whatever case it was stored in", () => {
  const result = restyleObjects(
    [
      shape("block", "rectangle", { x: 0, y: 0, width: 100, height: 100 }, {
        backgroundColor: "#0C111C",
        strokeWidth: 1,
      }),
    ],
    [{ objectId: "block", fill: "#0c111c", strokeWidth: 4 }],
  );

  assert.deepEqual(result.restyled, [{ objectId: "block", set: ["strokeWidth"] }]);
  assert.equal(byId(result.elements, "block").backgroundColor, "#0C111C");
  assert.equal(byId(result.elements, "block").strokeWidth, 4);
});

test("a change asking for nothing at all, and one asking for what is already true, are unchanged", () => {
  const result = restyleObjects(
    [
      shape("block", "rectangle", { x: 0, y: 0, width: 100, height: 100 }, { opacity: 45 }),
      shape("dot", "ellipse", { x: 200, y: 0, width: 100, height: 100 }),
    ],
    [{ objectId: "block", opacity: 45 }, { objectId: "dot" }],
  );

  assert.deepEqual(result.unchanged, ["block", "dot"]);
  assert.deepEqual(result.restyled, []);
  /// The no-op skip: no revision spent, no open tab handed a conflict.
  assert.equal(result.elements, null);
});

test("rounded is one question however the two roundness models spell it", () => {
  const already = restyleObjects(
    [shape("block", "rectangle", { x: 0, y: 0, width: 100, height: 100 }, { roundness: { type: 3 } })],
    [{ objectId: "block", rounded: true }],
  );
  assert.deepEqual(already.unchanged, ["block"]);

  const squared = restyleObjects(
    [shape("block", "rectangle", { x: 0, y: 0, width: 100, height: 100 }, { roundness: { type: 3 } })],
    [{ objectId: "block", rounded: false }],
  );
  assert.equal(byId(squared.elements, "block").roundness, null);
});

/// The line's own refusal from the put, at the second door and by the same
/// module — excalidraw stores a linear element's background and draws nothing
/// with it, which is a field the model believes it set.
test("a fill on a line is refused toward stroke, and the stroke asked for still lands", () => {
  const result = restyleObjects(
    [shape("rule", "line", { x: 100, y: 900, width: 900, height: 0 }, { points: [[0, 0], [900, 0]] })],
    [{ objectId: "rule", fill: "#0c111c", stroke: "#e8d8b8" }],
  );

  assert.deepEqual(result.restyled, [
    {
      objectId: "rule",
      set: ["stroke"],
      refused: ["a line has no inside to fill — set stroke instead"],
    },
  ]);
  assert.equal(byId(result.elements, "rule").strokeColor, "#e8d8b8");
});

test("a text block takes ink, family and alignment by the names a designer says", () => {
  const result = restyleObjects(
    [words("names", "AMARA & INES", { x: 80, y: 385, width: 840, height: 120 })],
    [{ objectId: "names", colour: "#ffffff", font: "display", align: "left" }],
  );

  assert.deepEqual(result.restyled, [{ objectId: "names", set: ["colour", "font", "align"] }]);
  const line = byId(result.elements, "names");
  assert.equal(line.strokeColor, "#ffffff");
  assert.equal(line.fontFamily, FONT_FAMILIES.display);
  assert.equal(line.textAlign, "left");
});

/// The rule both text doors keep: the read reports a box off `height`, so a
/// line resized to twice the type in a box of the old height would read back as
/// a line that did not change.
test("a fontSize takes the drawn height with it", () => {
  const result = restyleObjects(
    [words("names", "AMARA & INES", { x: 80, y: 385, width: 840, height: 120 }, { fontSize: 96 })],
    [{ objectId: "names", fontSize: 220 }],
  );

  const line = byId(result.elements, "names");
  assert.equal(line.fontSize, 220);
  /// And the line breaks with it: the width is the one field a restyle never
  /// moves, so type asked to grow past it is re-broken to it rather than left
  /// running out of a box the read still reports as 840 wide.
  assert.equal(line.text, "AMARA\n& INES");
  assert.equal(line.height, Math.round(220 * TEXT_LINE_HEIGHT) * 2);
  assert.equal(line.width, 840);
  assert.equal(line.x, 80);
});

test("a paragraph resized re-wraps from what was typed, not from where it last broke", () => {
  const copy = "Sourced directly from smallholder farms and washed at altitude";
  const result = restyleObjects(
    [
      words(
        "copy",
        "Sourced directly from\nsmallholder farms and\nwashed at altitude",
        { x: 0, y: 0, width: 400, height: 50 },
        { fontSize: 13, originalText: copy },
      ),
    ],
    [{ objectId: "copy", fontSize: 26 }],
  );

  const block = byId(result.elements, "copy");
  const lines = String(block.text).split("\n");
  assert.equal(lines.join(" "), copy, "the words are the typed ones, re-broken");
  assert.ok(lines.length > 1, "twice the type takes more lines in the same width");
  assert.notEqual(block.text, "Sourced directly from\nsmallholder farms and\nwashed at altitude");
  assert.equal(block.height, Math.round(lines.length * 26 * TEXT_LINE_HEIGHT));
  assert.equal(block.originalText, copy);
});

/// The other side of the same rule as the reword door: a block left to size
/// itself has a width that is a measurement of the string it carries rather
/// than a slot anybody chose, so its breaks are not this door's to remake.
test("a block that sizes itself keeps its own breaks, and only stands taller", () => {
  const result = restyleObjects(
    [
      words(
        "typed",
        "ROOM ONE\nROOM TWO",
        { x: 0, y: 0, width: 200, height: 50 },
        { fontSize: 20, autoResize: true },
      ),
    ],
    [{ objectId: "typed", fontSize: 40 }],
  );

  const block = byId(result.elements, "typed");
  assert.equal(block.text, "ROOM ONE\nROOM TWO", "the breaks are the ones somebody typed");
  assert.equal(block.width, 200, "and the width excalidraw re-measures is left alone");
  /// The height still follows, because the read reports a box off it and the
  /// type just doubled.
  assert.equal(block.height, Math.round(2 * 40 * TEXT_LINE_HEIGHT));
});

/// A break somebody typed survives a re-wrap; the soft ones a width put in do
/// not. Both are in the same string, and only `text` ever carries the soft ones.
test("a pinned block re-wraps around the breaks that were typed into it", () => {
  const typed = "ACT ONE\nExteriors, north coast, three mornings";
  const result = restyleObjects(
    [
      words(
        "copy",
        "ACT ONE\nExteriors, north coast,\nthree mornings",
        { x: 0, y: 0, width: 260, height: 50 },
        { fontSize: 13, originalText: typed },
      ),
    ],
    [{ objectId: "copy", fontSize: 20 }],
  );

  const lines = String(byId(result.elements, "copy").text).split("\n");
  assert.equal(lines[0], "ACT ONE", "the typed break is still a break");
  assert.ok(lines.length > 2, "and the rest is re-broken to the box at the new size");
  assert.equal(lines.join(" "), typed.replace("\n", " "));
});

/// §XI.2's ceiling split, from the far side: the put's box-derived 96 is a
/// property of deriving a size from a box, and there is no box here to derive
/// one from.
test("an explicit size past the put's box ceiling is set, and one past the guard is refused", () => {
  const reached = restyleObjects(
    [words("names", "AMARA & INES", { x: 0, y: 0, width: 840, height: 120 })],
    [{ objectId: "names", fontSize: 512 }],
  );
  assert.equal(byId(reached.elements, "names").fontSize, 512);

  const refused = restyleObjects(
    [words("names", "AMARA & INES", { x: 0, y: 0, width: 840, height: 120 })],
    [{ objectId: "names", fontSize: 5120 }],
  );
  assert.equal(refused.elements, null);
  assert.match(refused.refused[0]!.reason, /fontSize is scene units/);
});

/// A photograph at 40% is a scrim with no element added to the page, and it is
/// what a model reaches for before it reaches for a rectangle.
test("opacity reaches an image, which is the cheapest scrim there is", () => {
  const result = restyleObjects(
    [photo("shot", { x: 0, y: 0, width: 1920, height: 1080 })],
    [{ objectId: "shot", opacity: 40 }],
  );

  assert.deepEqual(result.restyled, [{ objectId: "shot", set: ["opacity"] }]);
  assert.equal(byId(result.elements, "shot").opacity, 40);
});

/// Appearance is not rigid the way geometry is: a transform moves a whole group
/// because a photo torn out of its stack is broken, and recolouring one chip of
/// a palette is exactly what recolouring one chip means.
test("a grouped shape is restyled alone, where a transform would move the whole group", () => {
  const result = restyleObjects(
    [
      shape("chip-a", "rectangle", { x: 0, y: 0, width: 96, height: 128 }, {
        groupIds: ["palette"],
        backgroundColor: "#8b2f1d",
      }),
      shape("chip-b", "rectangle", { x: 100, y: 0, width: 96, height: 128 }, {
        groupIds: ["palette"],
        backgroundColor: "#0b3d2e",
      }),
    ],
    [{ objectId: "chip-a", fill: "#ffffff" }],
  );

  assert.equal(byId(result.elements, "chip-a").backgroundColor, "#ffffff");
  assert.equal(byId(result.elements, "chip-b").backgroundColor, "#0b3d2e");
});

test("two changes naming one object refuse the later, as the transform does", () => {
  const result = restyleObjects(
    [shape("block", "rectangle", { x: 0, y: 0, width: 100, height: 100 })],
    [
      { objectId: "block", fill: "#0c111c" },
      { objectId: "block", fill: "#ffffff" },
    ],
  );

  assert.deepEqual(result.restyled, [{ objectId: "block", set: ["fill"] }]);
  assert.deepEqual(result.refused, [
    { objectId: "block", reason: "already restyled by an earlier change in this call" },
  ]);
  assert.equal(byId(result.elements, "block").backgroundColor, "#0c111c");
});

/// The three sides of the dialect agreeing: what a restyle sets is what the
/// read reports, because both go through the fields `render-plan` draws with.
test("what a restyle sets, read_canvas reads back", () => {
  const result = restyleObjects(
    [pageFrame("p1", { x: 0, y: 0, ...HD }), BLOCK],
    [
      {
        objectId: "block",
        fill: "#8b2f1d",
        stroke: "#e8d8b8",
        strokeWidth: 2,
        strokeStyle: "dashed",
        rounded: true,
        opacity: 40,
      },
    ],
  );

  const object = canvasObjects(result.elements!)!.find(({ objectId }) => objectId === "block")!;
  assert.deepEqual(object, {
    objectId: "block",
    kind: "shape",
    shape: "rectangle",
    fill: "#8b2f1d",
    stroke: "#e8d8b8",
    strokeWidth: 2,
    strokeStyle: "dashed",
    rounded: true,
    opacity: 40,
    box: [0, 0, 1000, 500],
    boxUnit: "thousandths",
    z: 0,
    pageId: "p1",
  });
});

test("a page's ground is recoloured with set_page_background, not restyled", () => {
  const box = { x: 0, y: 0, width: HD.width, height: HD.height };
  const ground = {
    id: "ground",
    type: "rectangle",
    ...box,
    backgroundColor: "#0c111c",
    locked: true,
    customData: { pageBackground: true },
  } as unknown as SceneElement;
  const scene = [ground, photo("a", { x: 100, y: 100, width: 200, height: 200 }), pageFrame("page_1", box)];

  const result = restyleObjects(scene, [{ objectId: "ground", fill: "#ffffff" }]);
  assert.equal(result.elements, null);
  assert.deepEqual(result.notFound, []);
  assert.match(result.refused[0]!.reason, /set_page_background/);
});
