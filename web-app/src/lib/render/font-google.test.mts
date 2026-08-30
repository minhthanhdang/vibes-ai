import { test } from "node:test";
import assert from "node:assert/strict";

import {
  defaultWeightOf,
  fallbackOfCategory,
  fontVariantKey,
  GOOGLE_FONT_INT_MIN,
  googleFamiliesOf,
  googleFontInt,
  googleFontOf,
  nearestFamilyName,
  RESERVED_FONT_INTS,
  variantOf,
  variantsSentence,
  type GoogleFamily,
} from "@/lib/render/font-google";
import { DEFAULT_SET } from "@/lib/render/font-set";

test("a variant's integer is deterministic, in range, and clear of every reserved int", () => {
  const int = googleFontInt("Playfair Display", 700, true);
  assert.equal(int, googleFontInt("Playfair Display", 700, true));
  assert.equal(int, 1_333_019_802);

  for (const [family, weight, italic] of [
    ["Playfair Display", 700, true],
    ["Inter", 400, false],
    ["Space Mono", 700, false],
    ["a", 100, false],
  ] as const) {
    const hashed = googleFontInt(family, weight, italic);
    assert.ok(hashed >= GOOGLE_FONT_INT_MIN && hashed < 2 ** 31, `${hashed} out of range`);
    assert.ok(!RESERVED_FONT_INTS.has(hashed), `${hashed} collides with a reserved int`);
  }

  assert.notEqual(googleFontInt("Inter", 400, false), googleFontInt("Inter", 700, false));
  assert.notEqual(googleFontInt("Inter", 400, false), googleFontInt("Inter", 400, true));
});

test("the ride on customData round-trips, and a stripped metric still names the face", () => {
  const font = {
    family: "Playfair Display",
    weight: 700,
    italic: true,
    set: { space: 0.255, narrow: 0.344, wide: 0.859, upper: 0.688, digit: 0.525, other: 0.517 },
    fallback: "serif",
  };
  assert.deepEqual(googleFontOf({ font }), font);

  const stripped = googleFontOf({ font: { family: "Inter", weight: 400, italic: false } });
  assert.ok(stripped);
  assert.deepEqual(stripped.set, DEFAULT_SET);
  assert.equal(stripped.fallback, "sans-serif");

  assert.equal(googleFontOf(undefined), null);
  assert.equal(googleFontOf({}), null);
  assert.equal(googleFontOf({ font: { family: "Inter" } }), null);
  assert.equal(googleFontOf({ font: { family: "", weight: 400, italic: false } }), null);
});

test("the variant key is the same whichever side computes it", () => {
  assert.equal(fontVariantKey("Playfair Display", 700, true), "playfair display|700|true");
  assert.equal(fontVariantKey("  Inter "), "inter||");
  assert.equal(fontVariantKey("INTER", undefined, false), "inter||false");
});

const PLAYFAIR: GoogleFamily = {
  family: "Playfair Display",
  variants: ["400", "500", "700", "400i", "700i"],
  category: "Serif",
  latin: true,
};

test("the metadata parse keeps the family lookup the library validates against", () => {
  const families = googleFamiliesOf({
    familyMetadataList: [
      { family: "Playfair Display", category: "Serif", subsets: ["latin"], fonts: { "400": {}, "700i": {} } },
      { family: "No Cuts", category: "Serif", subsets: ["latin"], fonts: {} },
      { family: 42, fonts: { "400": {} } },
    ],
  });
  const found = families.get("playfair display");
  assert.ok(found);
  assert.deepEqual(found.variants, ["400", "700i"]);
  assert.ok(found.latin);
  assert.equal(families.size, 1);
});

test("a family's cuts validate exactly, and the refusal lists what it has", () => {
  assert.deepEqual(variantOf(PLAYFAIR, 700, true), { weight: 700, italic: true });
  assert.equal(variantOf(PLAYFAIR, 350, false), null);
  assert.equal(variantOf(PLAYFAIR, 500, true), null);
  assert.equal(variantsSentence(PLAYFAIR), "roman 400, 500, 700; italic 400, 700");
});

test("a bare family name lands on 400, or the nearest cut weight a narrow family has", () => {
  assert.equal(defaultWeightOf(PLAYFAIR, false), 400);
  const heavy: GoogleFamily = { family: "X", variants: ["300", "700"], category: "Serif", latin: true };
  assert.equal(defaultWeightOf(heavy, false), 300);
  assert.equal(defaultWeightOf({ ...heavy, variants: ["700i"] }, false), null);
});

test("a misspelt family gets the nearest real name, and gibberish gets nothing", () => {
  const families = [PLAYFAIR, { family: "Inter", variants: ["400"], category: "Sans Serif", latin: true }];
  assert.equal(nearestFamilyName("Playfair Displayy", families), "Playfair Display");
  assert.equal(nearestFamilyName("inter", families), "Inter");
  assert.equal(nearestFamilyName("zzqqxxyy", families), null);
});

test("the fallback generic follows Google's own classification", () => {
  assert.equal(fallbackOfCategory("Serif"), "serif");
  assert.equal(fallbackOfCategory("Monospace"), "monospace");
  assert.equal(fallbackOfCategory("Handwriting"), "cursive");
  assert.equal(fallbackOfCategory("Sans Serif"), "sans-serif");
  assert.equal(fallbackOfCategory("Display"), "sans-serif");
});
