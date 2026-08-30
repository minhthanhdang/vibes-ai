import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";
import { boardPages, elementBox, pageHolds, type BoardPage } from "@/lib/pages/board-pages";
import { pageBackgroundColour } from "@/lib/pages/page-background";

export type BoardSelection =
  | { kind: "none" }
  | { kind: "reference"; referenceId: string }
  | { kind: "multiple"; referenceIds: string[] }
  | {
      kind: "page";
      pageId: string;
      name: string;
      background: string | null;
      referenceIds: string[];
    };

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function selectedElementIds(appState: unknown): string[] {
  const selected = plainObject(plainObject(appState)?.selectedElementIds);
  if (!selected) return [];
  return Object.keys(selected).filter((id) => selected[id] === true);
}

export function selectionSignature(appState: unknown): string {
  return selectedElementIds(appState).sort().join(" ");
}

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

function liveElements(elements: unknown): SceneElement[] {
  if (!Array.isArray(elements)) return [];
  return elements.filter((entry): entry is SceneElement => {
    const element = plainObject(entry);
    return element !== null && element.isDeleted !== true && typeof element.id === "string";
  });
}

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
  return selectedPage(elements, appState) ?? { kind: "none" };
}

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
