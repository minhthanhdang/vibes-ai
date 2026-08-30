import type { Rect } from "@/lib/boards/board-contents";
import {
  boardPages,
  elementBox,
  isPageElement,
  pageById,
  pageChildOrder,
  pageElements,
  pageReadingOrder,
  type BoardPage,
  type PageSizeLabel,
} from "@/lib/pages/board-pages";
import { resizedPageBackground } from "@/lib/pages/page-background";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

export type PageResizeContents = {
  pictures: string[];
  lines: string[];
};

export type PageResize = {
  elements: SceneElement[];
  page: BoardPage;
  was: { width: number; height: number; preset: PageSizeLabel };
  fellOff: PageResizeContents;
  joined: PageResizeContents;
  clipped: string[];
  overlaps: BoardPage[];
  adoptedIds: string[];
  releasedIds: string[];
};

type Boxed = Rect & { element: SceneElement };

function boxed(elements: readonly SceneElement[]): Boxed[] {
  const placed: Boxed[] = [];
  for (const element of elements) {
    const box = elementBox(element);
    if (box) placed.push({ ...box, element });
  }
  return placed;
}

function contentsSaid(elements: readonly SceneElement[], rect: Rect): PageResizeContents {
  const pictures: string[] = [];
  const lines: string[] = [];

  for (const { element } of pageReadingOrder(boxed(elements), rect)) {
    if (element.type === "image") {
      const referenceId = referenceIdFromFileId(element.fileId);
      if (referenceId && !pictures.includes(referenceId)) pictures.push(referenceId);
      continue;
    }
    if (element.type !== "text") continue;
    const text = typeof element.text === "string" ? element.text.trim() : "";
    if (text) lines.push(text);
  }

  return { pictures, lines };
}

function crossesEdge(box: Rect, page: Rect) {
  return (
    box.x < page.x ||
    box.y < page.y ||
    box.x + box.width > page.x + page.width ||
    box.y + box.height > page.y + page.height
  );
}

function intersects(one: Rect, other: Rect) {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  );
}

export function resizePage({
  elements,
  pageId,
  size,
}: {
  elements: readonly SceneElement[];
  pageId: unknown;
  size: { width: number; height: number };
}): PageResize | null {
  const pages = boardPages(elements);
  const page = pageById(pages, pageId);
  if (!page || !(size.width > 0) || !(size.height > 0)) return null;

  const resized = elements.map((element) =>
    element.id === page.id && isPageElement(element)
      ? { ...element, width: size.width, height: size.height }
      : element,
  );

  const after = boardPages(resized);
  const now = pageById(after, page.id)!;

  const wider = resizedPageBackground(resized, page, now);

  const before = pageElements(elements, pages, page);
  const kept = pageElements(wider, after, now);
  const keptIds = new Set(kept.map((element) => element.id));
  const beforeIds = new Set(before.map((element) => element.id));

  const adoptedIds: string[] = [];
  const releasedIds: string[] = [];
  const rehung = wider.map((element) => {
    if (keptIds.has(element.id) && element.frameId !== page.id) {
      adoptedIds.push(element.id);
      return { ...element, frameId: page.id };
    }
    if (!keptIds.has(element.id) && element.frameId === page.id) {
      releasedIds.push(element.id);
      return { ...element, frameId: null };
    }
    return element;
  });

  return {
    elements: adoptedIds.length ? pageChildOrder(rehung) : rehung,
    page: now,
    was: { width: page.width, height: page.height, preset: page.preset },
    fellOff: contentsSaid(
      before.filter((element) => !keptIds.has(element.id)),
      page,
    ),
    joined: contentsSaid(
      kept.filter((element) => !beforeIds.has(element.id)),
      now,
    ),
    clipped: contentsSaid(
      kept.filter((element) => {
        const box = elementBox(element);
        return box ? crossesEdge(box, now) : false;
      }),
      now,
    ).pictures,
    overlaps: after.filter((other) => other.id !== now.id && intersects(now, other)),
    adoptedIds,
    releasedIds,
  };
}
