import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeAnalysis } from "@/lib/analysis/analysis";
import { galleryAnalysisIndex } from "@/lib/analysis/gallery-analysis";
import {
  NO_REFERENCE_FILTER,
  filteredReferences,
  isFilterActive,
  isGeneratedReference,
  matchesReferenceFilter,
  referenceTagKeys,
  tagFacets,
  tagKey,
  toggledFilterTag,
  type FilterableReference,
  type ReferenceFilter,
  type ReferenceTagIndex,
  type TagKey,
} from "@/lib/references/reference-filter";

const reference = (id: string, over: Partial<FilterableReference> = {}): FilterableReference => ({
  id,
  title: "",
  isFavorite: false,
  ...over,
});

const tagsOf = (entries: Record<string, TagKey[]>): ReferenceTagIndex =>
  new Map(Object.entries(entries));

const filter = (over: Partial<ReferenceFilter> = {}): ReferenceFilter => ({
  ...NO_REFERENCE_FILTER,
  ...over,
});

test("an inactive filter returns the list unchanged, order included", () => {
  const list = [reference("a"), reference("b"), reference("c")];
  assert.deepEqual(
    filteredReferences(list, tagsOf({}), NO_REFERENCE_FILTER).map((r) => r.id),
    ["a", "b", "c"],
  );
  assert.equal(isFilterActive(NO_REFERENCE_FILTER), false);
  assert.equal(isFilterActive(filter({ query: "   " })), false);
  assert.equal(isFilterActive(filter({ favoritesOnly: true })), true);
});

test("tags read off an analysis carry their dimension", () => {
  const properties = normalizeAnalysis({ lighting: ["neon"], subject: ["street"] });
  assert.deepEqual(referenceTagKeys(properties), ["lighting:neon", "subject:street"]);
  assert.deepEqual(referenceTagKeys(null), []);
});

test("two tags in one dimension widen the set, two dimensions narrow it", () => {
  const list = [reference("a"), reference("b"), reference("c")];
  const tags = tagsOf({
    a: ["lighting:neon", "composition:close-up"],
    b: ["lighting:golden-hour", "composition:wide-shot"],
    c: ["lighting:neon", "composition:wide-shot"],
  });

  const oneLight = filteredReferences(list, tags, filter({ tags: ["lighting:neon"] }));
  assert.deepEqual(oneLight.map((r) => r.id), ["a", "c"]);

  const twoLights = filteredReferences(
    list,
    tags,
    filter({ tags: ["lighting:neon", "lighting:golden-hour"] }),
  );
  assert.deepEqual(twoLights.map((r) => r.id), ["a", "b", "c"]);

  const acrossDimensions = filteredReferences(
    list,
    tags,
    filter({ tags: ["lighting:neon", "composition:wide-shot"] }),
  );
  assert.deepEqual(acrossDimensions.map((r) => r.id), ["c"]);
});

test("a reference with no analysis yet matches no tag filter", () => {
  const list = [reference("a"), reference("pending")];
  const tags = tagsOf({ a: ["subject:portrait"] });
  assert.deepEqual(
    filteredReferences(list, tags, filter({ tags: ["subject:portrait"] })).map((r) => r.id),
    ["a"],
  );
});

test("the query matches a title, a tag slug and the tag's label alike", () => {
  const list = [
    reference("titled", { title: "Alley at night" }),
    reference("tagged"),
    reference("neither"),
  ];
  const tags = tagsOf({ tagged: ["lighting:golden-hour"] });

  const byTitle = filteredReferences(list, tags, filter({ query: "ALLEY" }));
  assert.deepEqual(byTitle.map((r) => r.id), ["titled"]);

  for (const query of ["golden-hour", "golden hour", "Golden Hour"]) {
    assert.deepEqual(
      filteredReferences(list, tags, filter({ query })).map((r) => r.id),
      ["tagged"],
      query,
    );
  }
});

test("favourites-only composes with the other two rather than replacing them", () => {
  const list = [
    reference("a", { isFavorite: true }),
    reference("b", { isFavorite: true }),
    reference("c"),
  ];
  const tags = tagsOf({ a: ["texture:haze"], b: [], c: ["texture:haze"] });

  assert.deepEqual(
    filteredReferences(list, tags, filter({ favoritesOnly: true })).map((r) => r.id),
    ["a", "b"],
  );
  assert.deepEqual(
    filteredReferences(list, tags, filter({ favoritesOnly: true, tags: ["texture:haze"] })).map(
      (r) => r.id,
    ),
    ["a"],
  );
});

test("facets offer only the tags the shown references carry, commonest first", () => {
  const list = [reference("a"), reference("b"), reference("c")];
  const tags = tagsOf({
    a: ["lighting:neon", "subject:street"],
    b: ["lighting:neon"],
    c: ["lighting:low-key"],
  });

  const groups = tagFacets(list, tags);
  assert.deepEqual(
    groups.map((group) => group.dimension),
    ["lighting", "subject"],
  );

  const lighting = groups[0]!;
  assert.deepEqual(
    lighting.facets.map((facet) => [facet.tag, facet.count]),
    [
      ["neon", 2],
      ["low-key", 1],
    ],
  );
  assert.equal(lighting.facets[1]!.label, "Low key");
  assert.equal(lighting.facets[0]!.key, tagKey("lighting", "neon"));
});

test("a facet count is of the references passed in, not of the vocabulary", () => {
  const tags = tagsOf({ a: ["subject:water"], b: ["subject:water"] });
  assert.equal(tagFacets([reference("a")], tags)[0]!.facets[0]!.count, 1);
  assert.equal(tagFacets([reference("a"), reference("b")], tags)[0]!.facets[0]!.count, 2);
  assert.deepEqual(tagFacets([], tags), []);
});

test("a repeated tag on one reference counts once", () => {
  const tags = tagsOf({ a: ["subject:water", "subject:water"] });
  assert.equal(tagFacets([reference("a")], tags)[0]!.facets[0]!.count, 1);
});

test("toggling a tag adds it once and removes it once", () => {
  const added = toggledFilterTag([], "lighting:neon");
  assert.deepEqual(added, ["lighting:neon"]);
  assert.deepEqual(toggledFilterTag(added, "lighting:neon"), []);
  assert.deepEqual(toggledFilterTag(added, "subject:street"), ["lighting:neon", "subject:street"]);
});

/// The contract that matters at the seam: the strip builds its tag index out of
/// the same read the gallery polls, so a facet the user clicks has to be
/// exactly what agent 2 wrote for that reference.
test("the tag index built from the gallery's analyzer read filters that reference", () => {
  const index = galleryAnalysisIndex({
    analyses: [
      { referenceId: "a", ...normalizeAnalysis({ lighting: ["low-key"], subject: ["portrait"] }) },
    ],
    runs: [{ input: { referenceId: "b" }, status: "RUNNING", error: null }],
  });

  const view = index.get("a");
  const keys = referenceTagKeys(view?.kind === "ready" ? view.properties : null);
  const tags = tagsOf({ a: keys });

  assert.deepEqual(tagFacets([reference("a")], tags).map((group) => group.dimension), [
    "lighting",
    "subject",
  ]);
  assert.equal(
    matchesReferenceFilter(reference("a"), keys, filter({ tags: ["lighting:low-key"] })),
    true,
  );
  assert.equal(
    matchesReferenceFilter(reference("a"), keys, filter({ tags: ["lighting:high-key"] })),
    false,
  );
  /// A reference whose run is still going has no tags at all, so it is out of
  /// every tag filter until the analyzer lands.
  assert.equal(index.get("b")?.kind, "pending");
  assert.equal(
    matchesReferenceFilter(reference("b"), [], filter({ tags: ["lighting:low-key"] })),
    false,
  );
});

const placedSet = (...ids: string[]) => new Set(ids);

test("the unused filter hides what the open board already shows", () => {
  const list = [reference("a"), reference("b"), reference("c")];
  const placed = placedSet("a", "c");

  assert.deepEqual(
    filteredReferences(list, tagsOf({}), filter({ unplacedOnly: true }), placed).map((r) => r.id),
    ["b"],
  );
  assert.equal(isFilterActive(filter({ unplacedOnly: true })), true);
});

/// Placement is a filter on the board, tags are a filter on what agent 2 saw —
/// asking both narrows, the same as any two dimensions do.
test("unused composes with the tag and favourite filters", () => {
  const list = [reference("a", { isFavorite: true }), reference("b", { isFavorite: true })];
  const tags = tagsOf({ a: ["lighting:neon"], b: ["lighting:neon"] });

  assert.deepEqual(
    filteredReferences(
      list,
      tags,
      filter({ unplacedOnly: true, favoritesOnly: true, tags: ["lighting:neon"] }),
      placedSet("a"),
    ).map((r) => r.id),
    ["b"],
  );
});

/// No board open is not "nothing is placed": the strip cannot answer the
/// question, and hiding every reference is the worse of the two ways to be
/// wrong.
test("with no board open the unused filter hides nothing", () => {
  const list = [reference("a"), reference("b")];

  assert.deepEqual(
    filteredReferences(list, tagsOf({}), filter({ unplacedOnly: true })).map((r) => r.id),
    ["a", "b"],
  );
  assert.equal(matchesReferenceFilter(reference("a"), [], filter({ unplacedOnly: true })), true);
  assert.equal(
    matchesReferenceFilter(reference("a"), [], filter({ unplacedOnly: true }), placedSet("a")),
    false,
  );
});

/// A picture the assistant drew is a reference in every other respect, so the
/// only thing this filter can be asked to do is separate the two kinds — and a
/// row that never said where it came from is a photograph as far as the strip
/// is concerned.
test("the generated filter keeps the drawn pictures and nothing else", () => {
  const list = [
    reference("uploaded", { origin: "UPLOADED" }),
    reference("imported", { origin: "IMPORTED" }),
    reference("drawn", { origin: "GENERATED" }),
    reference("unsaid"),
  ];

  assert.deepEqual(
    filteredReferences(list, tagsOf({}), filter({ generatedOnly: true })).map((r) => r.id),
    ["drawn"],
  );
  assert.deepEqual(
    filteredReferences(list, tagsOf({}), NO_REFERENCE_FILTER).map((r) => r.id),
    ["uploaded", "imported", "drawn", "unsaid"],
  );
  assert.equal(isFilterActive(filter({ generatedOnly: true })), true);
  assert.equal(isGeneratedReference(reference("drawn", { origin: "GENERATED" })), true);
  assert.equal(isGeneratedReference(reference("unsaid")), false);
});

/// Same AND-across-dimensions the rest of the controls hold to: asking for the
/// drawn ones and for the starred ones is asking for the pictures that are both.
test("the generated filter narrows with the others rather than replacing them", () => {
  const list = [
    reference("drawn-star", { origin: "GENERATED", isFavorite: true, title: "warm paper" }),
    reference("drawn-plain", { origin: "GENERATED" }),
    reference("shot-star", { isFavorite: true, title: "warm paper" }),
  ];

  assert.deepEqual(
    filteredReferences(
      list,
      tagsOf({}),
      filter({ generatedOnly: true, favoritesOnly: true, query: "paper" }),
    ).map((r) => r.id),
    ["drawn-star"],
  );
  assert.equal(
    matchesReferenceFilter(list[1]!, [], filter({ generatedOnly: true, favoritesOnly: true })),
    false,
  );
});
