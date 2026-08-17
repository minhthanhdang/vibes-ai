import { lineKey, textOf } from "@/lib/boards/board-line";
import { boardPages, isFrameElement, pageById } from "@/lib/pages/board-pages";
import { pageRemoval } from "@/lib/pages/page-remove";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

/// Objects off the canvas (canvas.md §XI, the canvas toolset), named the way a
/// model holds them: an `objectId` from the read, or — the way the existing
/// removes already answer — a `referenceId`, a line's words, or a `pageId`.
///
/// One selector, tried in the order of how exactly it names a thing: an element
/// id first (a page's frame id takes the whole page, `pageRemoval`'s rule — the
/// arrangement is the thing being dropped, while a section it was drawn over
/// and that section's photos stay); then a reference, which takes every element
/// pointing at it, so a photo dropped twice leaves once; then a line by
/// `lineKey`, surviving a retyped capital and a doubled space.
///
/// Removal drops elements from the array — the existing convention, the same
/// one every place and swap writes by — it does not tombstone. A bound label
/// goes with its container; a grouped element leaves its group behind, which is
/// what deleting one photo of a stack means. Locked is refused — the element,
/// or any element a reference or line selector would take — never half-honoured.
///
/// Nothing is dropped silently: every selector lands in exactly one of
/// `removed`, `notOnBoard` or `refused`.
///
/// No canvas, no React, no DOM: what goes in is elements and selectors, what
/// comes out is elements or null.

export type RemovedObject = {
  object: string;
  /// How the selector named it — the element it hit, a page, or the reference
  /// / line match that swept more than one element.
  kind: "image" | "text" | "page" | "reference" | "line";
  /// How many elements left the array for it, labels included.
  count: number;
};

export type RemoveRefusal = { object: string; reason: string };

export type RemoveResult = {
  /// The rewritten scene, or null when nothing left it — the caller's cue to
  /// skip the write entirely rather than spend a revision on nothing.
  elements: SceneElement[] | null;
  removed: RemovedObject[];
  /// Named nothing the board carries: the model meant a different thing, and
  /// only the user can say which.
  notOnBoard: string[];
  refused: RemoveRefusal[];
};

function liveOf(elements: readonly SceneElement[]): SceneElement[] {
  return elements.filter((element) => element.isDeleted !== true);
}

/// The named elements out of the array, and every label bound to one — a
/// caption riding a photo is part of the photo, not a thing that survives it.
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

    /// Each selector reads the array the one before left — a page taken first
    /// leaves its members named-by-nothing, which is the honest answer.
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
      if (isFrameElement(byId) || (byId.type !== "image" && byId.type !== "text")) {
        refuse("not a canvas object — only images, text and pages leave this way");
        continue;
      }
      const pieces = dropped(current, new Set([selector]));
      if (pieces.taking.some((element) => element.locked === true)) {
        refuse("locked");
        continue;
      }
      current = pieces.kept;
      changed = true;
      removed.push({ object: selector, kind: byId.type, count: pieces.taking.length });
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
