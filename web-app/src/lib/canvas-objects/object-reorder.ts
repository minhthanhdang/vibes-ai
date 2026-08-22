import { outerGroupId } from "@/lib/canvas/moodboard-arrange";
import { readableTarget } from "@/lib/canvas-objects/object-read";
import { boardPages, elementBox, pageHolding, type BoardPage } from "@/lib/pages/board-pages";
import { isPageBackground } from "@/lib/pages/page-background";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// Z-order moves on canvas objects (canvas.md §XI, the canvas toolset) —
/// "bring this above that", said relatively, because an array position is not
/// a property a model should compute.
///
/// Objects are addressed by `objectId`, the handle `object-read` surfaces, and
/// a move goes to `front`, `back`, `{ above }` or `{ below }`. The scope is
/// the read's own company rule (§V.3, geometric): an object held by a page
/// stacks among that page's members — `front` is the front of the page's
/// child run, immediately before its frame — and a loose object stacks among
/// the whole canvas. `above`/`below` across two companies is refused rather
/// than half-honoured: the read's `z` is per company, so a cross-company
/// order is a number no read could ever say back.
///
/// The rules are the spec's, none negotiable:
/// - every moved element's fractional `index` is dropped, so excalidraw's
///   restore re-derives it from array order — a stale index would quietly put
///   the old order back at the next mount, the failure `page-duplicate`'s
///   `REGENERATED` list exists to prevent;
/// - a frame's children stay immediately before their frame;
/// - a grouped element moves its whole group as one block, internal order
///   kept, and a bound label travels with its container;
/// - tombstones keep their array positions;
/// - pages are refused — page stacking is topmost-wins membership, and
///   overlapping pages are already the defect `resize_page` reports;
/// - locked is refused; `front` on the frontmost is a no-op.
///
/// Moves apply in order, each against the array the one before left, so
/// "A above B, then C above A" lands the way it reads. Nothing is dropped
/// silently: every move lands in exactly one of `reordered`, `unchanged`,
/// `notFound` or `refused`.
///
/// No canvas, no React, no DOM: what goes in is elements and moves, what
/// comes out is elements or null.

export type ReorderMove = {
  objectId: string;
  to: "front" | "back" | { above: string } | { below: string };
};

export type ReorderRefusal = { objectId: string; reason: string };

export type ReorderResult = {
  /// The rewritten scene, or null when the array comes out where it started —
  /// the caller's cue to skip the write entirely rather than spend a revision
  /// on nothing.
  elements: SceneElement[] | null;
  reordered: string[];
  /// Asked for what is already true — `front` on the frontmost.
  unchanged: string[];
  notFound: string[];
  refused: ReorderRefusal[];
};

type Destination = "front" | "back" | { above: string } | { below: string };

/// The destination as given, null when unreadable — `{ above, below }` at
/// once, an empty id, anything that is neither of the four shapes.
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

  /// Tombstones sit the reorder out at their own array positions — deleted
  /// elements are history the editor may still need, not stacking.
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

  /// The company an object stacks in — the holding page by §V.3's rule, the
  /// same one the read scoped its `z` to, or null for a loose object.
  const companyOf = (element: SceneElement): BoardPage | null => {
    const box = elementBox(element);
    return box ? pageHolding(pages, box) : null;
  };

  /// What moves as one: the element's whole outer group, plus every label
  /// bound to a member, in the order the array already holds them.
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
    /// The page's ground stays at the back and is not restacked (§XI.4).
    /// Refused ahead of the handle question, like the label below it, because
    /// `readableTarget` drops it and a `notFound` would read as "no such id".
    if (isPageBackground(element)) {
      refuse(
        "a page’s background stays behind everything on the page — it is the page’s ground, set with set_page_background",
      );
      continue;
    }
    /// Asked before the handle question, because a bound label has no handle
    /// and `readableTarget` drops it — the dead end explained rather than
    /// answered `notFound`.
    if (typeof element.containerId === "string" && element.containerId) {
      refuse(`a bound label travels with its container — reorder ${element.containerId} instead`);
      continue;
    }
    /// The read's own answer to what is addressable (`readableTarget`), so a
    /// shape the model was just handed can be sent behind the photograph it is
    /// a scrim for. A colour block that can be placed and not restacked is the
    /// bound-label loop again (§XI.1).
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
        /// `back` means "back, *above* the page background" (§XI.4). The ground
        /// is the first member of the child run, so a photograph sent to the
        /// back of its page would otherwise land under the colour the page is
        /// painted — which is a photograph the user cannot see and a tool
        /// reporting that it moved it.
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

  /// The moved elements' fractional indices are dropped, never carried: the
  /// array order is the truth now, and excalidraw's restore re-derives an
  /// index for an element missing one from its neighbours. A carried index
  /// would out-vote the array at the next mount and put the old order back.
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
