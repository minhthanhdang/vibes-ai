import { elementsOnPage, placeOnPage } from "@/lib/pages/page-place";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";
import type { BoardPage } from "@/lib/pages/board-pages";

export type PageMove = {
  elements: SceneElement[];
  moved: string[];
  alreadyThere: string[];
  notOnFrom: string[];
};

export function moveToPage({
  elements,
  pages,
  from,
  to,
  referenceIds,
  sizeOf,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  pages: readonly BoardPage[];
  from: BoardPage;
  to: BoardPage;
  referenceIds: readonly string[];
  sizeOf: (referenceId: string) => { width?: number | null; height?: number | null } | null | undefined;
  makeId?: () => string;
}): PageMove {
  const asked = [...new Set(referenceIds.map((id) => id.trim()).filter(Boolean))];

  const onFrom = new Set(
    elementsOnPage(elements, pages, from)
      .map((element) => referenceIdFromFileId(element.fileId))
      .filter((id): id is string => id !== null),
  );

  const going = asked.filter((id) => onFrom.has(id));
  const notOnFrom = asked.filter((id) => !onFrom.has(id));
  if (!going.length) return { elements: [...elements], moved: [], alreadyThere: [], notOnFrom };

  const off = placeOnPage({ elements, pages, page: from, remove: going, sizeOf });
  const on = placeOnPage({ elements: off.elements, pages, page: to, add: going, sizeOf, makeId });

  return { elements: on.elements, moved: on.added, alreadyThere: on.alreadyOn, notOnFrom };
}
