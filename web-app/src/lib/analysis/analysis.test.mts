import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANALYSIS_DIMENSIONS,
  PALETTE_LIMIT,
  analysisFields,
  TAGS_PER_DIMENSION_LIMIT,
  TAG_VOCABULARY,
  isEmptyAnalysis,
  normalizeAnalysis,
  normalizeHexColor,
  tagLabel,
} from "@/lib/analysis/analysis";

test("accepts the hex spellings the model actually returns", () => {
  assert.equal(normalizeHexColor("#FFCC00"), "#ffcc00");
  assert.equal(normalizeHexColor("ffcc00"), "#ffcc00");
  assert.equal(normalizeHexColor("  #fc0 "), "#ffcc00");
});

test("rejects anything that is not paintable", () => {
  for (const value of ["burnt sienna", "#ff", "#1234567", "rgb(1,2,3)", 16711680, null]) {
    assert.equal(normalizeHexColor(value), null, `${String(value)} should not be a colour`);
  }
});

test("keeps vocabulary tags whatever case or separator they arrive in", () => {
  const { lighting } = normalizeAnalysis({ lighting: ["Golden Hour", "LOW_KEY", " backlit "] });
  assert.deepEqual(lighting, ["golden-hour", "low-key", "backlit"]);
});

test("drops off-vocabulary tags rather than storing them", () => {
  const { subject, texture } = normalizeAnalysis({
    subject: ["portrait", "cinematic", "vibes"],
    texture: ["fine-grain", "crunchy"],
  });
  assert.deepEqual(subject, ["portrait"]);
  assert.deepEqual(texture, ["fine-grain"]);
});

test("dedupes and caps each dimension", () => {
  const analysis = normalizeAnalysis({
    colorPalette: ["#fff", "#ffffff", ...TAG_VOCABULARY.lighting.map(() => "#123456")],
    composition: [...TAG_VOCABULARY.composition, ...TAG_VOCABULARY.composition],
  });

  assert.deepEqual(analysis.colorPalette, ["#ffffff", "#123456"]);
  assert.ok(analysis.colorPalette.length <= PALETTE_LIMIT);
  assert.equal(analysis.composition.length, TAGS_PER_DIMENSION_LIMIT);
  assert.equal(new Set(analysis.composition).size, TAGS_PER_DIMENSION_LIMIT);
});

test("takes a bare string where a list was asked for", () => {
  assert.deepEqual(normalizeAnalysis({ lighting: "neon" }).lighting, ["neon"]);
});

test("survives a response that is not an object at all", () => {
  for (const raw of [null, undefined, "sorry, I cannot help with that", 42, []]) {
    const analysis = normalizeAnalysis(raw);
    assert.equal(analysis.rationale, "");
    assert.ok(isEmptyAnalysis(analysis));
  }
});

test("a single tag is enough to make an analysis non-empty", () => {
  assert.equal(isEmptyAnalysis(normalizeAnalysis({ contrastDepth: ["deep-focus"] })), false);
  assert.equal(isEmptyAnalysis(normalizeAnalysis({ colorPalette: ["#000"] })), false);
  assert.equal(isEmptyAnalysis(normalizeAnalysis({ rationale: "words only" })), true);
});

test("trims and caps the title, and answers with an empty one when the model sent none", () => {
  assert.equal(normalizeAnalysis({ title: "  Man in a lit corridor  " }).title, "Man in a lit corridor");
  assert.equal(normalizeAnalysis({ title: "x".repeat(500) }).title.length, 80);
  assert.equal(normalizeAnalysis({ title: 42 }).title, "");
  assert.equal(normalizeAnalysis({}).title, "");
});

test("a title alone does not make an analysis non-empty", () => {
  assert.equal(isEmptyAnalysis(normalizeAnalysis({ title: "Ridge at dusk" })), true);
});

test("trims a rationale but keeps it", () => {
  assert.equal(normalizeAnalysis({ rationale: "  moody  " }).rationale, "moody");
  assert.equal(normalizeAnalysis({ rationale: "x".repeat(5000) }).rationale.length, 600);
});

test("labels tags for display", () => {
  assert.equal(tagLabel("golden-hour"), "Golden hour");
  assert.equal(tagLabel("neon"), "Neon");
});

test("the vocabulary itself is unique and slug-shaped", () => {
  for (const [dimension, tags] of Object.entries(TAG_VOCABULARY)) {
    assert.equal(new Set(tags).size, tags.length, `${dimension} has a duplicate tag`);
    for (const tag of tags) {
      assert.match(tag, /^[a-z]+(-[a-z]+)*$/, `${tag} is not a slug`);
    }
  }
});

test("every dimension is answered for, labelled, and never missing", () => {
  const fields = analysisFields(normalizeAnalysis({ lighting: ["golden-hour"] }));
  for (const { key } of ANALYSIS_DIMENSIONS) assert.ok(Array.isArray(fields[key]), `${key} is missing`);
  assert.deepEqual(fields.lighting, ["Golden hour"]);
});

test("no analysis at all answers with the same shape, empty", () => {
  for (const nothing of [null, undefined, {}]) {
    const fields = analysisFields(nothing);
    for (const { key } of ANALYSIS_DIMENSIONS) assert.deepEqual(fields[key], []);
    assert.deepEqual(fields.palette, []);
    assert.equal(fields.rationale, "");
  }
});

test("the rationale is trimmed on the way out, as every answer wanted it", () => {
  assert.equal(analysisFields({ rationale: "  moody  " }).rationale, "moody");
});
