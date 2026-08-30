import { persistableElements, sceneReferenceIds, type SceneElement } from "@/lib/scene/moodboard-scene";

export const LIBRARY_ITEM_LIMIT = 300;

export const LIBRARY_BYTE_LIMIT = 2_000_000;

export const LIBRARY_ITEM_NAME_LIMIT = 200;

export type LibraryItem = {
  id: string;
  status: "published" | "unpublished";
  elements: SceneElement[];
  created: number;
  name?: string;
};

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function itemStatus(value: unknown): LibraryItem["status"] {
  return value === "published" ? "published" : "unpublished";
}

function itemCreated(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function itemName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().slice(0, LIBRARY_ITEM_NAME_LIMIT);
  return name.length > 0 ? name : undefined;
}

export function persistableLibraryItems(input: unknown): LibraryItem[] {
  if (!Array.isArray(input)) return [];

  const kept: LibraryItem[] = [];
  const seen = new Set<string>();

  for (const entry of input) {
    const item = plainObject(entry);
    if (!item) continue;

    const { id } = item;
    if (typeof id !== "string" || id.length === 0) continue;
    if (seen.has(id)) continue;

    const elements = persistableElements(item.elements);
    if (elements.length === 0) continue;

    seen.add(id);
    const name = itemName(item.name);
    kept.push({
      id,
      status: itemStatus(item.status),
      elements,
      created: itemCreated(item.created),
      ...(name ? { name } : {}),
    });
  }

  return kept;
}

export function libraryReferenceIds(items: readonly LibraryItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    for (const referenceId of sceneReferenceIds(item.elements)) ids.add(referenceId);
  }
  return [...ids];
}

export function libraryByteSize(items: unknown) {
  return JSON.stringify(items ?? []).length;
}

export function exceedsLibraryByteLimit(items: unknown) {
  return libraryByteSize(items) > LIBRARY_BYTE_LIMIT;
}

export function libraryFingerprint(input: unknown): string {
  return JSON.stringify(persistableLibraryItems(input));
}
