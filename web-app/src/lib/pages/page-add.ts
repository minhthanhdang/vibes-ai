import { boardItems, type Rect } from "@/lib/boards/board-contents";
import {
  boardPages,
  boardSections,
  elementBox,
  isFrameElement,
  nextPageBox,
  nextPageName,
  pageFrame,
  pageHolding,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { frameOf, type FrameBox } from "@/lib/canvas/moodboard-frames";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type AddedPage = {
  elements: SceneElement[];
  page: BoardPage;
  adopted: number;
  adoptedIds: string[];
  sections: number;
};

function drawnOver(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  sections: readonly FrameBox[],
  box: Rect,
): SceneElement[] {
  return elements.filter((element) => {
    if (element.isDeleted === true) return false;
    if (isFrameElement(element)) return false;
    if (frameOf(sections, element.frameId)) return false;
    const own = elementBox(element);
    if (!own) return false;
    if (pageHolding(pages, own)) return false;
    return centreIn(box, own);
  });
}

function centreIn(box: Rect, item: Rect) {
  const x = item.x + item.width / 2;
  const y = item.y + item.height / 2;
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

export function addPage({
  elements,
  defaultSize,
  sourcePageId,
  name,
  box,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  defaultSize: { width: number; height: number };
  sourcePageId?: string | null;
  name?: string | null;
  box?: Rect;
  makeId?: () => string;
}): AddedPage {
  const pages = boardPages(elements);
  const at =
    box ??
    nextPageBox({
      pages,
      sourcePageId,
      defaultSize,
      around: boardItems(elements),
    });

  const frame = pageFrame(at, { name: name?.trim() || nextPageName(pages), makeId });
  const sections = boardSections(elements, pages);
  const adopted = drawnOver(elements, pages, sections, at);
  const owned = new Set(adopted.map((element) => element.id));

  return {
    elements: [
      ...elements.filter((element) => !owned.has(element.id)),
      ...adopted.map((element) => ({ ...element, frameId: frame.id })),
      frame,
    ],
    page: boardPages([frame])[0]!,
    adopted: adopted.length,
    adoptedIds: adopted.map((element) => element.id),
    sections: sections.filter((section) => centreIn(at, section)).length,
  };
}
