import {
  MOVED,
  elementPlacements,
  memberGeometry,
  outerGroupId,
  type ArrangeBox,
  type ArrangeMember,
  type ElementPlacement,
} from "@/lib/canvas/moodboard-arrange";
import type { Rect } from "@/lib/canvas/moodboard-frames";
import { readableTarget } from "@/lib/canvas-objects/object-read";
import {
  boardPages,
  elementBox,
  pageById,
  pageChildOrder,
  pageElements,
  pageHolding,
} from "@/lib/pages/board-pages";
import { isPageBackground } from "@/lib/pages/page-background";
import { renderFontOf } from "@/lib/render/render-plan";
import { flooredType } from "@/lib/render/text-set";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type TransformChange = {
  objectId: string;
  to?: readonly [number, number];
  angle?: number;
  size?: readonly [number, number];
  stretch?: true;
};

export type TransformRefusal = { objectId: string; reason: string };

export type TransformClamp = {
  objectId: string;
  asked: number;
  set: number;
};

export type TransformResult = {
  elements: SceneElement[] | null;
  transformed: string[];
  unchanged: string[];
  notFound: string[];
  refused: TransformRefusal[];
  clamped: TransformClamp[];
};

const ROTATED = 0.1;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number) {
  return Math.round(value * 100) / 100 + 0;
}

function readPair(
  pair: readonly [number, number] | undefined,
): [number, number] | null | undefined {
  if (pair === undefined) return undefined;
  if (!Array.isArray(pair) || pair.length !== 2) return null;
  const y = finite(pair[0]);
  const x = finite(pair[1]);
  return y === null || x === null ? null : [y, x];
}

function normalRadians(radians: number): number {
  const wrapped = radians % (2 * Math.PI);
  return wrapped < 0 ? wrapped + 2 * Math.PI : wrapped;
}

function angleDelta(currentRadians: number, targetDegrees: number): number {
  const currentDegrees = (currentRadians * 180) / Math.PI;
  const delta = (((targetDegrees - currentDegrees) % 360) + 540) % 360 - 180;
  return Math.abs(delta) <= ROTATED ? 0 : delta;
}

function unionOf(members: readonly ArrangeMember[]): Rect {
  const x = Math.min(...members.map((member) => member.x));
  const y = Math.min(...members.map((member) => member.y));
  return {
    x,
    y,
    width: Math.max(...members.map((member) => member.x + member.width)) - x,
    height: Math.max(...members.map((member) => member.y + member.height)) - y,
  };
}

type Placement = ElementPlacement & { angle?: number };

function exactPlacement(element: SceneElement, box: Rect, to: Rect): Placement {
  const placement: Placement = {
    id: element.id,
    x: round(to.x),
    y: round(to.y),
    width: round(to.width),
    height: round(to.height),
  };
  const points = memberGeometry(element)?.points;
  if (points) {
    const sx = box.width > 0 ? to.width / box.width : 1;
    const sy = box.height > 0 ? to.height / box.height : 1;
    placement.points = points.map(([x, y]) => [round(x * sx), round(y * sy)]);
  }
  return placement;
}

function spun(
  placements: readonly Placement[],
  unit: Rect,
  deltaDegrees: number,
  angleOf: (id: string) => number,
): Placement[] {
  const deltaRadians = (deltaDegrees * Math.PI) / 180;
  const centre = { x: unit.x + unit.width / 2, y: unit.y + unit.height / 2 };
  const cos = Math.cos(deltaRadians);
  const sin = Math.sin(deltaRadians);

  return placements.map((placement) => {
    const dx = placement.x + placement.width / 2 - centre.x;
    const dy = placement.y + placement.height / 2 - centre.y;
    return {
      ...placement,
      x: round(centre.x + dx * cos - dy * sin - placement.width / 2),
      y: round(centre.y + dx * sin + dy * cos - placement.height / 2),
      angle: normalRadians(angleOf(placement.id) + deltaRadians),
    };
  });
}

export function transformObjects(
  elements: readonly SceneElement[],
  changes: readonly TransformChange[],
): TransformResult {
  const pages = boardPages(elements);
  const pageIds = new Set(pages.map((page) => page.id));

  const live = new Map<string, SceneElement>();
  for (const element of elements) {
    if (element.isDeleted !== true && element.id) live.set(element.id, element);
  }
  const labels = new Map<string, SceneElement[]>();
  const groups = new Map<string, SceneElement[]>();
  for (const element of live.values()) {
    const container = element.containerId;
    if (typeof container === "string" && container) {
      (labels.get(container) ?? labels.set(container, []).get(container)!).push(element);
    }
    const group = outerGroupId(element);
    if (group) (groups.get(group) ?? groups.set(group, []).get(group)!).push(element);
  }

  const transformed: string[] = [];
  const unchanged: string[] = [];
  const notFound: string[] = [];
  const refused: TransformRefusal[] = [];
  const clamped: TransformClamp[] = [];
  const touched = new Set<string>();
  const writes = new Map<string, Record<string, unknown>>();
  const landed: { memberIds: string[]; box: Rect }[] = [];

  for (const change of changes) {
    const { objectId } = change;
    const refuse = (reason: string) => refused.push({ objectId, reason });

    const to = readPair(change.to);
    const size = readPair(change.size);
    if (to === null || size === null || (change.angle !== undefined && finite(change.angle) === null)) {
      refuse("the change carries an unreadable number");
      continue;
    }
    if (size && !(size[0] >= 0 && size[1] >= 0 && (size[0] > 0 || size[1] > 0))) {
      refuse("size must be positive");
      continue;
    }
    if (!to && !size && change.angle === undefined) {
      unchanged.push(objectId);
      continue;
    }

    if (pageIds.has(objectId)) {
      if (change.angle !== undefined) {
        refuse("pages cannot rotate — excalidraw frames have no angle");
        continue;
      }
      if (size || change.stretch) {
        refuse("a page is resized with resize_page, which reports what falls off");
        continue;
      }
      const page = pageById(pages, objectId)!;
      const frame = live.get(objectId);
      if (!frame) {
        notFound.push(objectId);
        continue;
      }
      if (frame.locked === true) {
        refuse("locked");
        continue;
      }
      const carried = pageElements(elements, pages, page);
      const ids = [objectId, ...carried.map((element) => element.id)];
      if (ids.some((id) => touched.has(id))) {
        refuse("already transformed by an earlier change in this call");
        continue;
      }
      const [ymin, xmin] = to!;
      const dx = xmin - page.x;
      const dy = ymin - page.y;
      if (Math.abs(dx) <= MOVED && Math.abs(dy) <= MOVED) {
        unchanged.push(objectId);
        continue;
      }
      writes.set(objectId, { x: round(xmin), y: round(ymin) });
      for (const element of carried) {
        const box = elementBox(element)!;
        writes.set(element.id, { x: round(box.x + dx), y: round(box.y + dy) });
      }
      for (const id of ids) touched.add(id);
      transformed.push(objectId);
      continue;
    }

    const element = live.get(objectId);
    if (!element) {
      notFound.push(objectId);
      continue;
    }
    if (isPageBackground(element)) {
      refuse(
        'a page’s background is the page’s own, not an object on it — it is set with set_page_background and moves and resizes with its page',
      );
      continue;
    }
    if (typeof element.containerId === "string" && element.containerId) {
      refuse(`a bound label travels with its container — transform ${element.containerId} instead`);
      continue;
    }
    const target = readableTarget(element);
    const box = elementBox(element);
    if (!target || !box) {
      notFound.push(objectId);
      continue;
    }
    if (size && target.kind !== "shape" && !(size[0] > 0 && size[1] > 0)) {
      refuse("size must be positive — only a shape may be flat");
      continue;
    }
    if (element.locked === true) {
      refuse("locked");
      continue;
    }

    const group = outerGroupId(element);
    const parts = group ? (groups.get(group) ?? [element]) : [element];
    if (parts.some((part) => part.type === "frame" || part.type === "magicframe")) {
      refuse("grouped with a frame, which a rigid transform cannot honestly move");
      continue;
    }
    const pieces = parts.flatMap((part) => [part, ...(labels.get(part.id) ?? [])]);
    if (pieces.some((piece) => piece.locked === true)) {
      refuse("grouped with a locked element");
      continue;
    }
    const exact = (change.stretch || target.kind === "shape") && pieces.length === 1;
    if (change.stretch && !(pieces.length === 1 && target.kind !== "text")) {
      refuse("stretch only applies to a lone picture or shape — text and groups scale uniformly");
      continue;
    }
    if (pieces.some((piece) => touched.has(piece.id))) {
      refuse("already transformed by an earlier change in this call");
      continue;
    }

    const members: ArrangeMember[] = [];
    let unreadable = false;
    for (const piece of pieces) {
      const member = memberGeometry(piece);
      if (!member) {
        unreadable = true;
        break;
      }
      members.push(member);
    }
    if (unreadable) {
      refuse("part of its group has no readable geometry");
      continue;
    }

    const holding = pageHolding(pages, box);
    const tolX = holding ? Math.max(MOVED, holding.width / 2000) : MOVED;
    const tolY = holding ? Math.max(MOVED, holding.height / 2000) : MOVED;

    const targetX = to ? (holding ? holding.x + (to[1] / 1000) * holding.width : to[1]) : box.x;
    const targetY = to ? (holding ? holding.y + (to[0] / 1000) * holding.height : to[0]) : box.y;
    let targetW = box.width;
    let targetH = box.height;
    if (size) {
      const askedH = holding ? (size[0] / 1000) * holding.height : size[0];
      const askedW = holding ? (size[1] / 1000) * holding.width : size[1];
      if (exact) {
        targetW = askedW;
        targetH = askedH;
      } else {
        const scale = Math.min(askedW / box.width, askedH / box.height);
        targetW = box.width * scale;
        targetH = box.height * scale;
      }
    }

    const delta = change.angle === undefined ? 0 : angleDelta(finite(element.angle) ?? 0, change.angle);
    const still =
      Math.abs(targetX - box.x) <= tolX &&
      Math.abs(targetY - box.y) <= tolY &&
      Math.abs(targetW - box.width) <= tolX &&
      Math.abs(targetH - box.height) <= tolY;
    if (still && delta === 0) {
      unchanged.push(objectId);
      continue;
    }

    const unitId = group ?? objectId;
    const before: ArrangeBox = { id: unitId, ...unionOf(members) };
    const scale =
      box.width > 0 ? targetW / box.width : box.height > 0 ? targetH / box.height : 1;
    const moved: Rect = exact
      ? { x: targetX, y: targetY, width: targetW, height: targetH }
      : {
          x: targetX - (box.x - before.x) * scale,
          y: targetY - (box.y - before.y) * scale,
          width: before.width * scale,
          height: before.height * scale,
        };

    let placements: Placement[] = exact
      ? [exactPlacement(element, box, moved)]
      : elementPlacements([before], [{ id: unitId, ...moved, members }]);
    if (delta !== 0) {
      placements = spun(placements, moved, delta, (id) => finite(live.get(id)?.angle) ?? 0);
    }

    for (const placement of placements) {
      const write: Record<string, unknown> = {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
      };
      if (placement.fontSize !== undefined) {
        write.fontSize = placement.fontSize;
        const piece = live.get(placement.id);
        const floored = piece
          ? flooredType(piece, placement, renderFontOf(piece).set)
          : null;
        if (floored) {
          write.fontSize = floored.fontSize;
          write.height = floored.height;
          if (floored.text) write.text = floored.text;
          clamped.push({
            objectId: placement.id,
            asked: placement.fontSize,
            set: floored.fontSize,
          });
        }
      }
      if (placement.points) write.points = placement.points;
      if (placement.angle !== undefined) write.angle = placement.angle;
      writes.set(placement.id, write);
      touched.add(placement.id);
    }
    transformed.push(objectId);
    landed.push({ memberIds: placements.map((placement) => placement.id), box: moved });
  }

  if (writes.size === 0) {
    return { elements: null, transformed, unchanged, notFound, refused, clamped };
  }

  let next: SceneElement[] = elements.map((element) =>
    writes.has(element.id) ? { ...element, ...writes.get(element.id)! } : element,
  );

  const pagesAfter = boardPages(next);
  const pageIdsAfter = new Set(pagesAfter.map((page) => page.id));
  const owners = new Map<string, string | null>();
  for (const unit of landed) {
    const owner = pageHolding(pagesAfter, unit.box)?.id ?? null;
    for (const id of unit.memberIds) owners.set(id, owner);
  }
  let reparented = false;
  next = next.map((element) => {
    const owner = owners.get(element.id);
    if (owner === undefined) return element;
    const current = typeof element.frameId === "string" ? element.frameId : null;
    if (current === owner) return element;
    if (owner === null && !(current && pageIdsAfter.has(current))) return element;
    reparented = true;
    return { ...element, frameId: owner };
  });
  if (reparented) next = pageChildOrder(next);

  return { elements: next, transformed, unchanged, notFound, refused, clamped };
}
