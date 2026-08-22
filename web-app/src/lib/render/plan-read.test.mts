import { test } from "node:test";
import assert from "node:assert/strict";

import { planRead, planReadLine } from "@/lib/render/plan-read";
import type { RenderDraw, RenderPlan } from "@/lib/render/render-plan";

type Box = { x: number; y: number; width: number; height: number };

function outline(id: string, box: Box, angle = 0): RenderDraw {
  return {
    kind: "outline",
    type: "rectangle",
    id,
    box,
    angle,
    opacity: 1,
    clip: null,
  };
}

function text(id: string, box: Box): RenderDraw {
  return {
    kind: "text",
    id,
    box,
    angle: 0,
    opacity: 1,
    clip: null,
    text: "hello",
    fontSize: 20,
    font: { dir: "Excalifont", fallback: "cursive" },
    lineHeight: 1.25,
    colour: "#000000",
    align: "left",
    verticalAlign: "top",
  };
}

function plan(draws: RenderDraw[], width = 900, height = 900): RenderPlan {
  return {
    frame: { x: 0, y: 0, width, height },
    scale: 1,
    width,
    height,
    background: "#ffffff",
    draws,
    undrawn: [],
  };
}

test("what landed is counted by draw kind, in the order the kinds first appear", () => {
  const read = planRead(
    plan([
      text("a", { x: 0, y: 0, width: 100, height: 100 }),
      outline("b", { x: 0, y: 200, width: 100, height: 100 }),
      text("c", { x: 0, y: 400, width: 100, height: 100 }),
    ]),
  );
  assert.equal(read.landed, "2 text, 1 outline");
});

test("a page with nothing on it says so rather than saying '0 draws'", () => {
  assert.equal(planRead(plan([])).landed, "nothing");
});

test("ink counts overlaps twice, so a pile in one corner does not read as empty", () => {
  const box = { x: 0, y: 0, width: 450, height: 450 };
  const piled = planRead(plan([outline("a", box), outline("b", box), outline("c", box)]));
  /// Three quarter-page boxes on one spot: a quarter of the frame covered, and
  /// three quarters of it accounted for.
  assert.equal(Math.round(piled.ink * 100), 75);
  assert.equal(Math.round(piled.covered * 100), 25);
});

test("the standing line is the band shares, named the way a person says them", () => {
  const read = planRead(plan([outline("a", { x: 0, y: 300, width: 900, height: 300 })]));
  assert.equal(read.standing, "0% / 100% / 0% top-middle-bottom, top and bottom bare");
});

test("a page standing on every band names none of them bare", () => {
  /// Short of BACKDROP_COVERAGE on purpose: a draw over nine tenths of the
  /// frame is ground and would be counted out, which is a different case.
  const read = planRead(plan([outline("a", { x: 0, y: 0, width: 900, height: 720 })]));
  assert.equal(read.standing, "100% / 100% / 40% top-middle-bottom");
});

test("a full-bleed draw is said to be ground rather than counted as content", () => {
  const read = planRead(
    plan([
      outline("ground", { x: 0, y: 0, width: 900, height: 900 }),
      outline("a", { x: 0, y: 0, width: 900, height: 300 }),
    ]),
  );
  assert.equal(
    read.standing,
    "100% / 0% / 0% top-middle-bottom, 1 backdrop, middle and bottom bare",
  );
});

test("the x axis is named left-middle-right and past three the bands are numbered", () => {
  const across = planRead(plan([outline("a", { x: 0, y: 0, width: 300, height: 900 })]), {
    axis: "x",
  });
  assert.match(across.standing, /^100% \/ 0% \/ 0% left-middle-right, middle and right bare$/);

  const four = planRead(plan([outline("a", { x: 0, y: 0, width: 900, height: 225 })]), {
    bands: 4,
  });
  assert.match(
    four.standing,
    /^100% \/ 0% \/ 0% \/ 0% 4 bands, band 2 and band 3 and band 4 bare$/,
  );
});

test("the one-line read carries what landed, the ink and the bands", () => {
  const read = planRead(plan([text("a", { x: 0, y: 0, width: 900, height: 300 })]));
  assert.equal(
    planReadLine(read),
    "900x900, 1 text, 33% of the page inked, standing on 100% / 0% / 0% top-middle-bottom, middle and bottom bare, nothing within 67% bottom",
  );
});

test("the margins are the bounding box of the work, measured against the frame", () => {
  const read = planRead(plan([outline("a", { x: 90, y: 225, width: 450, height: 225 })]));
  assert.deepEqual(
    (["top", "right", "bottom", "left"] as const).map((edge) =>
      Math.round(read.margins[edge] * 100),
    ),
    [25, 40, 50, 10],
  );
  assert.equal(read.framed, "nothing within 25% top, 40% right, 50% bottom, 10% left");
});

test("a margin a designer would have chosen is not worth saying", () => {
  const read = planRead(plan([outline("a", { x: 45, y: 45, width: 810, height: 810 })]));
  assert.deepEqual(
    (["top", "right", "bottom", "left"] as const).map((edge) =>
      Math.round(read.margins[edge] * 100),
    ),
    [5, 5, 5, 5],
  );
  assert.equal(read.framed, "");
});

/// The case this read exists for: the bands clear the page and the picture does
/// not. One draw dipping into the bottom third is enough to put that band over
/// `emptyBands`' floor while a quarter of the page stays white at each end.
test("a strip floating in a frame passes the bands and is named by the margins", () => {
  const read = planRead(
    plan([
      outline("strip", { x: 0, y: 250, width: 900, height: 380 }),
      outline("caption", { x: 100, y: 630, width: 300, height: 30 }),
    ]),
  );
  assert.doesNotMatch(read.standing, /bare/);
  assert.equal(read.framed, "nothing within 28% top, 27% bottom");
});

test("a full-bleed backdrop does not answer every page with no margins", () => {
  const read = planRead(
    plan([
      outline("ground", { x: 0, y: 0, width: 900, height: 900 }),
      outline("a", { x: 300, y: 300, width: 300, height: 300 }),
    ]),
  );
  assert.equal(read.framed, "nothing within 33% top, 33% right, 33% bottom, 33% left");
});

test("a page with nothing on it is all margin", () => {
  const read = planRead(plan([]));
  assert.deepEqual(read.margins, { top: 1, right: 1, bottom: 1, left: 1 });
});

test("a frame with no area reads as no ink rather than as NaN", () => {
  const read = planRead(plan([outline("a", { x: 0, y: 0, width: 10, height: 10 })], 0, 0));
  assert.equal(read.ink, 0);
  assert.doesNotMatch(planReadLine(read), /NaN/);
});

/// The frame's own size, which is the one number the margin read is an argument
/// about and the one nothing in this project was printing.

test("the shape is the frame in scene units, not the size of the picture of it", () => {
  const page = plan([outline("a", { x: 0, y: 0, width: 100, height: 100 })], 1600, 900);
  /// What `pageRenderPlan` hands over for a 3200x1800 page: the output is capped
  /// at RENDER_MAX_DIMENSION and the frame is the page.
  const read = planRead({
    ...page,
    frame: { x: 4000, y: 2000, width: 3200, height: 1800 },
    scale: 0.5,
  });
  assert.equal(read.shape, "3200x1800");
  assert.match(planReadLine(read), /^3200x1800, /);
});

test("a fractional page is rounded rather than said to a decimal", () => {
  const read = planRead({
    ...plan([outline("a", { x: 0, y: 0, width: 10, height: 10 })]),
    frame: { x: 0, y: 0, width: 1079.6, height: 1920.4 },
  });
  assert.equal(read.shape, "1080x1920");
});
