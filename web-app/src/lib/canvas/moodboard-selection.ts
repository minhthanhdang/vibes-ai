import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

/// What the board's current selection is *about*, as far as this product is
/// concerned. Excalidraw already knows how to select, move and style an
/// element; what it has no notion of is that some of those elements are
/// references with analyzed properties behind them — so the one thing worth
/// deriving from a selection is which reference the director is looking at.
///
/// No canvas and no React: a selection is an id set and an element array.

export type BoardSelection =
  /// Nothing selected, or nothing selected that points at a reference — a
  /// rectangle and an arrow are excalidraw's business, not ours.
  | { kind: "none" }
  | { kind: "reference"; referenceId: string }
  | { kind: "multiple"; referenceIds: string[] };

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/// Excalidraw stores the selection as an id→true map, and leaves `false`
/// entries behind rather than deleting keys, so the keys alone overstate it.
export function selectedElementIds(appState: unknown): string[] {
  const selected = plainObject(plainObject(appState)?.selectedElementIds);
  if (!selected) return [];
  return Object.keys(selected).filter((id) => selected[id] === true);
}

/// A cheap value that changes exactly when the selection does. `onChange` fires
/// on every frame of a drag with the same selection, and resolving a selection
/// walks the whole element array — comparing this first is what keeps a drag
/// from costing a scan per frame. Sorted because the map's key order is
/// insertion order, and shift-clicking two elements in the other order is the
/// same selection.
export function selectionSignature(appState: unknown): string {
  return selectedElementIds(appState).sort().join(" ");
}

/// The references under the current selection, in z-order, each one once — the
/// same photo dropped twice and both copies selected is still one reference to
/// show properties for.
export function selectedReferenceIds(elements: unknown, appState: unknown): string[] {
  const selected = new Set(selectedElementIds(appState));
  if (selected.size === 0 || !Array.isArray(elements)) return [];

  const referenceIds = new Set<string>();
  for (const entry of elements) {
    const element = plainObject(entry) as SceneElement | null;
    if (!element || element.isDeleted === true) continue;
    if (typeof element.id !== "string" || !selected.has(element.id)) continue;

    const referenceId = referenceIdFromFileId(element.fileId);
    if (referenceId) referenceIds.add(referenceId);
  }

  return [...referenceIds];
}

export function boardSelection(elements: unknown, appState: unknown): BoardSelection {
  const referenceIds = selectedReferenceIds(elements, appState);
  if (referenceIds.length === 0) return { kind: "none" };
  if (referenceIds.length === 1) return { kind: "reference", referenceId: referenceIds[0]! };
  return { kind: "multiple", referenceIds };
}
