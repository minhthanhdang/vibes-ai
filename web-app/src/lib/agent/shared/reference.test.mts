import { test } from "node:test";
import assert from "node:assert/strict";

import { aspectLabel, CATALOG_LIMIT, digestTags, drawnFrom, referenceCatalog, referenceDigest, referenceProperties, type ToolReference, unreadReason } from "@/lib/agent/shared/reference";
import { catalogBrief } from "@/lib/agent/orchestrator/priming";

function reference(overrides: Partial<ToolReference> = {}): ToolReference {
  return {
    id: "ref-1",
    title: "Hallway",
    width: 1920,
    height: 1080,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
    ...overrides,
  };
}

test("a photograph's shape is said by the name a user uses for it", () => {
  assert.equal(aspectLabel(1920, 1080), "16:9");
  assert.equal(aspectLabel(2048, 2048), "1:1");
  assert.equal(aspectLabel(1080, 1920), "9:16");
});

test("a shape nobody has a name for is said as its own ratio", () => {
  assert.equal(aspectLabel(5568, 3712), "1.50:1");
});

test("a row with no recorded pixels has no shape rather than a made-up one", () => {
  assert.equal(aspectLabel(null, null), "unknown");
  assert.equal(aspectLabel(1920, 0), "unknown");
});

test("the digest carries the id, the shape and the tags and nothing else", () => {
  const digest = referenceDigest(
    reference({
      analysis: { lighting: ["low-key"], subject: ["interior"], colorPalette: ["#112233"] },
    }),
  );

  assert.deepEqual(digest, {
    id: "ref-1",
    title: "Hallway",
    shape: "16:9",
    tags: ["Low key", "Interior"],
  });
});

test("the palette stays out of the digest — hex codes are tokens a model cannot see", () => {
  assert.equal(digestTags({ colorPalette: ["#112233", "#445566"] }), undefined);
});

/// The argument above is about a list of every picture. It does not hold for the
/// one picture the user is asking about, and `read_references` is the door
/// that asks about one — so the two fields no digest carries are carried here.
test("the properties answer carries the palette and the rationale the digest drops", () => {
  const properties = referenceProperties(
    reference({
      analysis: {
        title: "Lit corridor",
        colorPalette: ["#112233"],
        lighting: ["low-key"],
        subject: ["interior"],
        rationale: "  Sodium light held against a cold wall.  ",
      },
    }),
  );

  assert.deepEqual(properties?.palette, ["#112233"]);
  assert.equal(properties?.rationale, "Sodium light held against a cold wall.");
  /// Per dimension, and every dimension said even when it is empty: a missing key
  /// and an empty list are the same nothing, and only one of them means the
  /// analyzer found nothing there.
  assert.deepEqual(properties?.lighting, ["Low key"]);
  assert.deepEqual(properties?.texture, []);
  assert.equal(properties?.title, "Lit corridor");
  /// Not the flattened list beside them — the same words twice, under a name that
  /// means something else on a catalog line.
  assert.equal("tags" in properties!, false);
});

/// Every field would come back empty, and an empty palette beside an empty
/// rationale reads as a picture with no colour in it. So the caller excludes it
/// rather than describing it — null is what makes that a compile-time filter.
test("a picture nobody has read has no properties answer at all", () => {
  assert.equal(referenceProperties(reference({ analysis: null, unread: "never" })), null);
  assert.equal(referenceProperties(reference()), null);
  /// An analysis row that exists and holds nothing is a different fact: it was
  /// read, and the answer says so by being there.
  assert.deepEqual(referenceProperties(reference({ analysis: {} }))?.palette, []);
});

/// The conversation the model is handed carries no tool calls, so a picture it
/// drew an hour ago is a title and a mark to it — the description behind it is
/// gone unless a door hands it back.
test("a drawn picture's own description is what the column answers with", () => {
  const drawn = reference({
    origin: "GENERATED",
    generationPrompt: "  Warm grey paper texture, lit flat, no grain  ",
  });
  assert.equal(drawnFrom(drawn), "Warm grey paper texture, lit flat, no grain");
  assert.equal(drawnFrom(reference()), undefined);
  /// A cut of a drawing inherits the provenance and not the sentence, so it is
  /// marked as drawn with nothing to quote — a blank must read as no answer
  /// rather than as an empty one.
  assert.equal(drawnFrom(reference({ origin: "GENERATED" })), undefined);
  assert.equal(drawnFrom(reference({ generationPrompt: "   " })), undefined);
});

test("the properties answer keeps the drawn mark and quotes what was asked for", () => {
  const properties = referenceProperties(
    reference({
      origin: "GENERATED",
      generationPrompt: "Dusk gradient over water",
      analysis: { rationale: "A soft horizon.", colorPalette: ["#334455"] },
    }),
  );

  assert.equal(properties?.made, true);
  assert.equal(properties?.drawnFrom, "Dusk gradient over water");
  /// Beside the reading rather than instead of it: one is the ask, the other is
  /// what a reader found in what came back.
  assert.equal(properties?.rationale, "A soft horizon.");

  const shot = referenceProperties(reference({ analysis: { rationale: "Shot at dusk." } }));
  assert.equal("made" in shot!, false);
  assert.equal("drawnFrom" in shot!, false);
});

test("a cut says which frame it came out of and what it keeps", () => {
  const digest = referenceDigest(
    reference({
      id: "cut-1",
      title: "Hallway (crop 2)",
      editIntent: "the doorway",
      source: { id: "ref-1", title: "Hallway" },
    }),
  );

  assert.equal(digest.croppedFrom, "ref-1");
  assert.equal(digest.keeps, "the doorway");
});

test("an untitled reference is still named — a blank row is unpointable", () => {
  assert.equal(referenceDigest(reference({ title: "   " })).title, "Untitled");
});

test("agent 2's name for a picture wins over the filename the browser sent", () => {
  const digest = referenceDigest(
    reference({ title: "DSC_0431.jpg", analysis: { title: "  Man alone in a lit corridor  " } }),
  );

  assert.equal(digest.title, "Man alone in a lit corridor");
});

test("a picture nobody has read keeps the name it was uploaded under", () => {
  assert.equal(referenceDigest(reference({ title: "Hallway", analysis: null })).title, "Hallway");
  assert.equal(
    referenceDigest(reference({ title: "Hallway", analysis: { title: "  " } })).title,
    "Hallway",
  );
  assert.equal(referenceDigest(reference({ title: " ", analysis: {} })).title, "Untitled");
});

test("the catalog says how many did not fit, so a truncated list is not read as the whole gallery", () => {
  const references = Array.from({ length: CATALOG_LIMIT + 5 }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const catalog = referenceCatalog(references);

  assert.equal(catalog.total, CATALOG_LIMIT + 5);
  assert.equal(catalog.shown, CATALOG_LIMIT);
  assert.equal(catalog.references.length, CATALOG_LIMIT);
});

test("a catalog that fits reports no truncation", () => {
  const catalog = referenceCatalog([reference(), reference({ id: "ref-2" })]);
  assert.equal(catalog.total, 2);
  assert.equal(catalog.shown, 2);
});

/// The head was describing an order the gallery does not use: starred first,
/// then newest. A truncated list is exactly where that matters, because it is
/// the sentence saying which photographs are *not* on the list.
test("a truncated list is described by the order it was truncated in", () => {
  const many = (over: Partial<ToolReference> = {}) =>
    Array.from({ length: CATALOG_LIMIT + 5 }, (_, index) => reference({ id: `ref-${index}`, ...over }));

  assert.match(catalogBrief(many()), /photographs\. 24 of them, newest first:/);
  assert.match(
    catalogBrief([reference({ favorite: true }), ...many().slice(1)]),
    /photographs\. 24 of them, starred first and then newest:/,
  );
});

/// Tags are the evidence the picture was read. A mark beside them would be the
/// line contradicting itself, and the toolset cannot know which to believe.
test("a picture that has tags is never marked unread", () => {
  const digest = referenceDigest(
    reference({ unread: "pending", analysis: { lighting: ["golden_hour"] } }),
  );
  assert.equal(digest.unread, undefined);
  assert.deepEqual(digest.tags, ["Golden_hour"]);
});

test("a picture's unread reason is read off its latest analyzer run", () => {
  assert.equal(unreadReason({ status: "QUEUED" }), "pending");
  assert.equal(unreadReason({ status: "RUNNING" }), "pending");
  assert.equal(unreadReason({ status: "FAILED" }), "failed");
  assert.equal(unreadReason(null), "never");
  /// A succeeded run wrote an `Analysis` row, so a succeeded run beside no
  /// properties is a picture the model found nothing in — read, not unread.
  assert.equal(unreadReason({ status: "SUCCEEDED" }), null);
});
