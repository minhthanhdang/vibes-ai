import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PALETTE_LIMIT,
  TAGS_PER_DIMENSION_LIMIT,
  TAG_VOCABULARY,
  isEmptyAnalysis,
  normalizeAnalysis,
  normalizeHexColor,
  tagLabel,
} from "./analysis";

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
