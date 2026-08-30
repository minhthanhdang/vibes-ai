import { outerGroupId } from "@/lib/canvas/moodboard-arrange";
import { readableTarget } from "@/lib/canvas-objects/object-read";
import { boardPages, elementBox, pageHolding, type BoardPage } from "@/lib/pages/board-pages";
import { isPageBackground } from "@/lib/pages/page-background";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type ReorderMove = {
  objectId: string;
  to: "front" | "back" | { above: string } | { below: string };
};

export type ReorderRefusal = { objectId: string; reason: string };

export type ReorderResult = {
  elements: SceneElement[] | null;
  reordered: string[];
  unchanged: string[];
  notFound: string[];
  refused: ReorderRefusal[];
};

type Destination = "front" | "back" | { above: string } | { below: string };

function readDestination(to: unknown): Destination | null {
  if (to === "front" || to === "back") return to;
  if (typeof to !== "object" || to === null || Array.isArray(to)) return null;
  const { above, below } = to as { above?: unknown; below?: unknown };
  if ((above !== undefined) === (below !== undefined)) return null;
  const named = above !== undefined ? above : below;
  if (typeof named !== "string" || !named) return null;
  return above !== undefined ? { above: named } : { below: named };
}

function isFrameKind(element: SceneElement): boolean {
  return element.type === "frame" || element.type === "magicframe";
}

export function reorderObjects(
  elements: readonly SceneElement[],
  moves: readonly ReorderMove[],
  { pageId }: { pageId?: string } = {},
): ReorderResult {
  const reordered: string[] = [];
  const unchanged: string[] = [];
  const notFound: string[] = [];
  const refused: ReorderRefusal[] = [];

  const pages = boardPages(elements);
  const pageIds = new Set(pages.map((page) => page.id));
  const scoped = pageId ? (pages.find((page) => page.id === pageId) ?? null) : null;

  const graves: { at: number; element: SceneElement }[] = [];
  let working: SceneElement[] = [];
  elements.forEach((element, at) => {
    if (element.isDeleted === true) graves.push({ at, element });
    else working.push(element);
  });
  const before = [...working];

  const liveById = new Map<string, SceneElement>();
  for (const element of working) {
    if (typeof element.id === "string" && element.id) liveById.set(element.id, element);
  }

  const companyOf = (element: SceneElement): BoardPage | null => {
    const box = elementBox(element);
    return box ? pageHolding(pages, box) : null;
  };

  const blockOf = (element: SceneElement): SceneElement[] => {
    const group = outerGroupId(element);
    const partIds = new Set(
      (group ? working.filter((piece) => outerGroupId(piece) === group) : [element]).map(
        (piece) => piece.id,
      ),
    );
    return working.filter(
      (piece) =>
        partIds.has(piece.id) ||
        (typeof piece.containerId === "string" && partIds.has(piece.containerId)),
    );
  };

  const movedIds = new Set<string>();

  for (const move of moves) {
    const objectId = typeof move?.objectId === "string" ? move.objectId : "";
    const refuse = (reason: string) => refused.push({ objectId, reason });

    const destination = readDestination(move?.to);
    if (!destination) {
      refuse("the move carries an unreadable destination — front, back, { above } or { below }");
      continue;
    }
    if (pageId && !scoped) {
      refuse(`${pageId} names no page on this board`);
      continue;
    }
    if (pageIds.has(objectId)) {
      refuse("pages do not reorder — a page's stacking is topmost-wins membership");
      continue;
    }
    const element = liveById.get(objectId);
    if (!element) {
      notFound.push(objectId);
      continue;
    }
    if (isPageBackground(element)) {
      refuse(
        "a page’s background stays behind everything on the page — it is the page’s ground, set with set_page_background",
      );
      continue;
    }
    if (typeof element.containerId === "string" && element.containerId) {
      refuse(`a bound label travels with its container — reorder ${element.containerId} instead`);
      continue;
    }
    if (!readableTarget(element) || !elementBox(element)) {
      notFound.push(objectId);
      continue;
    }
    const block = blockOf(element);
    if (block.some(isFrameKind)) {
      refuse("grouped with a frame, which stacks as a page rather than an object");
      continue;
    }
    if (element.locked === true) {
      refuse("locked");
      continue;
    }
    if (block.some((piece) => piece.locked === true)) {
      refuse("grouped with a locked element");
      continue;
    }

    const holding = companyOf(element);
    if (scoped && holding?.id !== scoped.id) {
      refuse(`not on page ${scoped.id}, which this call is scoped to`);
      continue;
    }

    const blockIds = new Set(block.map((piece) => piece.id));
    const rest = working.filter((piece) => !blockIds.has(piece.id));

    let at: number;
    if (destination === "front" || destination === "back") {
      if (holding) {
        const frameAt = rest.findIndex((piece) => piece.id === holding.id);
        const firstChild = rest.findIndex(
          (piece) =>
            !isFrameKind(piece) &&
            !isPageBackground(piece) &&
            typeof piece.frameId === "string" &&
            piece.frameId === holding.id,
        );
        at =
          destination === "front"
            ? frameAt
            : firstChild === -1
              ? frameAt
              : Math.min(firstChild, frameAt);
      } else {
        at = destination === "front" ? rest.length : 0;
      }
    } else {
      const targetId = "above" in destination ? destination.above : destination.below;
      if (blockIds.has(targetId)) {
        refuse(`${targetId} moves with it — a block cannot order relative to itself`);
        continue;
      }
      if (pageIds.has(targetId)) {
        refuse(`${targetId} is a page — order against one of its members instead`);
        continue;
      }
      const named = liveById.get(targetId);
      if (!named) {
        refuse(`${targetId} names nothing on the board`);
        continue;
      }
      if ((holding?.id ?? null) !== (companyOf(named)?.id ?? null)) {
        refuse(
          `${targetId} stacks in a different company — z orders a page's members against each other and loose objects against loose objects`,
        );
        continue;
      }
      const targetIds = new Set(blockOf(named).map((piece) => piece.id));
      let first = -1;
      let last = -1;
      rest.forEach((piece, index) => {
        if (!targetIds.has(piece.id)) return;
        if (first === -1) first = index;
        last = index;
      });
      at = "above" in destination ? last + 1 : first;
    }

    const next = [...rest.slice(0, at), ...block, ...rest.slice(at)];
    if (next.every((piece, index) => piece === working[index])) {
      unchanged.push(objectId);
      continue;
    }
    working = next;
    reordered.push(objectId);
    for (const id of blockIds) movedIds.add(id);
  }

  if (movedIds.size === 0 || working.every((piece, index) => piece === before[index])) {
    return { elements: null, reordered, unchanged, notFound, refused };
  }

  const settled = working.map((piece) => {
    if (!movedIds.has(piece.id) || !("index" in piece)) return piece;
    const copy: Record<string, unknown> = { ...piece };
    delete copy.index;
    return copy as SceneElement;
  });
  for (const grave of graves) {
    settled.splice(Math.min(grave.at, settled.length), 0, grave.element);
  }

  return { elements: settled, reordered, unchanged, notFound, refused };
}
