import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DECK_PDF_MAX_DIMENSION,
  DECK_PDF_MAX_POINTS,
  DECK_PDF_QUALITIES,
  deckPdfFileName,
  deckPdfPageSize,
} from "@/lib/decks/deck-pdf";
import { boardExportFileName } from "@/lib/scene/moodboard-export";

const aspectOf = ({ width, height }: { width: number; height: number }) => width / height;

test("a landscape page keeps its aspect, one point per pixel", () => {
  assert.deepEqual(deckPdfPageSize({ width: 1920, height: 1080 }), { width: 1920, height: 1080 });
});

test("a portrait page keeps its aspect", () => {
  assert.deepEqual(deckPdfPageSize({ width: 1080, height: 1920 }), { width: 1080, height: 1920 });
});

test("a square page keeps its aspect", () => {
  assert.deepEqual(deckPdfPageSize({ width: 2048, height: 2048 }), { width: 2048, height: 2048 });
});

test("a page inside PDF's 200-inch limit is left alone", () => {
  const page = { width: DECK_PDF_MAX_POINTS, height: DECK_PDF_MAX_POINTS / 2 };
  assert.deepEqual(deckPdfPageSize(page), page);
});

test("an oversized custom page is capped, and the cap preserves aspect exactly", () => {
  const page = { width: 40_000, height: 10_000 };
  const sized = deckPdfPageSize(page);
  assert.equal(sized.width, DECK_PDF_MAX_POINTS);
  assert.equal(aspectOf(sized), aspectOf(page));
  assert.ok(Math.max(sized.width, sized.height) <= DECK_PDF_MAX_POINTS);
});

test("an oversized portrait page is capped on its long edge", () => {
  const sized = deckPdfPageSize({ width: 10_000, height: 40_000 });
  assert.equal(sized.height, DECK_PDF_MAX_POINTS);
  assert.equal(sized.width, DECK_PDF_MAX_POINTS / 4);
});

test("a page with no readable size still draws something rather than nothing", () => {
  assert.deepEqual(deckPdfPageSize({ width: 0, height: Number.NaN }), { width: 1, height: 1 });
});

test("a deck's file name slugs the board title the way an image export does", () => {
  const title = "Act two — the cold half";
  assert.equal(deckPdfFileName(title), "act-two-the-cold-half.pdf");
  assert.equal(deckPdfFileName(title), boardExportFileName(title, "png").replace(/png$/, "pdf"));
});

test("an untitled or non-string board still lands as a named file", () => {
  assert.equal(deckPdfFileName(""), "moodboard.pdf");
  assert.equal(deckPdfFileName("   "), "moodboard.pdf");
  assert.equal(deckPdfFileName(null), "moodboard.pdf");
  assert.equal(deckPdfFileName(42), "moodboard.pdf");
});

test("the two qualities differ, and print is the bigger of them", () => {
  assert.deepEqual([...DECK_PDF_QUALITIES], ["screen", "print"]);
  assert.ok(DECK_PDF_MAX_DIMENSION.print > DECK_PDF_MAX_DIMENSION.screen);
});
