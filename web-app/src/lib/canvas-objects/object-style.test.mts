import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CANVAS_STROKE_MAX,
  CANVAS_TEXT_MAX_FONT,
  DEFAULT_INK,
  FONT_FAMILIES,
  FONT_NAMES,
  fontNameOf,
  PAGE_GROUND_INSTEAD,
  SHAPE_FILL_STYLE,
  SHAPE_ROUGHNESS,
  shapeDefaults,
  styleReading,
} from "@/lib/canvas-objects/object-style";
import { LAYOUT_TEXT_MAX_FONT, LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import { renderFont } from "@/lib/render/render-plan";

test("the five named families resolve to the five font directories the renderer mirrors", () => {
  const dirs = FONT_NAMES.map((name) => renderFont(FONT_FAMILIES[name]).dir);
  assert.deepEqual(dirs, ["Excalifont", "Liberation", "Cascadia", "Nunito", "Lilita"]);
  /// Five names, five files: a name mapping onto a family the mirror has no
  /// directory for would render as the fallback and read back as the family
  /// that was asked for — the one disagreement the picture cannot show.
  assert.equal(new Set(dirs).size, FONT_NAMES.length);
});

/// The half the put has no use for and the restyle cannot do without: a change
/// asking for a colour the object already wears has to drop that one field and
/// keep the others, which needs the columns kept apart by the field that asked
/// for them.
test("every column is recorded under the field the model said, as well as merged", () => {
  const reading = styleReading("text", { colour: "#ffffff", font: "display", fontSize: 220 });

  assert.deepEqual(reading.applied, [
    { field: "colour", writes: { strokeColor: "#ffffff" } },
    { field: "font", writes: { fontFamily: FONT_FAMILIES.display } },
    { field: "fontSize", writes: { fontSize: 220 } },
  ]);
  /// The two halves are one reading: what `applied` names is exactly what
  /// `writes` carries, so a door reading either gets the same board.
  assert.deepEqual(
    Object.assign({}, ...reading.applied.map(({ writes }) => writes)),
    reading.writes,
  );
});

test("hand is excalidraw's own family — the one an unstyled line already lands in", () => {
  assert.equal(renderFont(FONT_FAMILIES.hand).dir, renderFont(undefined).dir);
});

/// The table read backwards is what the object read says a block is set in, and
/// a name that did not come back out of the same table is a word one door takes
/// and the other refuses.
test("every family this dialect writes is a family it can name back", () => {
  for (const name of FONT_NAMES) assert.equal(fontNameOf(FONT_FAMILIES[name]), name);
  /// 2 and 9 are the same Liberation files, so the twin is sans rather than a
  /// family with no word.
  assert.equal(fontNameOf(9), "sans");
  assert.equal(renderFont(9).dir, renderFont(FONT_FAMILIES.sans).dir);
  /// Excalidraw's older faces: drawn from their own directories and named by
  /// nothing here, which is what the read's `"other"` is for.
  assert.equal(fontNameOf(1), null);
  assert.equal(fontNameOf(8), null);
});

test("a shape takes the shape fields and opacity, and nothing a text block's", () => {
  const reading = styleReading("shape", {
    fill: "#ffcc00",
    stroke: "transparent",
    strokeWidth: 4,
    strokeStyle: "dashed",
    rounded: true,
    opacity: 40,
  });
  assert.deepEqual(reading.refusals, []);
  assert.deepEqual(reading.writes, {
    backgroundColor: "#ffcc00",
    strokeColor: "transparent",
    strokeWidth: 4,
    strokeStyle: "dashed",
    roundness: { type: 3 },
    opacity: 40,
  });
});

test("a rounded line rounds the way a linear element does, and a rounded rectangle the way a box does", () => {
  assert.deepEqual(styleReading("shape", { rounded: true }, "line").writes.roundness, { type: 2 });
  assert.deepEqual(styleReading("shape", { rounded: true }, "rectangle").writes.roundness, { type: 3 });
  /// False is written rather than left out: an absent `roundness` is a shape
  /// the editor may round with whatever radius it is holding.
  assert.equal(styleReading("shape", { rounded: false }, "rectangle").writes.roundness, null);
});

test("a text block takes ink, family, alignment and size", () => {
  const reading = styleReading("text", {
    colour: "#fff",
    font: "display",
    align: "left",
    fontSize: 240,
    opacity: 90,
  });
  assert.deepEqual(reading.refusals, []);
  assert.deepEqual(reading.writes, {
    strokeColor: "#ffffff",
    fontFamily: FONT_FAMILIES.display,
    textAlign: "left",
    fontSize: 240,
    opacity: 90,
  });
});

test("opacity reaches an image and nothing else does", () => {
  assert.deepEqual(styleReading("image", { opacity: 40 }).writes, { opacity: 40 });

  const reading = styleReading("image", { fill: "#ffcc00", colour: "#000000" });
  assert.deepEqual(reading.writes, {});
  assert.deepEqual(reading.refusals, [
    "fill is a shape's, and this is an image",
    "colour is a text block's, and this is an image",
  ]);
});

/// §XI.4: the refusal names the tool rather than describing it, because both
/// agents now hold `set_page_background` — and it names it on *every* field
/// asked, since a page has no appearance but its ground whichever field the
/// model reached for.
test("a page takes no style field at all — every refusal names set_page_background", () => {
  const reading = styleReading("page", { fill: "#ffcc00", opacity: 50 });
  assert.deepEqual(reading.writes, {});
  assert.deepEqual(reading.refusals, [
    `fill is a shape's, and this is a page — ${PAGE_GROUND_INSTEAD}`,
    `opacity is a shape's, a text block's or an image's, and this is a page — ${PAGE_GROUND_INSTEAD}`,
  ]);
  assert.ok(reading.refusals.every((reason) => reason.includes("set_page_background")));
});

/// The other three kinds keep the sentence they had: only a page has one call
/// to be sent to.
test("a field refused of a shape, a text block or an image names no tool", () => {
  for (const target of ["shape", "text", "image"] as const) {
    const reading = styleReading(target, { fontSize: 40, fill: "#ffcc00", colour: "#000000" });
    assert.ok(reading.refusals.length > 0);
    assert.ok(reading.refusals.every((reason) => !reason.includes("set_page_background")));
  }
});

test("a field asked of the wrong kind is refused with a reason, never dropped", () => {
  const reading = styleReading("shape", { colour: "#000000", font: "mono", align: "left", fontSize: 40 });
  assert.deepEqual(reading.writes, {});
  assert.deepEqual(reading.refusals, [
    "colour is a text block's, and this is a shape",
    "font is a text block's, and this is a shape",
    "align is a text block's, and this is a shape",
    "fontSize is a text block's, and this is a shape",
  ]);
});

test("a line has no inside, so a fill on one is refused toward the stroke", () => {
  const reading = styleReading("shape", { fill: "#ffcc00" }, "line");
  assert.deepEqual(reading.writes, {});
  assert.match(reading.refusals[0]!, /no inside to fill/);
});

test("a colour a model turns up with is read the way the palette reads one", () => {
  assert.equal(styleReading("shape", { fill: "ffcc00" }).writes.backgroundColor, "#ffcc00");
  assert.equal(styleReading("shape", { fill: " #FC0 " }).writes.backgroundColor, "#ffcc00");
  assert.equal(styleReading("shape", { stroke: "TRANSPARENT" }).writes.strokeColor, "transparent");
});

test("type set in transparent is refused — a line nobody can read is not a colour", () => {
  const reading = styleReading("text", { colour: "transparent" });
  assert.deepEqual(reading.writes, {});
  assert.match(reading.refusals[0]!, /type nobody can read/);
});

test("a value outside its range is refused rather than quietly cut", () => {
  const out: [string, object][] = [
    ["strokeWidth", { strokeWidth: 0 }],
    ["strokeWidth", { strokeWidth: CANVAS_STROKE_MAX + 1 }],
    ["fontSize", { fontSize: LAYOUT_TEXT_MIN_FONT - 1 }],
    ["fontSize", { fontSize: CANVAS_TEXT_MAX_FONT + 1 }],
    ["opacity", { opacity: -1 }],
    ["opacity", { opacity: 101 }],
  ];
  for (const [field, asked] of out) {
    const reading = styleReading(field === "fontSize" ? "text" : "shape", asked);
    assert.deepEqual(reading.writes, {}, `${field} ${JSON.stringify(asked)} should write nothing`);
    assert.equal(reading.refusals.length, 1, `${field} ${JSON.stringify(asked)} should be refused`);
  }
});

test("an explicit size reaches past the box-derived ceiling, which is a different number", () => {
  assert.ok(CANVAS_TEXT_MAX_FONT > LAYOUT_TEXT_MAX_FONT);
  assert.equal(styleReading("text", { fontSize: CANVAS_TEXT_MAX_FONT }).writes.fontSize, CANVAS_TEXT_MAX_FONT);
});

test("a name outside the vocabulary is refused and the vocabulary is said back", () => {
  const font = styleReading("text", { font: "Helvetica" });
  assert.match(font.refusals[0]!, /hand, sans, mono, rounded, display/);
  assert.match(styleReading("shape", { strokeStyle: "wavy" }).refusals[0]!, /solid, dashed, dotted/);
  assert.match(styleReading("text", { align: "middle" }).refusals[0]!, /left, center, right/);
});

test("nothing asked writes nothing — a put with no style fields is the put it was", () => {
  assert.deepEqual(styleReading("text", {}), { writes: {}, applied: [], refusals: [] });
});

test("a shape lands flat and hard-edged, against excalidraw's sketched defaults", () => {
  const defaults = shapeDefaults({});
  assert.equal(defaults.fillStyle, SHAPE_FILL_STYLE);
  assert.equal(defaults.roughness, SHAPE_ROUGHNESS);
  assert.equal(defaults.strokeColor, DEFAULT_INK);
  assert.equal(defaults.backgroundColor, "transparent");
  assert.equal(defaults.roundness, null);
});

test("a fill with nothing said about the outline lands with no outline", () => {
  assert.equal(shapeDefaults({ fill: "#ffcc00" }).strokeColor, "transparent");
  /// Said, it is honoured — the default only fills the silence.
  assert.equal(shapeDefaults({ fill: "#ffcc00", stroke: "#000000" }).strokeColor, DEFAULT_INK);
});
