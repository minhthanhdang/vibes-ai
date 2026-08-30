import {
  boardPages,
  isPageElement,
  markElementAsPage,
  nextPageName,
} from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type PageTargets = {
  pages: number;
  sourcePageId: string | null;
  promotable: number;
};

export type FramePromotion = {
  id: string;
  name: string;
  customData: unknown;
};

function selectedFrames(
  elements: readonly SceneElement[],
  selectedIds: readonly string[],
): SceneElement[] {
  const chosen = new Set(selectedIds);
  return elements.filter((element) => {
    if (!chosen.has(element.id) || element.isDeleted === true) return false;
    return element.type === "frame" && !isPageElement(element);
  });
}

export function framesToPromote(
  elements: readonly SceneElement[],
  selectedIds: readonly string[],
): FramePromotion[] {
  const named: { name: string }[] = boardPages(elements).map((page) => ({ name: page.name }));
  const promotions: FramePromotion[] = [];

  for (const frame of selectedFrames(elements, selectedIds)) {
    const own = typeof frame.name === "string" ? frame.name.trim() : "";
    const name = own || nextPageName(named);
    named.push({ name });
    promotions.push({ id: frame.id, name, customData: markElementAsPage(frame).customData });
  }

  return promotions;
}

export function pageTargets(
  elements: readonly SceneElement[],
  selectedIds: readonly string[],
): PageTargets {
  const pages = boardPages(elements);
  const chosen = new Set(selectedIds);
  const source = pages.find((page) => chosen.has(page.id)) ?? null;

  return {
    pages: pages.length,
    sourcePageId: source?.id ?? null,
    promotable: framesToPromote(elements, selectedIds).length,
  };
}
