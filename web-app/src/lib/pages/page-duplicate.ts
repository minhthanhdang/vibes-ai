import { boardItems } from "@/lib/boards/board-contents";
import {
  boardPages,
  boardSections,
  boxOnPage,
  isFrameElement,
  nextPageName,
  pageById,
  pageElements,
  pageFrame,
  pageItems,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { newPageBox } from "@/lib/pages/page-compose";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type PageDuplication = {
  elements: SceneElement[];
  page: BoardPage;
  source: BoardPage;
  pictures: string[];
  lines: string[];
  copied: number;
  sections: number;
  keptInSections: number;
};

const REGENERATED = ["index", "seed", "version", "versionNonce", "updated"] as const;

function copyOf(
  element: SceneElement,
  {
    ids,
    groups,
    frameId,
    dx,
    dy,
  }: {
    ids: ReadonlyMap<string, string>;
    groups: ReadonlyMap<string, string>;
    frameId: string;
    dx: number;
    dy: number;
  },
): SceneElement {
  const copy: Record<string, unknown> = { ...element };
  for (const field of REGENERATED) delete copy[field];

  copy.id = ids.get(element.id)!;
  copy.x = (element.x as number) + dx;
  copy.y = (element.y as number) + dy;
  copy.frameId = frameId;

  if (Array.isArray(element.groupIds)) {
    copy.groupIds = element.groupIds.map((id) =>
      typeof id === "string" ? (groups.get(id) ?? id) : id,
    );
  }
  if (typeof element.containerId === "string") {
    copy.containerId = ids.get(element.containerId) ?? null;
  }
  if (Array.isArray(element.boundElements)) {
    copy.boundElements = element.boundElements
      .map((bound) => {
        const entry = bound as { id?: unknown } | null;
        const id = entry && typeof entry.id === "string" ? ids.get(entry.id) : undefined;
        return id ? { ...entry, id } : null;
      })
      .filter(Boolean);
  }
  for (const end of ["startBinding", "endBinding"] as const) {
    const binding = element[end] as { elementId?: unknown } | null | undefined;
    if (!binding || typeof binding.elementId !== "string") continue;
    const id = ids.get(binding.elementId);
    copy[end] = id ? { ...binding, elementId: id } : null;
  }

  return copy as SceneElement;
}

export function pageDuplication({
  elements,
  pageId,
  name,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  pageId: unknown;
  name?: string | null;
  makeId?: () => string;
}): PageDuplication | null {
  const pages = boardPages(elements);
  const source = pageById(pages, pageId);
  if (!source) return null;

  const sections = boardSections(elements, pages);
  const going = pageElements(elements, pages, source, sections);

  const box = newPageBox({
    pages,
    sourcePageId: source.id,
    size: { width: source.width, height: source.height },
    occupied: boardItems(elements),
  });
  const frame = pageFrame(box, { name: name?.trim() || nextPageName(pages), makeId });

  const ids = new Map(going.map((element) => [element.id, makeId()]));
  const groups = new Map(
    [...new Set(going.flatMap((element) => (Array.isArray(element.groupIds) ? element.groupIds : [])))]
      .filter((id): id is string => typeof id === "string")
      .map((id) => [id, makeId()]),
  );
  const dx = box.x - source.x;
  const dy = box.y - source.y;
  const copies = going.map((element) => copyOf(element, { ids, groups, frameId: frame.id, dx, dy }));

  const on = pageItems(boardItems(copies), box);
  const pictures: string[] = [];
  for (const item of on) {
    if (item.kind !== "image" || !item.referenceId) continue;
    if (!pictures.includes(item.referenceId)) pictures.push(item.referenceId);
  }

  const onSections = sections.filter((section) => boxOnPage(source, section));
  const sectionIds = new Set(onSections.map((section) => section.id));

  return {
    elements: [...elements, ...copies, frame],
    page: boardPages([frame])[0]!,
    source,
    pictures,
    lines: on
      .filter((item) => item.kind === "text")
      .map((item) => (item.text ?? "").trim())
      .filter(Boolean),
    copied: copies.length,
    sections: onSections.length,
    keptInSections: elements.filter(
      (element) =>
        element.isDeleted !== true &&
        !isFrameElement(element) &&
        typeof element.frameId === "string" &&
        sectionIds.has(element.frameId),
    ).length,
  };
}
