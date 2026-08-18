import { ReferenceOrigin } from "@/generated/prisma/enums";
import {
  ANALYSIS_DIMENSIONS,
  TAG_VOCABULARY,
  tagLabel,
  type AnalysisProperties,
  type TagDimension,
} from "@/lib/analysis/analysis";

/// Finding the photo to drag onto a board. Agent 2 already reads every
/// reference for lighting, texture, composition, subject and contrast — and
/// until now that vocabulary was only ever *displayed*. A user composing a
/// board asks "the low-key close-ups", not "the twenty-third thumbnail", and a
/// strip of 64px squares is the one place in the product where scrolling to
/// find one is hopeless.
///
/// No DOM, no query client, no excalidraw: the strip decides what to render
/// from this and nothing else.

/// A tag is only meaningful with its dimension — `neon` is a light and
/// `wet` is a texture, and two dimensions could one day share a term. The key
/// is what the filter stores, so it is also what the facet list hands back.
export type TagKey = `${TagDimension}:${string}`;

export function tagKey(dimension: TagDimension, tag: string): TagKey {
  return `${dimension}:${tag}`;
}

export type ReferenceFilter = {
  query: string;
  /// OR within a dimension, AND across them — the semantics of every facet
  /// list: adding a second lighting widens the set, adding a subject narrows
  /// it. The other reading (AND everywhere) makes the second click almost
  /// always produce nothing.
  tags: readonly TagKey[];
  favoritesOnly: boolean;
  /// Only the pictures the assistant drew. A generated picture is a reference
  /// in every other respect — it is in the list, it drags onto a board, it gets
  /// read by the analyzer — so the one question it raises that a photograph
  /// does not is "which of these did I not shoot", and this is that question.
  generatedOnly: boolean;
  /// Only what is not on the board already. Composing is working through a set
  /// of photos, and the question asked over and over is "which of these have I
  /// not tried yet" — which is a filter on the *board* rather than on anything
  /// agent 2 read.
  unplacedOnly: boolean;
};

/// Membership only: the strip holds a count per reference so a tile can say a
/// photo is on the board twice, and this module has no use for the number.
/// Null is "no board is open", which is not the same as "nothing is placed" —
/// it is the case where the question cannot be asked at all.
export type PlacedReferences = { has: (referenceId: string) => boolean } | null;

export const NO_REFERENCE_FILTER: ReferenceFilter = {
  query: "",
  tags: [],
  favoritesOnly: false,
  generatedOnly: false,
  unplacedOnly: false,
};

export function isFilterActive(filter: ReferenceFilter) {
  return (
    filter.query.trim().length > 0 ||
    filter.tags.length > 0 ||
    filter.favoritesOnly ||
    filter.generatedOnly ||
    filter.unplacedOnly
  );
}

export function toggledFilterTag(tags: readonly TagKey[], key: TagKey): TagKey[] {
  return tags.includes(key) ? tags.filter((tag) => tag !== key) : [...tags, key];
}

/// Every tag one reference carries, in the panel's reading order so a facet
/// list built from these comes out in the order the properties panel shows.
export function referenceTagKeys(properties: AnalysisProperties | null | undefined): TagKey[] {
  if (!properties) return [];
  return ANALYSIS_DIMENSIONS.flatMap(({ key }) =>
    properties[key].map((tag) => tagKey(key, tag)),
  );
}

/// Referenceid → its tag keys. Built by the caller from whatever read of the
/// analyzer it already has, so this module never learns about runs or polling.
export type ReferenceTagIndex = ReadonlyMap<string, readonly TagKey[]>;

export type FilterableReference = {
  id: string;
  title: string;
  isFavorite: boolean;
  /// Where the bytes came from. Optional because a caller reading a list that
  /// predates the column — or one that never selected it — is not making a
  /// claim about it, and an absent origin is read as "not generated" rather
  /// than hiding the row from an unfiltered strip.
  origin?: ReferenceOrigin | null;
};

export function isGeneratedReference(reference: FilterableReference) {
  return reference.origin === ReferenceOrigin.GENERATED;
}

const vocabularyOrder = new Map<TagKey, number>(
  ANALYSIS_DIMENSIONS.flatMap(({ key }) =>
    TAG_VOCABULARY[key].map((tag, index) => [tagKey(key, tag), index] as const),
  ),
);

export type TagFacet = { key: TagKey; tag: string; label: string; count: number };
export type DimensionFacets = { dimension: TagDimension; label: string; facets: TagFacet[] };

/// Only the tags this project's references actually carry. The vocabulary is 75
/// terms and a project is rarely more than a handful of looks: offering all of
/// them would be a list where most rows lead to nothing, which is the failure
/// mode of every unfiltered facet UI.
///
/// Counted over the references passed in, so a facet count always describes the
/// set on screen rather than the database.
export function tagFacets(
  references: readonly FilterableReference[],
  tags: ReferenceTagIndex,
): DimensionFacets[] {
  const counts = new Map<TagKey, number>();
  for (const reference of references) {
    for (const key of new Set(tags.get(reference.id) ?? [])) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return ANALYSIS_DIMENSIONS.map(({ key: dimension, label }) => ({
    dimension,
    label,
    facets: [...counts]
      .filter(([key]) => key.startsWith(`${dimension}:`))
      .map(([key, count]) => ({
        key,
        tag: key.slice(dimension.length + 1),
        label: tagLabel(key.slice(dimension.length + 1)),
        count,
      }))
      /// Commonest first — the tag that describes half the project is the one
      /// worth a click — and the vocabulary's own order to break ties, so the
      /// list does not reshuffle as counts change.
      .sort(
        (a, b) =>
          b.count - a.count ||
          (vocabularyOrder.get(a.key) ?? 0) - (vocabularyOrder.get(b.key) ?? 0),
      ),
  })).filter((group) => group.facets.length > 0);
}

function matchesQuery(reference: FilterableReference, keys: readonly TagKey[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (reference.title.toLowerCase().includes(needle)) return true;
  /// Typed against the label rather than the slug so "golden hour" finds
  /// `golden-hour`; the slug still matches, since a hyphen only ever replaces
  /// the space the label puts back.
  return keys.some((key) => {
    const tag = key.slice(key.indexOf(":") + 1);
    return tag.includes(needle) || tagLabel(tag).toLowerCase().includes(needle);
  });
}

function matchesTags(keys: readonly TagKey[], wanted: readonly TagKey[]) {
  if (!wanted.length) return true;

  const carried = new Set(keys);
  const byDimension = new Map<string, TagKey[]>();
  for (const key of wanted) {
    const dimension = key.slice(0, key.indexOf(":"));
    byDimension.set(dimension, [...(byDimension.get(dimension) ?? []), key]);
  }

  return [...byDimension.values()].every((group) => group.some((key) => carried.has(key)));
}

export function matchesReferenceFilter(
  reference: FilterableReference,
  keys: readonly TagKey[],
  filter: ReferenceFilter,
  /// Absent means no board is open, and then "unplaced" is a question with no
  /// answer — every reference matches rather than none, since hiding the whole
  /// strip is the worse of the two ways to be wrong.
  placed?: PlacedReferences,
) {
  if (filter.favoritesOnly && !reference.isFavorite) return false;
  if (filter.generatedOnly && !isGeneratedReference(reference)) return false;
  if (filter.unplacedOnly && placed?.has(reference.id)) return false;
  return matchesTags(keys, filter.tags) && matchesQuery(reference, keys, filter.query);
}

/// The strip's list. Order is the caller's — the list arrives favourites-first
/// and newest-first from the server, and a filter is not a re-sort.
export function filteredReferences<T extends FilterableReference>(
  references: readonly T[],
  tags: ReferenceTagIndex,
  filter: ReferenceFilter,
  placed?: PlacedReferences,
): T[] {
  if (!isFilterActive(filter)) return [...references];
  return references.filter((reference) =>
    matchesReferenceFilter(reference, tags.get(reference.id) ?? [], filter, placed),
  );
}
