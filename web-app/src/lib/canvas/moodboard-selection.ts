import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";
import { boardPages, elementBox, pageHolds, type BoardPage } from "@/lib/pages/board-pages";
import { pageBackgroundColour } from "@/lib/pages/page-background";

/// What the board's current selection is *about*, as far as this product is
/// concerned. Excalidraw already knows how to select, move and style an
/// element; what it has no notion of is that some of those elements are
/// references with analyzed properties behind them — so the one thing worth
/// deriving from a selection is which reference the user is looking at.
///
/// No canvas and no React: a selection is an id set and an element array.

export type BoardSelection =
  /// Nothing selected, or nothing selected that this product has anything to
  /// say about — a rectangle and an arrow are excalidraw's business, not ours.
  | { kind: "none" }
  | { kind: "reference"; referenceId: string }
  | { kind: "multiple"; referenceIds: string[] }
  /// One page, on its own. The page is the second thing on this canvas with
  /// properties excalidraw has no notion of (canvas.md §XI.4): the colour it
  /// stands on is an element the editor deliberately refuses to hand over, so
  /// the panel is the only place it can be set.
  | {
      kind: "page";
      pageId: string;
      name: string;
      /// The colour the page is painted, null for one standing on nothing.
      background: string | null;
      /// The photographs on this page, so the colours offered to paint it are
      /// the colours already in it rather than a swatch book.
      referenceIds: string[];
    };

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

/// The live elements as the page reads need them, tombstones dropped: an
/// erased photograph is not on the page and an erased frame is not a page.
function liveElements(elements: unknown): SceneElement[] {
  if (!Array.isArray(elements)) return [];
  return elements.filter((entry): entry is SceneElement => {
    const element = plainObject(entry);
    return element !== null && element.isDeleted !== true && typeof element.id === "string";
  });
}

/// The photographs standing on one page (§V.3), each one once, in the scene's
/// own order — the same geometric membership every other page read asks, so the
/// colours offered for a page are the colours of what is on it.
function referencesOnPage(
  scene: readonly SceneElement[],
  pages: readonly BoardPage[],
  page: BoardPage,
): string[] {
  const referenceIds = new Set<string>();
  for (const element of scene) {
    const referenceId = referenceIdFromFileId(element.fileId);
    if (!referenceId) continue;
    const box = elementBox(element);
    if (!box || !pageHolds(pages, page, box)) continue;
    referenceIds.add(referenceId);
  }
  return [...referenceIds];
}

/// Exactly one element selected and that element a page — the rule the
/// selection-only export already answers by (`exportedFrame`), for the same
/// reason: a page picked together with something else on the canvas is a user
/// asking about both, and painting the page is not the answer to that.
function selectedPage(elements: unknown, appState: unknown): BoardSelection | null {
  const picked = selectedElementIds(appState);
  if (picked.length !== 1) return null;

  const scene = liveElements(elements);
  const pages = boardPages(scene);
  const page = pages.find((candidate) => candidate.id === picked[0]);
  if (!page) return null;

  return {
    kind: "page",
    pageId: page.id,
    name: page.name,
    background: pageBackgroundColour(scene, page),
    referenceIds: referencesOnPage(scene, pages, page),
  };
}

export function boardSelection(elements: unknown, appState: unknown): BoardSelection {
  const referenceIds = selectedReferenceIds(elements, appState);
  if (referenceIds.length === 1) return { kind: "reference", referenceId: referenceIds[0]! };
  if (referenceIds.length > 1) return { kind: "multiple", referenceIds };
  /// After the references, never before: a photograph selected on a page is a
  /// selection about the photograph, and the page is what it happens to be
  /// standing on.
  return selectedPage(elements, appState) ?? { kind: "none" };
}

/// Whether two readings of the selection are the same reading. The panel is
/// re-derived when the scene settles as well as when the selection changes —
/// a page painted from the panel must not leave the panel saying the old
/// colour — and this is what keeps that beat from re-rendering it every time.
export function sameSelection(a: BoardSelection, b: BoardSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "reference" && b.kind === "reference") return a.referenceId === b.referenceId;
  if (a.kind === "multiple" && b.kind === "multiple")
    return a.referenceIds.join() === b.referenceIds.join();
  if (a.kind === "page" && b.kind === "page")
    return (
      a.pageId === b.pageId &&
      a.name === b.name &&
      a.background === b.background &&
      a.referenceIds.join() === b.referenceIds.join()
    );
  return true;
}
