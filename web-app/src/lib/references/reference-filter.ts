import { ReferenceOrigin } from "@/generated/prisma/enums";
import {
  ANALYSIS_DIMENSIONS,
  TAG_VOCABULARY,
  tagLabel,
  type AnalysisProperties,
  type TagDimension,
} from "@/lib/analysis/analysis";

export type TagKey = `${TagDimension}:${string}`;

export function tagKey(dimension: TagDimension, tag: string): TagKey {
  return `${dimension}:${tag}`;
}

export type ReferenceFilter = {
  query: string;
  tags: readonly TagKey[];
  favoritesOnly: boolean;
  generatedOnly: boolean;
  unplacedOnly: boolean;
};

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

export function referenceTagKeys(properties: AnalysisProperties | null | undefined): TagKey[] {
  if (!properties) return [];
  return ANALYSIS_DIMENSIONS.flatMap(({ key }) =>
    properties[key].map((tag) => tagKey(key, tag)),
  );
}

export type ReferenceTagIndex = ReadonlyMap<string, readonly TagKey[]>;

export type FilterableReference = {
  id: string;
  title: string;
  isFavorite: boolean;
  origin?: ReferenceOrigin | null;
  generationPrompt?: string | null;
};

export function isGeneratedOrigin(origin: ReferenceOrigin | null | undefined) {
  return origin === ReferenceOrigin.GENERATED;
}

export function isGeneratedReference(reference: FilterableReference) {
  return isGeneratedOrigin(reference.origin);
}

const vocabularyOrder = new Map<TagKey, number>(
  ANALYSIS_DIMENSIONS.flatMap(({ key }) =>
    TAG_VOCABULARY[key].map((tag, index) => [tagKey(key, tag), index] as const),
  ),
);

export type TagFacet = { key: TagKey; tag: string; label: string; count: number };
export type DimensionFacets = { dimension: TagDimension; label: string; facets: TagFacet[] };

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
  if ((reference.generationPrompt ?? "").toLowerCase().includes(needle)) return true;
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
  placed?: PlacedReferences,
) {
  if (filter.favoritesOnly && !reference.isFavorite) return false;
  if (filter.generatedOnly && !isGeneratedReference(reference)) return false;
  if (filter.unplacedOnly && placed?.has(reference.id)) return false;
  return matchesTags(keys, filter.tags) && matchesQuery(reference, keys, filter.query);
}

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
