import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BACKDROP_COVERAGE,
  OCCUPANCY_BANDS,
  bandOccupancy,
  emptyBands,
  occupancyNote,
} from "@/lib/render/occupancy";
import type { RenderDraw, RenderPlan } from "@/lib/render/render-plan";

type Box = { x: number; y: number; width: number; height: number };

function draw(id: string, box: Box, angle = 0): RenderDraw {
  return { kind: "outline", type: "rectangle", id, box, angle, opacity: 1, clip: null };
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

const round = (share: number) => Math.round(share * 1000) / 1000;

test("three bands by default, spanning the frame end to end", () => {
  const read = bandOccupancy(plan([]));
  assert.equal(read.bands.length, OCCUPANCY_BANDS);
  assert.deepEqual(
    read.bands.map(({ from, to }) => [from, to]),
    [
      [0, 1 / 3],
      [1 / 3, 2 / 3],
      [2 / 3, 1],
    ],
  );
});

test("a page with nothing on it is empty everywhere", () => {
  const read = bandOccupancy(plan([]));
  assert.deepEqual(
    read.bands.map(({ covered }) => covered),
    [0, 0, 0],
  );
  assert.equal(read.covered, 0);
  assert.deepEqual(emptyBands(read), [0, 1, 2]);
});

test("the flaw the fixtures found: content in the top two thirds, nothing at the foot", () => {
  const read = bandOccupancy(plan([draw("a", { x: 0, y: 0, width: 900, height: 600 })]));
  assert.deepEqual(
    read.bands.map(({ covered }) => round(covered)),
    [1, 1, 0],
  );
  assert.deepEqual(emptyBands(read), [2]);
  assert.equal(round(read.covered), 0.667);
});

test("a band's share is of its own area, not of the frame's", () => {
  /// A quarter-width column down the bottom third only: that band is 25% and the
  /// page is 8%, and reporting the second as the first would say the design is
  /// nearly empty where it is nearly full.
  const read = bandOccupancy(plan([draw("a", { x: 0, y: 600, width: 225, height: 300 })]));
  assert.deepEqual(
    read.bands.map(({ covered }) => round(covered)),
    [0, 0, 0.25],
  );
  assert.equal(round(read.covered), 0.083);
});

test("stacked draws cover their band once", () => {
  const stacked = [
    draw("a", { x: 0, y: 0, width: 900, height: 300 }),
    draw("b", { x: 0, y: 0, width: 900, height: 300 }),
    draw("c", { x: 100, y: 50, width: 200, height: 100 }),
  ];
  const read = bandOccupancy(plan(stacked));
  assert.equal(round(read.bands[0]!.covered), 1);
  assert.equal(round(read.covered), 0.333);
});

test("two draws overlapping partly count the overlap once", () => {
  const read = bandOccupancy(
    plan([
      draw("a", { x: 0, y: 0, width: 600, height: 300 }),
      draw("b", { x: 300, y: 0, width: 600, height: 300 }),
    ]),
  );
  assert.equal(round(read.bands[0]!.covered), 1);
});

test("a full-bleed backdrop is ground and is counted rather than covering the page", () => {
  const read = bandOccupancy(
    plan([
      draw("ground", { x: 0, y: 0, width: 900, height: 900 }),
      draw("title", { x: 100, y: 100, width: 700, height: 100 }),
    ]),
  );
  assert.equal(read.backdrops, 1);
  assert.deepEqual(emptyBands(read), [1, 2]);
  assert.ok(read.covered < 0.1);
});

test("a shape just under the backdrop threshold is content", () => {
  const height = Math.floor(900 * BACKDROP_COVERAGE) - 1;
  const read = bandOccupancy(plan([draw("panel", { x: 0, y: 0, width: 900, height })]));
  assert.equal(read.backdrops, 0);
  assert.ok(read.covered > 0.8);
});

test("a draw hanging over the edge counts only the part on the page", () => {
  const read = bandOccupancy(plan([draw("a", { x: -450, y: 600, width: 900, height: 600 })]));
  assert.deepEqual(
    read.bands.map(({ covered }) => round(covered)),
    [0, 0, 0.5],
  );
});

test("a draw entirely off the page is not read at all", () => {
  const read = bandOccupancy(plan([draw("a", { x: 2000, y: 0, width: 100, height: 100 })]));
  assert.equal(read.covered, 0);
  assert.equal(read.backdrops, 0);
});

test("rotation puts a draw in the band its corners reach", () => {
  /// A wide strip on the middle band's centre line, turned upright: unrotated it
  /// touches nothing else, rotated it runs into both neighbours.
  const box = { x: 150, y: 400, width: 600, height: 100 };
  const flat = bandOccupancy(plan([draw("a", box)]));
  const turned = bandOccupancy(plan([draw("a", box, Math.PI / 2)]));
  assert.deepEqual(emptyBands(flat), [0, 2]);
  assert.deepEqual(emptyBands(turned), []);
});

test("columns are the same read across the other axis", () => {
  const read = bandOccupancy(plan([draw("a", { x: 0, y: 0, width: 300, height: 900 })]), {
    axis: "x",
  });
  assert.equal(read.axis, "x");
  assert.deepEqual(
    read.bands.map(({ covered }) => round(covered)),
    [1, 0, 0],
  );
});

test("more bands than three is the caller's to ask for", () => {
  const read = bandOccupancy(plan([draw("a", { x: 0, y: 0, width: 900, height: 225 })]), {
    bands: 4,
  });
  assert.deepEqual(
    read.bands.map(({ covered }) => round(covered)),
    [1, 0, 0, 0],
  );
});

test("a band with a trace on it is not empty, and the floor says how much a trace is", () => {
  const read = bandOccupancy(plan([draw("a", { x: 0, y: 880, width: 90, height: 20 })]));
  assert.equal(round(read.bands[2]!.covered), 0.007);
  assert.deepEqual(emptyBands(read), [0, 1, 2]);
  assert.deepEqual(emptyBands(read, 0.005), [0, 1]);
});

test("a picture with no pixels reads as empty rather than dividing by zero", () => {
  const read = bandOccupancy(plan([draw("a", { x: 0, y: 0, width: 10, height: 10 })], 0, 0));
  assert.equal(read.covered, 0);
  assert.deepEqual(
    read.bands.map(({ covered }) => covered),
    [0, 0, 0],
  );
});

test("the note says the thirds by name, and says which of them are bare", () => {
  const note = occupancyNote(
    bandOccupancy(plan([draw("a", { x: 0, y: 300, width: 900, height: 300 })])),
  );

  assert.equal(
    note,
    "Something stands on 33% of this page: 0% of the top third, 100% of the middle third, 0% of the bottom third. Next to nothing stands in the top third or the bottom third.",
  );
});

test("the note counts the backdrop out loud rather than leaving the page reading empty", () => {
  const covering = draw("bg", { x: 0, y: 0, width: 900, height: 900 });
  const note = occupancyNote(bandOccupancy(plan([covering])));

  assert.match(
    note,
    /^Nothing stands on this page yet, not counting a draw covering the whole rectangle\.$/,
  );
  assert.match(
    occupancyNote(
      bandOccupancy(plan([covering, draw("bg2", { x: 0, y: 0, width: 900, height: 900 })])),
    ),
    /not counting 2 draws covering the whole rectangle/,
  );
});

test("a page standing on its whole frame is said without an empty clause", () => {
  const note = occupancyNote(
    bandOccupancy(plan([draw("a", { x: 0, y: 0, width: 800, height: 900 })])),
  );

  assert.equal(
    note,
    "Something stands on 89% of this page: 89% of the top third, 89% of the middle third, 89% of the bottom third.",
  );
});

/// Every band under the floor is not three bare bands worth naming — the share
/// of the whole page already said it, and "next to nothing stands in the top or
/// the middle or the bottom" is a sentence about a page that is nearly empty
/// written the longest way there is.
test("a page with a speck on it names no band as bare", () => {
  const note = occupancyNote(
    bandOccupancy(plan([draw("a", { x: 0, y: 0, width: 20, height: 900 })])),
  );

  assert.equal(
    note,
    "Something stands on 2% of this page: 2% of the top third, 2% of the middle third, 2% of the bottom third.",
  );
});

test("bands nobody has a word for are numbered rather than named, on either axis", () => {
  const across = occupancyNote(
    bandOccupancy(plan([draw("a", { x: 0, y: 0, width: 300, height: 900 })]), { axis: "x" }),
  );
  assert.match(across, /100% of the left third, 0% of the middle third, 0% of the right third/);
  assert.match(across, /Next to nothing stands in the middle third or the right third\./);

  const fifths = occupancyNote(
    bandOccupancy(plan([draw("a", { x: 0, y: 0, width: 900, height: 180 })]), { bands: 5 }),
  );
  assert.match(fifths, /100% of band 1 of 5, 0% of band 2 of 5/);
});

/// The picture and the number have to be about one rectangle (§III.3). A
/// headline set half again as wide as its box shows in the render and used to
/// be counted at the box, so a page tool could say "next to nothing stands in
/// the top third" over a picture with a title across it.
test("a headline that sets past its box is counted where it is drawn", () => {
  const headline: RenderDraw = {
    kind: "text",
    id: "t1",
    box: { x: 400, y: 0, width: 100, height: 300 },
    angle: 0,
    opacity: 1,
    clip: null,
    text: "MOUNT REYES LIGHTHOUSE",
    fontSize: 40,
    font: { dir: "Excalifont", fallback: "cursive" },
    lineHeight: 1.25,
    colour: "#000000",
    align: "center",
    verticalAlign: "middle",
  };

  /// 22 characters of 40 set 660 wide into a box 100 wide, centred: 660 of the
  /// frame's 900 across the top third, where the box alone would say 100.
  const top = bandOccupancy(plan([headline])).bands[0]!;
  assert.equal(round(top.covered), round(660 / 900));
});
