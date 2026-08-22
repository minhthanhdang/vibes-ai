import { test } from "node:test";
import assert from "node:assert/strict";

import { readableInk } from "@/lib/canvas/moodboard-palette";
import {
  blendColours,
  contrastLine,
  contrastRatio,
  contrastRead,
  relativeLuminance,
  CONTRAST_LARGE_FONT,
} from "@/lib/render/contrast";
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
