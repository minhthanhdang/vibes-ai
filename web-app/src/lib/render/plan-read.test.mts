import { test } from "node:test";
import assert from "node:assert/strict";

import { LAYOUT_TEXT_MAX_FONT } from "@/lib/layout/moodboard-layouts";
import { planRead, planReadLine } from "@/lib/render/plan-read";
import type { RenderDraw, RenderPlan, TextDraw } from "@/lib/render/render-plan";

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

function text(id: string, box: Box, extra: Partial<TextDraw> = {}): TextDraw {
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
    ...extra,
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
    "900x900, 1 text, 33% of the page inked, standing on 100% / 0% / 0% top-middle-bottom, middle and bottom bare, nothing within 67% bottom, largest type 2% of the frame, one size throughout, worst pair 21.0:1, all 1 clear",
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

/// Same reason the bands count it: the margins are the §VIII read that is
/// carrying the whole taste argument, and a headline reaching an edge in the
/// picture that reads as a third of the page empty in the numbers would send
/// the next diagnosis somewhere there is nothing wrong.
test("a headline setting past its box reaches the edge the picture shows it reaching", () => {
  const headline = text(
    "t1",
    { x: 400, y: 400, width: 100, height: 100 },
    {
      text: "MOUNT REYES LIGHTHOUSE",
      fontSize: 40,
      align: "center",
      verticalAlign: "middle",
    },
  );

  const read = planRead(plan([headline]));
  /// 573.6 wide, centred on a box 100 wide at x 400: from 163 to 737 of 900.
  assert.equal(Math.round(read.margins.left * 100), 18);
  assert.equal(Math.round(read.margins.right * 100), 18);
  /// And the box alone would have said a third of the frame clear on each side.
  assert.match(read.framed, /18% right, .*18% left/);
});

test("ink is read off the same rectangles the bands are, so it never comes in under them", () => {
  const wide = text(
    "t1",
    { x: 0, y: 0, width: 100, height: 300 },
    {
      text: "MOUNT REYES LIGHTHOUSE",
      fontSize: 40,
    },
  );

  const read = planRead(plan([wide, outline("b", { x: 0, y: 600, width: 900, height: 300 })]));
  assert.ok(read.ink >= read.covered, `${read.ink} < ${read.covered}`);
});

/// The type read: the other half of §VIII's taste flaw, which the shape and the
/// margins between them cannot see. A welcome sign on a right rectangle with a
/// headline at 3.5% of it reads as "nothing within 33% top" and nothing else.

test("the type read is the largest size against the frame, not against its own box", () => {
  const headline = text(
    "t1",
    { x: 100, y: 100, width: 40, height: 30 },
    { text: "ANNA & DAVID", fontSize: 30 },
  );

  const read = planRead(plan([headline], 900, 900));
  assert.equal(read.type?.largest, 30 / 900);
  assert.equal(read.type?.sizes, 1);
  assert.equal(read.typed, "largest type 3% of the frame, one size throughout");
});

test("the step between the sizes is said, and sizes a hair apart are one size", () => {
  const read = planRead(
    plan([
      text("t1", { x: 0, y: 0, width: 400, height: 100 }, { fontSize: 90 }),
      text("t2", { x: 0, y: 200, width: 400, height: 40 }, { fontSize: 30 }),
      text("t3", { x: 0, y: 300, width: 400, height: 40 }, { fontSize: 30.2 }),
    ]),
  );
  assert.equal(read.type?.sizes, 2);
  assert.equal(read.typed, "largest type 10% of the frame, 2 sizes, 3.0x apart");
});

test("a page with no type says nothing about type rather than saying nothing is set", () => {
  const read = planRead(plan([outline("a", { x: 0, y: 0, width: 100, height: 100 })]));
  assert.equal(read.type, null);
  assert.equal(read.typed, "");
  assert.doesNotMatch(planReadLine(read), /type/);
});

test("the wording of a line does not change how big its type is said to be", () => {
  const one = text("t1", { x: 0, y: 0, width: 400, height: 60 }, { text: "ANNA", fontSize: 50 });
  const many = text(
    "t2",
    { x: 0, y: 0, width: 400, height: 180 },
    { text: "ANNA\nAND\nDAVID", fontSize: 50 },
  );
  /// Three lines are three times the box and the same type, which is the whole
  /// reason this is read off `fontSize` rather than off the rectangle.
  assert.equal(planRead(plan([one])).type?.largest, planRead(plan([many])).type?.largest);
});

test("the type is a share of the frame, not of the picture the cap made of it", () => {
  const page = plan([text("t1", { x: 0, y: 0, width: 400, height: 200 }, { fontSize: 80 })]);
  /// What `pageRenderPlan` hands over for a 3200x1800 page: the draws and the
  /// font are scaled by the same factor the output is capped by.
  const read = planRead({
    ...page,
    frame: { x: 0, y: 0, width: 3200, height: 1800 },
    scale: 0.5,
    width: 1600,
    height: 900,
  });
  assert.equal(read.type?.largest, 80 / 900);
});

/// The ceiling: `put_on_canvas` clamps a line at `LAYOUT_TEXT_MAX_FONT`, so a
/// page whose biggest type is 96px is a page the door stopped rather than one
/// the design sized. The share alone cannot tell those apart and six iterations
/// of §VIII work read the first as the second.

test("a page sitting on the door's type ceiling says so beside the share", () => {
  const read = planRead(
    plan([
      text("t1", { x: 0, y: 0, width: 800, height: 120 }, { fontSize: LAYOUT_TEXT_MAX_FONT }),
      text("t2", { x: 0, y: 300, width: 800, height: 68 }, { fontSize: 54 }),
    ]),
    {},
  );
  assert.equal(read.type?.largestPx, LAYOUT_TEXT_MAX_FONT);
  assert.equal(read.type?.atCeiling, true);
  assert.equal(
    read.typed,
    "largest type 11% of the frame (96px, the ceiling a put sets), 2 sizes, 1.8x apart",
  );
});

test("type under the ceiling is said as a share alone, with no pixel number", () => {
  const read = planRead(
    plan([text("t1", { x: 0, y: 0, width: 800, height: 80 }, { fontSize: 64 })]),
  );
  assert.equal(read.type?.largestPx, 64);
  assert.equal(read.type?.atCeiling, false);
  assert.doesNotMatch(read.typed, /px/);
});

test("type past the ceiling is named as past it, since no put could have set it", () => {
  /// 110px on a real page, which is a put at 96 that a `transform_on_canvas`
  /// then scaled — the one page on the database over the ceiling got there
  /// that way.
  const read = planRead(
    plan([text("t1", { x: 0, y: 0, width: 800, height: 140 }, { fontSize: 110 })]),
  );
  assert.equal(read.type?.atCeiling, true);
  assert.match(read.typed, /\(110px, past the 96px a put sets\)/);
});

test("the ceiling is read in scene units, not in the picture the cap made", () => {
  const page = plan([text("t1", { x: 0, y: 0, width: 800, height: 120 }, { fontSize: 48 })]);
  /// A 3840x2160 page drawn at 1600 wide: 96px of type is 48px of picture, and
  /// a read that compared the picture's number to the constant would call this
  /// page's headline half the size the design set.
  const read = planRead({
    ...page,
    frame: { x: 0, y: 0, width: 3840, height: 2160 },
    scale: 0.5,
    width: 1600,
    height: 900,
  });
  assert.equal(read.type?.largestPx, LAYOUT_TEXT_MAX_FONT);
  assert.equal(read.type?.atCeiling, true);
});

test("the type read is said on the one line, after the framing", () => {
  const read = planRead(
    plan([text("t1", { x: 400, y: 400, width: 100, height: 100 }, { fontSize: 45 })]),
  );
  assert.match(planReadLine(read), /nothing within .*, largest type 5% of the frame, one size/);
});

test("the contrast read rides on the same line, after the type", () => {
  /// Black type on the page's own charcoal, which is the failure §IX.5's
  /// palette bullet spent four runs unable to name: both hexes fine, the pair
  /// unreadable.
  const page = plan([text("t1", { x: 400, y: 400, width: 200, height: 40 })]);
  const read = planRead({ ...page, background: "#2c3234" });
  assert.equal(read.contrast.pairs, 1);
  assert.equal(read.contrast.failing.length, 1);
  assert.match(planReadLine(read), /largest type .*, worst pair 1\.\d:1 \(#000000 on #2c3234/);
});

test("a page with no type on it carries no contrast reading and says nothing", () => {
  const read = planRead(plan([outline("a", { x: 0, y: 0, width: 100, height: 100 })]));
  assert.equal(read.contrast.pairs, 0);
  assert.equal(read.read, "");
  assert.doesNotMatch(planReadLine(read), /worst pair/);
});
