import { test } from "node:test";
import assert from "node:assert/strict";

import { readableInk } from "@/lib/canvas/moodboard-palette";
import {
  blendColours,
  contrastLine,
  contrastNote,
  contrastRatio,
  contrastRead,
  paletteContrast,
  relativeLuminance,
  CONTRAST_LARGE_FONT,
} from "@/lib/render/contrast";
import { pageRenderPlan } from "@/lib/render/render-plan";
import { boardPages } from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";
import type {
  ImageDraw,
  RenderDraw,
  RenderPlan,
  ShapeDraw,
  TextDraw,
} from "@/lib/render/render-plan";

type Box = { x: number; y: number; width: number; height: number };

function text(id: string, box: Box, extra: Partial<TextDraw> = {}): TextDraw {
  return {
    kind: "text",
    id,
    box,
    angle: 0,
    opacity: 1,
    clip: null,
    text: "hello",
    fontSize: 16,
    font: { dir: "Excalifont", fallback: "cursive" },
    lineHeight: 1.25,
    colour: "#000000",
    align: "left",
    verticalAlign: "top",
    ...extra,
  };
}

function shape(id: string, box: Box, extra: Partial<ShapeDraw> = {}): ShapeDraw {
  return {
    kind: "shape",
    id,
    box,
    angle: 0,
    opacity: 1,
    clip: null,
    shape: "rectangle",
    stroke: "#1e1e1e",
    fill: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    rounded: false,
    points: null,
    arrowheads: { start: null, end: null },
    ...extra,
  };
}

function photo(id: string, box: Box, extra: Partial<ImageDraw> = {}): ImageDraw {
  return {
    kind: "image",
    id,
    box,
    angle: 0,
    opacity: 1,
    clip: null,
    referenceId: "ref",
    region: null,
    variant: "full",
    flipX: false,
    flipY: false,
    ...extra,
  };
}

function plan(draws: RenderDraw[], background = "#ffffff", scale = 1): RenderPlan {
  return {
    frame: { x: 0, y: 0, width: 900, height: 900 },
    scale,
    width: 900,
    height: 900,
    background,
    draws,
    undrawn: [],
  };
}

const PAGE: Box = { x: 0, y: 0, width: 900, height: 900 };
const LINE: Box = { x: 100, y: 100, width: 300, height: 40 };

test("black on white is WCAG's own 21:1, and a colour against itself is 1:1", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#415557", "#415557"), 1);
});

test("relative luminance is the curve the palette's own ink pick was using", () => {
  /// The refactor's proof: `readableInk` crosses over at 0.179 and both sides
  /// of that crossover still land where they did.
  assert.ok(relativeLuminance("#ffffff") > 0.179);
  assert.ok(relativeLuminance("#2c3234") < 0.179);
  assert.equal(readableInk("#ffffff"), "#1e1e1e");
  assert.equal(readableInk("#2c3234"), "#ffffff");
});

test("a blend at 0 and at 1 is the two colours it is between", () => {
  assert.equal(blendColours("#000000", "#ffffff", 0), "#000000");
  assert.equal(blendColours("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(blendColours("#000000", "#ffffff", 0.5), "#808080");
});

test("type on the page's own background is read against that background", () => {
  const read = contrastRead(plan([text("t", LINE)], "#2c3234"));
  assert.equal(read.pairs, 1);
  assert.equal(read.worst?.ground, "#2c3234");
  /// Black on charcoal: the pair this whole read exists for.
  assert.ok(read.worst!.ratio < 2);
  assert.equal(read.failing.length, 1);
});

test("a line is sampled where its ink lands, not where the rasteriser's pad reaches", () => {
  /// The half of `setOverflow` (`render-plan.ts`) that is not a log figure. A
  /// left-aligned line spills to the right, so a pad half again too wide walks
  /// the sample point right with it — off the ground the line is standing on
  /// and onto whatever is beyond it. On the development database it moved 55 of
  /// 540 lines, one page's two worst by enough to leave the page: teal type on
  /// a teal ground came back as 2.6:1 against the page behind it where the
  /// truth is 1.0:1, which is type nobody can see at all.
  const line = "a curated seasonal release designed for boutique stockists everywhere";
  const read = contrastRead(
    plan([
      shape("card", { x: 0, y: 0, width: 500, height: 200 }, { fill: "#78a8a4" }),
      text("t", { x: 100, y: 100, width: 200, height: 24 }, {
        text: line,
        fontSize: 20,
        colour: "#78a8a4",
      }),
    ]),
  );

  assert.equal(read.worst?.ground, "#78a8a4");
  assert.equal(read.worst?.ratio, 1);
});

test("the ground is the topmost filled shape under the line, not the backmost", () => {
  const read = contrastRead(
    plan([
      shape("bg", PAGE, { fill: "#2c3234" }),
      shape("card", { x: 50, y: 50, width: 400, height: 200 }, { fill: "#ffffff" }),
      text("t", LINE),
    ]),
  );
  assert.equal(read.worst?.ground, "#ffffff");
  assert.equal(read.failing.length, 0);
});

test("a translucent card is blended onto what is behind it, not read as its own hex", () => {
  /// §IX.5's third reading, as arithmetic: `#78a8a4` on a 35% `#415557` card
  /// over `#2c3234` charcoal. Unblended the card is the ground and the pair
  /// reads one way; blended it is a different colour and a different verdict.
  const card = shape("card", PAGE, { fill: "#415557", opacity: 0.35 });
  const ink = text("t", LINE, { colour: "#78a8a4" });
  const read = contrastRead(plan([shape("bg", PAGE, { fill: "#2c3234" }), card, ink]));

  assert.equal(read.worst?.ground, blendColours("#2c3234", "#415557", 0.35));
  assert.notEqual(read.worst?.ground, "#415557");
  assert.ok(read.worst!.ratio > contrastRatio("#78a8a4", "#415557"));
});

test("a line at 40% is read as the colour it lands, not the colour it stores", () => {
  const read = contrastRead(plan([text("t", LINE, { colour: "#000000", opacity: 0.4 })]));
  assert.equal(read.worst?.ink, blendColours("#ffffff", "#000000", 0.4));
  assert.ok(read.worst!.ratio < 21);
});

test("a transparent shape under the line contributes nothing and is walked past", () => {
  const read = contrastRead(
    plan([shape("frame", PAGE, { fill: "transparent" }), text("t", LINE, { colour: "#767676" })]),
  );
  assert.equal(read.worst?.ground, "#ffffff");
});

test("type over a photograph is counted rather than judged against a colour", () => {
  const read = contrastRead(
    plan([shape("bg", PAGE, { fill: "#2c3234" }), photo("p", PAGE), text("t", LINE)]),
  );
  assert.equal(read.pairs, 0);
  assert.equal(read.overImage, 1);
  assert.equal(read.worst, null);
  assert.equal(read.failing.length, 0);
});

test("type standing beside a photograph rather than on it keeps its pair", () => {
  const read = contrastRead(
    plan([
      photo("p", { x: 500, y: 500, width: 300, height: 300 }),
      text("t", LINE, { colour: "#c0c0c0" }),
    ]),
  );
  assert.equal(read.pairs, 1);
  assert.equal(read.overImage, 0);
});

test("a line below another line is not that line's ground", () => {
  const read = contrastRead(
    plan([text("under", LINE, { colour: "#ffffff" }), text("over", LINE, { colour: "#eeeeee" })]),
  );
  assert.equal(read.pairs, 2);
  for (const pair of read.failing) assert.equal(pair.ground, "#ffffff");
});

test("large type is judged at 3:1 and body copy at 4.5:1", () => {
  const grey = { colour: "#8b8b8b" };
  const big = contrastRead(plan([text("t", LINE, { ...grey, fontSize: CONTRAST_LARGE_FONT })]));
  const small = contrastRead(
    plan([text("t", LINE, { ...grey, fontSize: CONTRAST_LARGE_FONT - 1 })]),
  );
  assert.equal(big.worst?.wants, 3);
  assert.equal(small.worst?.wants, 4.5);
  assert.equal(big.failing.length, 0);
  assert.equal(small.failing.length, 1);
});

test("the size a pair is judged at is in scene units, not the picture's pixels", () => {
  /// A page rendered at half scale stores a 24px line as 12 output pixels, and
  /// judging it there would move every headline on a big page onto the body
  /// threshold.
  const read = contrastRead(
    plan([text("t", LINE, { colour: "#8b8b8b", fontSize: 12 })], "#ffffff", 0.5),
  );
  assert.equal(read.worst?.fontSize, 24);
  assert.equal(read.worst?.wants, 3);
});

test("an empty text element is no pair at all", () => {
  const read = contrastRead(plan([text("t", LINE, { text: "   " })]));
  assert.equal(read.pairs, 0);
  assert.equal(read.worst, null);
});

test("failing pairs are ranked worst first", () => {
  const read = contrastRead(
    plan([
      text("mid", { x: 0, y: 0, width: 200, height: 40 }, { colour: "#8b8b8b" }),
      text("worst", { x: 0, y: 100, width: 200, height: 40 }, { colour: "#eeeeee" }),
    ]),
  );
  assert.deepEqual(
    read.failing.map(({ textId }) => textId),
    ["worst", "mid"],
  );
  assert.equal(read.worst?.textId, "worst");
});

test("a page with no type on it says nothing rather than saying it is clear", () => {
  assert.equal(contrastLine(contrastRead(plan([shape("bg", PAGE, { fill: "#2c3234" })]))), "");
});

test("the line names the pair, its size and how many came in under it", () => {
  const line = contrastLine(
    contrastRead(plan([shape("bg", PAGE, { fill: "#2c3234" }), text("t", LINE)])),
  );
  assert.match(line, /worst pair 1\.\d:1 \(#000000 on #2c3234, 16px\), 1 of 1 under/);
});

test("the line counts the type it could not read separately from the type it could", () => {
  const line = contrastLine(
    contrastRead(
      plan([
        photo("p", { x: 0, y: 0, width: 450, height: 450 }),
        text("on", { x: 100, y: 100, width: 100, height: 40 }),
        text("off", { x: 600, y: 600, width: 100, height: 40 }),
      ]),
    ),
  );
  assert.match(line, /all 1 clear, 1 over a photograph/);
});

/// `contrastNote` — the same read, handed to the design that made the page
/// rather than to whoever reads the run log afterwards (§VIII).

test("a page whose type all clears says nothing about contrast at all", () => {
  const clear = contrastRead(plan([shape("bg", PAGE, { fill: "#2c3234" }), text("t", LINE, { colour: "#ffffff" })]));
  assert.equal(clear.failing.length, 0);
  assert.equal(contrastNote(clear), "");
  assert.equal(contrastNote(contrastRead(plan([shape("bg", PAGE)]))), "");
});

test("the note names the line, both hexes and the ratio its size wants", () => {
  const note = contrastNote(
    contrastRead(plan([shape("bg", PAGE, { fill: "#2c3234" }), text("head", LINE)])),
  );
  assert.match(note, /^The one line of type on this page stands too close in colour to what it is laid on: /);
  assert.match(note, /head is #000000 on #2c3234, 1\.\d:1 where 16px wants 4\.5\./);
  assert.match(note, /restyle_on_canvas/);
});

test("a headline is judged at the ratio a headline wants, and says so", () => {
  const note = contrastNote(
    contrastRead(
      plan([
        shape("bg", PAGE, { fill: "#2c3234" }),
        text("head", LINE, { fontSize: CONTRAST_LARGE_FONT + 8 }),
      ]),
    ),
  );
  assert.match(note, /where 32px wants 3\./);
});

test("three lines are named and the rest are counted", () => {
  const lines = [0, 1, 2, 3, 4].map((at) =>
    text(`t${at}`, { x: 100, y: 100 + at * 60, width: 300, height: 40 }, { fontSize: 16 - at }),
  );
  const read = contrastRead(plan([shape("bg", PAGE, { fill: "#2c3234" }), ...lines]));
  assert.equal(read.failing.length, 5);

  const note = contrastNote(read);
  assert.match(note, /^All 5 lines of type on this page stand too close/);
  assert.equal(note.match(/ is #000000 on #2c3234, /g)?.length, 3);
  assert.match(note, /; and 2 more\./);
});

/// The loop stage 0 closed, at the door that came after it: a bound label is
/// drawn like any other line and every canvas door refuses its id by name, so a
/// note that named one would be pointing at a handle the model cannot use.
test("a line the caller has no handle for is counted and not named", () => {
  const read = contrastRead(
    plan([
      shape("bg", PAGE, { fill: "#2c3234" }),
      text("label", LINE),
      text("loose", { x: 100, y: 300, width: 300, height: 40 }),
    ]),
  );
  assert.equal(read.failing.length, 2);

  const note = contrastNote(read, new Set(["loose"]));
  assert.match(note, /^All 2 lines of type on this page stand too close/);
  assert.match(note, /loose is #000000 on #2c3234/);
  assert.doesNotMatch(note, /label/);
  assert.match(note, /; and 1 more\./);
});

test("a page where none of the failing lines can be addressed still says how many there are", () => {
  const read = contrastRead(plan([shape("bg", PAGE, { fill: "#2c3234" }), text("label", LINE)]));
  assert.equal(
    contrastNote(read, new Set()),
    "The one line of type on this page stands too close in colour to what it is laid on.",
  );
});

/// `paletteContrast` — the same arithmetic over the brief's list rather than
/// over a finished page (§IX.3). The two palettes below are the ones every
/// Vibes run on this database was made from, and the numbers are why the
/// intention grew a clause: one of them holds a single pair that can carry a
/// caption and the other holds none at all.

const TEAL = ["#78a8a4", "#5a7476", "#415557", "#2c3234", "#344549"];
const WARM = ["#f2d4c9", "#d8bca6", "#f3e9e3", "#e19a6b", "#d8a280"];

test("a pair is said once, not once in each direction", () => {
  const { widest } = paletteContrast(["#ffffff", "#000000"]);
  assert.deepEqual(widest?.colours, ["#ffffff", "#000000"]);
  assert.equal(Math.round(widest!.ratio), 21);
  assert.equal(paletteContrast(["#ffffff", "#000000"]).body.length, 1);
});

test("the real teal brief holds exactly one pair that can carry a caption", () => {
  const { body, widest } = paletteContrast(TEAL);
  assert.deepEqual(
    body.map(({ colours }) => colours),
    [["#78a8a4", "#2c3234"]],
  );
  assert.equal(widest?.ratio.toFixed(1), "4.9");
});

test("the real warm brief holds none, and its widest pair is the finding", () => {
  const { body, large, widest } = paletteContrast(WARM);
  assert.equal(body.length, 0);
  assert.equal(large.length, 0);
  assert.deepEqual(widest?.colours, ["#f3e9e3", "#e19a6b"]);
  assert.equal(widest?.ratio.toFixed(2), "1.95");
});

test("large and body are disjoint, so a pair that carries a caption is not counted twice", () => {
  const { body, large } = paletteContrast(TEAL);
  assert.equal(large.every(({ ratio }) => ratio < 4.5 && ratio >= 3), true);
  const said = (pair: { colours: [string, string] }) => pair.colours.join("/");
  assert.equal(body.some((pair) => large.map(said).includes(said(pair))), false);
  assert.deepEqual(
    large.map(({ colours }) => colours),
    [["#78a8a4", "#344549"]],
  );
});

test("the pairs come back widest first", () => {
  const ratios = paletteContrast(["#ffffff", "#767676", "#000000", "#cccccc"]).body.map(
    ({ ratio }) => ratio,
  );
  assert.deepEqual(ratios, ratios.slice().sort((a, b) => b - a));
});

test("one colour is no pair at all", () => {
  assert.deepEqual(paletteContrast(["#2c3234"]), { body: [], large: [], widest: null });
});

/// The one reading that was taking a colour off an element the picture paints
/// nothing with. A user's line carries whatever background colour the toolbar
/// was holding when they drew it, and this used to read that colour as the
/// ground under any type standing on the line's box.
test("type over an open line stands on the page, and over a closed loop on the loop", () => {
  const scene = (points: [number, number][]): SceneElement[] => [
    { id: "p1", type: "frame", name: "p1", customData: { page: {} }, x: 0, y: 0, width: 900, height: 900 },
    { id: "l1", type: "line", x: 100, y: 100, width: 300, height: 300, backgroundColor: "#000000", points },
    { id: "t1", type: "text", text: "hello", x: 150, y: 200, width: 200, height: 40, fontSize: 16, strokeColor: "#ffffff" },
  ];
  const ground = (points: [number, number][]) => {
    const elements = scene(points);
    const read = contrastRead(pageRenderPlan(elements, boardPages(elements)[0]!));
    return read.worst;
  };

  const open = ground([[0, 0], [300, 0], [300, 300]]);
  assert.equal(open?.ground, "#ffffff");
  assert.equal(open?.ratio, 1);

  const shut = ground([[0, 0], [300, 0], [300, 300], [0, 0]]);
  assert.equal(shut?.ground, "#000000");
  assert.equal(Math.round(shut!.ratio), 21);
});
