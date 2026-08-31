import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SLIDES_PAGE_PT,
  deckSlides,
  fitCentred,
  rgbColour,
  speakerNotes,
} from "@/lib/decks/deck-plan";
import { normalizeAnalysis, type AnalysisProperties } from "@/lib/analysis/analysis";
import { boardPages, pagesInReadingOrder, type BoardPage } from "@/lib/pages/board-pages";
import { orderedPages } from "@/lib/pages/page-order";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";

const page = (id: string, size: { width: number; height: number }, name = ""): BoardPage => ({
  id,
  name,
  x: 0,
  y: 0,
  ...size,
  preset: "LANDSCAPE_HD",
  createdAs: null,
});

const noAnalyses = () => [];

test("a 16:9 page fills the slide exactly, with no offset either way", () => {
  assert.deepEqual(fitCentred(PAGE_PRESETS.LANDSCAPE_HD, SLIDES_PAGE_PT), {
    x: 0,
    y: 0,
    width: 720,
    height: 405,
  });
});

test("a portrait page is pillarboxed — full height, equal bars left and right", () => {
  const fitted = fitCentred(PAGE_PRESETS.PORTRAIT_HD, SLIDES_PAGE_PT);
  assert.equal(fitted.height, SLIDES_PAGE_PT.height);
  assert.equal(fitted.y, 0);
  assert.ok(Math.abs(fitted.x - (SLIDES_PAGE_PT.width - fitted.width) / 2) < 0.001);
  assert.ok(fitted.width < SLIDES_PAGE_PT.width);
});

test("a square page is pillarboxed the same way, and stays square", () => {
  const fitted = fitCentred(PAGE_PRESETS.SQUARE, SLIDES_PAGE_PT);
  assert.deepEqual(fitted, { x: 157.5, y: 0, width: 405, height: 405 });
});

test("a page wider than 16:9 is letterboxed instead — full width, equal bars top and bottom", () => {
  const fitted = fitCentred({ width: 2000, height: 500 }, SLIDES_PAGE_PT);
  assert.equal(fitted.width, SLIDES_PAGE_PT.width);
  assert.equal(fitted.x, 0);
  assert.equal(fitted.y, (SLIDES_PAGE_PT.height - fitted.height) / 2);
});

test("a fitted page never leaves the slide, whatever shape it is", () => {
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
    { width: 2048, height: 2048 },
    { width: 300, height: 100 },
    { width: 97, height: 4001 },
  ]) {
    const fitted = fitCentred(size, SLIDES_PAGE_PT);
    assert.ok(fitted.x >= 0 && fitted.y >= 0);
    assert.ok(fitted.x + fitted.width <= SLIDES_PAGE_PT.width + 0.001);
    assert.ok(fitted.y + fitted.height <= SLIDES_PAGE_PT.height + 0.001);
    assert.ok(fitted.width > 0 && fitted.height > 0);
  }
});

test("a page with no readable size still fits rather than dividing by zero", () => {
  const fitted = fitCentred({ width: 0, height: Number.NaN }, SLIDES_PAGE_PT);
  assert.deepEqual(fitted, { x: 157.5, y: 0, width: 405, height: 405 });
});

test("the deck's background is the board's colour, and white when it has none", () => {
  assert.deepEqual(rgbColour("#ffffff"), { red: 1, green: 1, blue: 1 });
  assert.deepEqual(rgbColour("#000000"), { red: 0, green: 0, blue: 0 });
  assert.deepEqual(rgbColour("#336699"), { red: 0.2, green: 0.4, blue: 0.6 });
  assert.deepEqual(rgbColour("#abc"), rgbColour("#aabbcc"));
  assert.deepEqual(rgbColour(null), { red: 1, green: 1, blue: 1 });
  assert.deepEqual(rgbColour("not a colour"), { red: 1, green: 1, blue: 1 });
});

const analysis = (over: Partial<AnalysisProperties>) => normalizeAnalysis(over);

test("a page with no references carries no speaker notes at all", () => {
  assert.equal(speakerNotes([]), "");
});

test("a reference's notes are its title and its non-empty dimensions, one per line", () => {
  assert.equal(
    speakerNotes([
      analysis({
        title: "Rain on glass",
        lighting: ["golden-hour", "low-key"],
        composition: ["leading-lines"],
      }),
    ]),
    "Rain on glass\nLighting: Golden hour, Low key\nComposition: Leading lines",
  );
});

test("an empty dimension is left out, not printed as a label with nothing after it", () => {
  const notes = speakerNotes([analysis({ title: "Wet asphalt", texture: ["heavy-grain"] })]);
  assert.equal(notes, "Wet asphalt\nTexture & grain: Heavy grain");
  assert.ok(!notes.includes("Lighting"));
});

test("a reference nobody has read yet adds nothing rather than an empty block", () => {
  assert.equal(speakerNotes([analysis({}), analysis({ title: "Read one" })]), "Read one");
});

test("two references on a page are two blocks, separated by a blank line", () => {
  const notes = speakerNotes([
    analysis({ title: "First", lighting: ["low-key"] }),
    analysis({ title: "Second", subject: ["portrait"] }),
  ]);
  assert.equal(notes.split("\n\n").length, 2);
});

test("the deck's slides are the pages it was handed, in that order", () => {
  const slides = deckSlides(
    [page("p1", PAGE_PRESETS.LANDSCAPE_HD, "Openers"), page("p2", PAGE_PRESETS.SQUARE)],
    "#101010",
    noAnalyses,
  );
  assert.deepEqual(
    slides.map((slide) => slide.pageId),
    ["p1", "p2"],
  );
  assert.deepEqual(
    slides.map((slide) => slide.name),
    ["Openers", "Page 2"],
  );
  assert.deepEqual(slides[0]!.background, rgbColour("#101010"));
});

test("the deck's order is previewOrder, never where the pages happen to sit on the canvas", () => {
  const elements = [
    { id: "left", type: "frame", x: 0, y: 0, width: 1920, height: 1080, customData: { page: true } },
    { id: "right", type: "frame", x: 3000, y: 0, width: 1920, height: 1080, customData: { page: true } },
  ];
  const pages = boardPages(elements);

  assert.deepEqual(
    pagesInReadingOrder(pages).map((each) => each.id),
    ["left", "right"],
  );

  const slides = deckSlides(orderedPages(pages, ["right", "left"]), null, noAnalyses);
  assert.deepEqual(
    slides.map((slide) => slide.pageId),
    ["right", "left"],
  );
});

test("a page's notes are the analyses of the references on that page, and only those", () => {
  const analyses = new Map([
    ["p1", [analysis({ title: "On page one" })]],
    ["p2", [analysis({ title: "On page two" })]],
  ]);
  const slides = deckSlides(
    [page("p1", PAGE_PRESETS.LANDSCAPE_HD), page("p2", PAGE_PRESETS.LANDSCAPE_HD)],
    null,
    (pageId) => analyses.get(pageId) ?? [],
  );
  assert.equal(slides[0]!.notes, "On page one");
  assert.equal(slides[1]!.notes, "On page two");
});
