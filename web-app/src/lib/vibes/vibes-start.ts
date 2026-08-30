import { addPage } from "@/lib/pages/page-add";
import {
  DEFAULT_BOARD_TITLE,
  normalizedBoardTitle,
} from "@/lib/scene/moodboard-boards";
import type { VibesBrief } from "@/lib/vibes/vibes-brief";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type VibesBoard = {
  title: string;
  size: { width: number; height: number };
  elements: SceneElement[];
  pageIds: string[];
};

export function vibesBoard({
  brief,
  makeId = () => crypto.randomUUID(),
}: {
  brief: VibesBrief;
  makeId?: () => string;
}): VibesBoard {
  const size = { width: brief.width, height: brief.height };

  let elements: SceneElement[] = [];
  const pageIds: string[] = [];

  for (let n = 0; n < brief.pages; n += 1) {
    const added = addPage({ elements, defaultSize: size, makeId });
    elements = added.elements;
    pageIds.push(added.page.id);
  }

  return {
    title: normalizedBoardTitle(brief.purpose) ?? DEFAULT_BOARD_TITLE,
    size: { width: size.width, height: size.height },
    elements,
    pageIds,
  };
}
