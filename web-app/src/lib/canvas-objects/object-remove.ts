import { lineKey, textOf } from "@/lib/boards/board-line";
import { readableTarget } from "@/lib/canvas-objects/object-read";
import { boardPages, isFrameElement, pageById } from "@/lib/pages/board-pages";
import { isPageBackground } from "@/lib/pages/page-background";
import { pageRemoval } from "@/lib/pages/page-remove";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

export type RemovedObject = {
  object: string;
  kind: "image" | "text" | "shape" | "page" | "reference" | "line";
  count: number;
};

export type RemoveRefusal = { object: string; reason: string };

export type RemoveResult = {
  elements: SceneElement[] | null;
  removed: RemovedObject[];
  notOnBoard: string[];
  refused: RemoveRefusal[];
};

function liveOf(elements: readonly SceneElement[]): SceneElement[] {
  return elements.filter((element) => element.isDeleted !== true);
}

function dropped(
  elements: readonly SceneElement[],
  ids: ReadonlySet<string>,
): { kept: SceneElement[]; taking: SceneElement[] } {
  const taking = elements.filter(
    (element) =>
      element.isDeleted !== true &&
      (ids.has(element.id) ||
        (typeof element.containerId === "string" && ids.has(element.containerId))),
  );
  const gone = new Set(taking.map((element) => element.id));
  return { kept: elements.filter((element) => !gone.has(element.id)), taking };
}

export function removeObjects(
  elements: readonly SceneElement[],
  objects: readonly string[],
): RemoveResult {
  const removed: RemovedObject[] = [];
  const notOnBoard: string[] = [];
  const refused: RemoveRefusal[] = [];

  let current: SceneElement[] = [...elements];
  let changed = false;

  const seen = new Set<string>();
  for (const named of objects) {
    const selector = typeof named === "string" ? named.trim() : "";
    if (!selector || seen.has(selector)) continue;
    seen.add(selector);
    const refuse = (reason: string) => refused.push({ object: selector, reason });

    const live = liveOf(current);
    const byId = live.find((element) => element.id === selector) ?? null;

    if (byId) {
      const pages = boardPages(current);
      if (pageById(pages, selector)) {
        if (byId.locked === true) {
          refuse("locked");
          continue;
        }
        const removal = pageRemoval(current, selector)!;
        const count = liveOf(current).length - liveOf(removal.elements).length;
        current = removal.elements;
        changed = true;
        removed.push({ object: selector, kind: "page", count });
        continue;
      }
      if (isPageBackground(byId)) {
        refuse(
          'a page’s background is the page’s own, not an object on it — clear it with set_page_background and colour "none"',
        );
        continue;
      }
      const target = isFrameElement(byId) ? null : readableTarget(byId);
      if (!target) {
        refuse("not a canvas object — only images, text, shapes and pages leave this way");
        continue;
      }
      const pieces = dropped(current, new Set([selector]));
      if (pieces.taking.some((element) => element.locked === true)) {
        refuse("locked");
        continue;
      }
      current = pieces.kept;
      changed = true;
      removed.push({ object: selector, kind: target.kind, count: pieces.taking.length });
      continue;
    }

    const carrying = live.filter(
      (element) => referenceIdFromFileId(element.fileId) === selector,
    );
    if (carrying.length) {
      const pieces = dropped(current, new Set(carrying.map((element) => element.id)));
      if (pieces.taking.some((element) => element.locked === true)) {
        refuse("an element carrying it is locked");
        continue;
      }
      current = pieces.kept;
      changed = true;
      removed.push({ object: selector, kind: "reference", count: pieces.taking.length });
      continue;
    }

    const saying = live.filter(
      (element) => element.type === "text" && lineKey(textOf(element)) === lineKey(selector),
    );
    if (saying.length) {
      const pieces = dropped(current, new Set(saying.map((element) => element.id)));
      if (pieces.taking.some((element) => element.locked === true)) {
        refuse("an element saying it is locked");
        continue;
      }
      current = pieces.kept;
      changed = true;
      removed.push({ object: selector, kind: "line", count: pieces.taking.length });
      continue;
    }

    notOnBoard.push(selector);
  }

  return { elements: changed ? current : null, removed, notOnBoard, refused };
}
