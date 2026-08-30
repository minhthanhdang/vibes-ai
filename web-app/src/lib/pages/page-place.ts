import type { Rect } from "@/lib/boards/board-contents";
import { placeLinesOnBoard, type LineResult } from "@/lib/boards/board-line";
import { placeOnBoard, type PlaceResult } from "@/lib/boards/board-place";
import { elementBox, isPageElement, pageHolds, type BoardPage } from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export function placeOnPage({
  elements,
  pages,
  page,
  add = [],
  remove = [],
  sizeOf,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  pages: readonly BoardPage[];
  page: BoardPage;
  add?: readonly string[];
  remove?: readonly string[];
  sizeOf: (referenceId: string) => { width?: number | null; height?: number | null } | null | undefined;
  makeId?: () => string;
}): PlaceResult {
  const held = elementsOnPage(elements, pages, page);
  const edit = placeOnBoard({ elements: held, page, add, remove, sizeOf, makeId });
  return { ...edit, elements: intoBoard({ elements, page, held, edited: edit.elements }) };
}

export function placeLinesOnPage({
  elements,
  pages,
  page,
  add = [],
  remove = [],
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  pages: readonly BoardPage[];
  page: BoardPage;
  add?: readonly string[];
  remove?: readonly string[];
  makeId?: () => string;
}): LineResult {
  const held = elementsOnPage(elements, pages, page);
  const text = placeLinesOnBoard({ elements: held, page, add, remove, makeId });
  return { ...text, elements: intoBoard({ elements, page, held, edited: text.elements }) };
}

export function elementsOnPage(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  page: BoardPage,
): SceneElement[] {
  return elements.filter((element) => {
    if (isPageElement(element)) return false;
    const box = elementBox(element);
    return !!box && pageHolds(pages, page, box);
  });
}

function intoBoard({
  elements,
  page,
  held,
  edited,
}: {
  elements: readonly SceneElement[];
  page: BoardPage;
  held: readonly SceneElement[];
  edited: readonly SceneElement[];
}): SceneElement[] {
  const before = new Set(held.map((element) => element.id));
  const survives = new Set(edited.map((element) => element.id));

  const joining = keptInside(
    edited.filter((element) => !before.has(element.id)),
    page,
  ).map((element) => ({ ...element, frameId: page.id }));

  const out: SceneElement[] = [];
  let adopted = false;
  for (const element of elements) {
    if (before.has(element.id) && !survives.has(element.id)) continue;
    if (element.id === page.id) {
      out.push(...joining);
      adopted = true;
    }
    out.push(element);
  }
  if (!adopted) out.push(...joining);
  return out;
}

function keptInside(joining: readonly SceneElement[], page: Rect): SceneElement[] {
  const boxes = joining.map(elementBox).filter((box): box is Rect => box !== null);
  if (!boxes.length) return [...joining];

  const bounds = {
    left: Math.min(...boxes.map((box) => box.x)),
    top: Math.min(...boxes.map((box) => box.y)),
    right: Math.max(...boxes.map((box) => box.x + box.width)),
    bottom: Math.max(...boxes.map((box) => box.y + box.height)),
  };
  const dx = shift(bounds.left, bounds.right, page.x, page.x + page.width);
  const dy = shift(bounds.top, bounds.bottom, page.y, page.y + page.height);
  if (!dx && !dy) return [...joining];

  return joining.map((element) => {
    const box = elementBox(element);
    return box ? { ...element, x: round(box.x + dx), y: round(box.y + dy) } : element;
  });
}

function shift(low: number, high: number, min: number, max: number) {
  const off = high > max ? max - high : 0;
  return low + off < min ? min - low : off;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
