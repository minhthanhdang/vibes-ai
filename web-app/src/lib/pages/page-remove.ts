import { boardItems, type Rect } from "@/lib/boards/board-contents";
import {
  boardPages,
  boardSections,
  isFrameElement,
  pageById,
  pageElements,
  pageItems,
  type BoardPage,
} from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type PageRemovalPicture = {
  referenceId: string;
  clipped: boolean;
};

export type PageRemoval = {
  elements: SceneElement[];
  page: BoardPage;
  pictures: PageRemovalPicture[];
  lines: string[];
  unnamedImages: number;
  sections: number;
  keptInSections: number;
  emptiesBoard: boolean;
};

function centreIn(box: Rect, item: Rect) {
  const x = item.x + item.width / 2;
  const y = item.y + item.height / 2;
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

export function pageRemoval(
  elements: readonly SceneElement[],
  pageId: unknown,
): PageRemoval | null {
  const pages = boardPages(elements);
  const page = pageById(pages, pageId);
  if (!page) return null;

  const sections = boardSections(elements, pages);
  const going = pageElements(elements, pages, page, sections);
  const gone = new Set(going.map((element) => element.id));
  gone.add(page.id);

  const kept = elements
    .filter((element) => !gone.has(element.id))
    .map((element) => (element.frameId === page.id ? { ...element, frameId: null } : element));

  const on = pageItems(boardItems(going), page);
  const pictures: PageRemovalPicture[] = [];
  const at = new Map<string, number>();
  for (const item of on) {
    if (item.kind !== "image" || !item.referenceId) continue;
    const seen = at.get(item.referenceId);
    if (seen === undefined) {
      at.set(item.referenceId, pictures.length);
      pictures.push({ referenceId: item.referenceId, clipped: item.clipped });
      continue;
    }
    pictures[seen]!.clipped ||= item.clipped;
  }

  const onSections = sections.filter((section) => centreIn(page, section));
  const sectionIds = new Set(onSections.map((section) => section.id));

  return {
    elements: kept,
    page,
    pictures,
    lines: on
      .filter((item) => item.kind === "text")
      .map((item) => (item.text ?? "").trim())
      .filter(Boolean),
    unnamedImages: on.filter((item) => item.kind === "image" && !item.referenceId).length,
    sections: onSections.length,
    keptInSections: elements.filter(
      (element) =>
        element.isDeleted !== true &&
        !isFrameElement(element) &&
        typeof element.frameId === "string" &&
        sectionIds.has(element.frameId),
    ).length,
    emptiesBoard: pages.length === 1,
  };
}
