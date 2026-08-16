import { persistableElements, sceneReferenceIds, type SceneElement } from "@/lib/scene/moodboard-scene";

/// Excalidraw's element library — the panel a director adds a selection to and
/// drags back out onto any board. The editor holds it in memory and hands the
/// whole list to `onLibraryChange` after every change; persisting it is the
/// host app's job, so without this file a saved item lives exactly as long as
/// the tab does.
///
/// Nothing here knows about the canvas or the database: a library is a list of
/// named element groups, and the questions are which of a client-written list
/// is safe to store and which references its items point at.

/// The library belongs to the *project*, not the user. An item made from
/// something on the board can contain image elements, and an image element's
/// `fileId` is a `ref:` pointer that only resolves inside its own project — a
/// user-wide library would drag a project's photo onto another project's board
/// as an empty box.

/// A library this long is a scrolling panel nobody finds anything in; the cap
/// is here so one project cannot grow its row without bound. Past it the save
/// is refused rather than trimmed — dropping the tail would delete items the
/// director made and still look like a save.
export const LIBRARY_ITEM_LIMIT = 300;

/// Items hold whole element groups, so count alone does not bound the row.
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

/// Only excalidraw's own publishing flow sets `published`, and we do not run
/// one — but an imported `.excalidrawlib` carries the flag, and the panel groups
/// by it, so it is read rather than forced.
function itemStatus(value: unknown): LibraryItem["status"] {
  return value === "published" ? "published" : "unpublished";
}

/// The panel sorts by this, so a missing or nonsense timestamp lands the item at
/// the end rather than at an arbitrary point in the list.
function itemCreated(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function itemName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().slice(0, LIBRARY_ITEM_NAME_LIMIT);
  return name.length > 0 ? name : undefined;
}

/// What of the list excalidraw hands back is worth storing. Client input on the
/// way in and a row written by an older build on the way out, so both
/// directions run through here.
///
/// An item's elements go through the scene's own filter: same document, same
/// rules — tombstones dropped, ids deduplicated, everything else preserved
/// verbatim because excalidraw adds element fields every release and a
/// per-field schema would quietly strip a director's work.
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

    /// An item with nothing in it cannot be inserted and renders as a blank
    /// tile — excalidraw itself never makes one, but a hand-written list can.
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

/// Every reference the library's items point at. The panel draws its previews
/// from the same files map the canvas uses, so an item made from a photo is a
/// blank tile until these are hydrated — and the item is dragged out onto the
/// board expecting exactly the file entry a board load would have made.
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

/// A value that changes exactly when the stored library would. `onLibraryChange`
/// fires once at mount with the list the editor was initialised from, and again
/// for changes that this filter erases — comparing this against what was loaded
/// is what stops a board being opened from writing to the database.
export function libraryFingerprint(input: unknown): string {
  return JSON.stringify(persistableLibraryItems(input));
}
