import { DROPPED_IMAGE_GAP } from "@/lib/canvas/moodboard-drop";
import {
  boardFrames,
  frameInnerBox,
  frameOf,
  type FrameBox,
} from "@/lib/canvas/moodboard-frames";
import { boardPages, pageHolding, type BoardPage } from "@/lib/pages/board-pages";
import { isPageBackground } from "@/lib/pages/page-background";
import { referenceIdFromFileId } from "@/lib/scene/moodboard-scene";
import { selectedElementIds } from "@/lib/canvas/moodboard-selection";

export const ARRANGE_GAP = DROPPED_IMAGE_GAP;

export type ArrangeMember = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  points?: readonly (readonly [number, number])[];
};

export type ArrangeBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  referenceId?: string | null;
  frameId?: string | null;
  members?: readonly ArrangeMember[];
  photos?: number;
};

export type ArrangeOrdering = (boxes: readonly ArrangeBox[]) => ArrangeBox[];

export type ArrangeScope = "selection" | "board";

export type ArrangeGroup = {
  frame: FrameBox | null;
  boxes: ArrangeBox[];
  page?: true;
};

export type ArrangeOwner = {
  id: string;
  frameId: string | null;
};

export type ArrangeTargets = {
  scope: ArrangeScope;
  boxes: ArrangeBox[];
  groups: ArrangeGroup[];
  owners: ArrangeOwner[];
};

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const size = finite(value);
  return size !== null && size > 0 ? size : null;
}

export function outerGroupId(element: Record<string, unknown>): string | null {
  const groups = element.groupIds;
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const outer = groups[groups.length - 1];
  return typeof outer === "string" && outer.length > 0 ? outer : null;
}

export function memberGeometry(element: Record<string, unknown>): ArrangeMember | null {
  const id = element.id;
  const x = finite(element.x);
  const y = finite(element.y);
  const width = finite(element.width);
  const height = finite(element.height);
  if (typeof id !== "string" || x === null || y === null) return null;
  if (width === null || height === null) return null;

  const member: ArrangeMember = { id, x, y, width, height };

  const fontSize = positive(element.fontSize);
  if (fontSize !== null) member.fontSize = fontSize;

  if (Array.isArray(element.points)) {
    const points: [number, number][] = [];
    for (const entry of element.points) {
      if (!Array.isArray(entry)) return null;
      const px = finite(entry[0]);
      const py = finite(entry[1]);
      if (px === null || py === null) return null;
      points.push([px, py]);
    }
    member.points = points;
  }

  return member;
}

function unionBox(members: readonly ArrangeMember[]) {
  return {
    x: Math.min(...members.map((member) => member.x)),
    y: Math.min(...members.map((member) => member.y)),
    right: Math.max(...members.map((member) => member.x + member.width)),
    bottom: Math.max(...members.map((member) => member.y + member.height)),
  };
}

function unarrangeable(element: Record<string, unknown>): boolean {
  return element.type === "frame" || element.type === "magicframe" || isPageBackground(element);
}

export function arrangeableUnits(elements: unknown, within?: readonly string[]): ArrangeBox[] {
  if (!Array.isArray(elements)) return [];
  const wanted = within ? new Set(within) : null;

  const live: Record<string, unknown>[] = [];
  for (const entry of elements) {
    const element = plainObject(entry);
    if (element && element.isDeleted !== true && typeof element.id === "string") {
      live.push(element);
    }
  }

  const labels = new Map<string, Record<string, unknown>[]>();
  for (const element of live) {
    const container = element.containerId;
    if (typeof container !== "string") continue;
    const existing = labels.get(container);
    if (existing) existing.push(element);
    else labels.set(container, [element]);
  }

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const element of live) {
    const group = outerGroupId(element);
    if (!group) continue;
    const existing = groups.get(group);
    if (existing) existing.push(element);
    else groups.set(group, [element]);
  }

  const units: ArrangeBox[] = [];
  const seenGroups = new Set<string>();

  for (const element of live) {
    if (element.type !== "image") continue;
    const group = outerGroupId(element);

    if (!group) {
      if (element.locked === true) continue;
      const id = element.id as string;
      if (wanted && !wanted.has(id)) continue;

      const x = finite(element.x);
      const y = finite(element.y);
      const width = positive(element.width);
      const height = positive(element.height);
      if (x === null || y === null || width === null || height === null) continue;

      units.push({
        id,
        x,
        y,
        width,
        height,
        referenceId: referenceIdFromFileId(element.fileId),
        frameId: typeof element.frameId === "string" ? element.frameId : null,
      });
      continue;
    }

    if (seenGroups.has(group)) continue;
    seenGroups.add(group);

    const parts = groups.get(group) ?? [];
    if (parts.some((part) => part.locked === true)) continue;
    if (parts.some(unarrangeable)) continue;
    if (wanted && !parts.some((part) => wanted.has(part.id as string))) continue;

    const members: ArrangeMember[] = [];
    let unreadable = false;
    for (const part of parts) {
      for (const piece of [part, ...(labels.get(part.id as string) ?? [])]) {
        const member = memberGeometry(piece);
        if (!member) {
          unreadable = true;
          break;
        }
        members.push(member);
      }
      if (unreadable) break;
    }
    if (unreadable || members.length === 0) continue;

    const bounds = unionBox(members);
    const width = bounds.right - bounds.x;
    const height = bounds.bottom - bounds.y;
    if (!(width > 0) || !(height > 0)) continue;

    units.push({
      id: group,
      x: bounds.x,
      y: bounds.y,
      width,
      height,
      referenceId: referenceIdFromFileId(element.fileId),
      frameId: typeof element.frameId === "string" ? element.frameId : null,
      members,
      photos: parts.filter((part) => part.type === "image").length,
    });
  }

  return units;
}

function laysOut(
  box: ArrangeBox,
  frames: readonly FrameBox[],
  pages: readonly BoardPage[],
  pageIds: ReadonlySet<string>,
): FrameBox | null {
  const named = frameOf(frames, box.frameId);
  if (named && !pageIds.has(named.id)) return named;

  const page = pageHolding(pages, box);
  return page ? frameOf(frames, page.id) : null;
}

export function arrangeGroups(
  boxes: readonly ArrangeBox[],
  frames: readonly FrameBox[],
  pages: readonly BoardPage[] = [],
): ArrangeGroup[] {
  const free: ArrangeBox[] = [];
  const framed = new Map<string, ArrangeBox[]>();
  const pageIds = new Set(pages.map((page) => page.id));

  for (const box of boxes) {
    const frame = laysOut(box, frames, pages, pageIds);
    if (!frame) {
      free.push(box);
      continue;
    }
    const group = framed.get(frame.id);
    if (group) group.push(box);
    else framed.set(frame.id, [box]);
  }

  const groups: ArrangeGroup[] = free.length > 0 ? [{ frame: null, boxes: free }] : [];
  for (const frame of frames) {
    const boxesInFrame = framed.get(frame.id);
    if (boxesInFrame) {
      groups.push({ frame, boxes: boxesInFrame, ...(pageIds.has(frame.id) && { page: true }) });
    }
  }

  return groups;
}

function elementsOf(box: ArrangeBox): string[] {
  return box.members ? box.members.map((member) => member.id) : [box.id];
}

export function arrangeOwners(
  groups: readonly ArrangeGroup[],
  pageIds: ReadonlySet<string>,
): ArrangeOwner[] {
  const owners: ArrangeOwner[] = [];

  for (const group of groups) {
    const owner = group.page && group.frame ? group.frame.id : null;
    for (const box of group.boxes) {
      if (box.frameId === owner) continue;
      if (owner === null && !(box.frameId && pageIds.has(box.frameId))) continue;
      for (const id of elementsOf(box)) owners.push({ id, frameId: owner });
    }
  }

  return owners;
}

export function arrangeTargets(elements: unknown, appState: unknown): ArrangeTargets {
  const frames = boardFrames(elements);
  const pages = boardPages(elements);
  const pageIds = new Set(pages.map((page) => page.id));
  const all = arrangeableUnits(elements);

  const chosen = new Set(selectedElementIds(appState));
  const chosenFrames = new Set(
    frames.filter((frame) => chosen.has(frame.id)).map((frame) => frame.id),
  );
  const selected = all.filter((box) => {
    if (box.members ? box.members.some((member) => chosen.has(member.id)) : chosen.has(box.id)) {
      return true;
    }
    const frame = laysOut(box, frames, pages, pageIds);
    return frame !== null && chosenFrames.has(frame.id);
  });

  const boxes = selected.length >= 2 ? selected : all;
  const groups = arrangeGroups(boxes, frames, pages);
  return {
    scope: selected.length >= 2 ? "selection" : "board",
    boxes,
    groups,
    owners: arrangeOwners(groups, pageIds),
  };
}

function centreX(box: ArrangeBox) {
  return box.x + box.width / 2;
}

function centreY(box: ArrangeBox) {
  return box.y + box.height / 2;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function readingOrder(boxes: readonly ArrangeBox[]): ArrangeBox[] {
  if (boxes.length < 2) return [...boxes];

  const tolerance = median(boxes.map((box) => box.height)) / 2;
  const byRow = [...boxes].sort((a, b) => centreY(a) - centreY(b) || centreX(a) - centreX(b));

  const rows: ArrangeBox[][] = [];
  for (const box of byRow) {
    const row = rows[rows.length - 1];
    if (row && centreY(box) - centreY(row[0]!) <= tolerance) row.push(box);
    else rows.push([box]);
  }

  return rows.flatMap((row) => row.sort((a, b) => centreX(a) - centreX(b)));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function arrangeRows(
  boxes: readonly ArrangeBox[],
  order: ArrangeOrdering = readingOrder,
): ArrangeBox[] {
  const items = order(boxes);
  if (items.length === 0) return [];

  const aspects = items.map((box) => box.width / box.height);
  const totalAspect = aspects.reduce((sum, aspect) => sum + aspect, 0);
  const totalArea = items.reduce((sum, box) => sum + box.width * box.height, 0);

  const rowCount = Math.min(items.length, Math.max(1, Math.round(Math.sqrt(totalAspect))));
  const rowAspect = totalAspect / rowCount;
  const height = Math.sqrt(totalArea / totalAspect);

  const rows: number[][] = [];
  let current: number[] = [];
  let currentAspect = 0;
  for (let index = 0; index < items.length; index++) {
    current.push(index);
    currentAspect += aspects[index]!;
    if (currentAspect >= rowAspect && rows.length + 1 < rowCount) {
      rows.push(current);
      current = [];
      currentAspect = 0;
    }
  }
  if (current.length > 0) rows.push(current);

  const bounds = {
    x: Math.min(...items.map((box) => box.x)),
    y: Math.min(...items.map((box) => box.y)),
    right: Math.max(...items.map((box) => box.x + box.width)),
    bottom: Math.max(...items.map((box) => box.y + box.height)),
  };

  return placeRows(items, aspects, rows, height, {
    x: (bounds.x + bounds.right) / 2,
    y: (bounds.y + bounds.bottom) / 2,
  });
}

function placeRows(
  items: readonly ArrangeBox[],
  aspects: readonly number[],
  rows: readonly number[][],
  height: number,
  centre: { x: number; y: number },
): ArrangeBox[] {
  const rowWidths = rows.map(
    (row) =>
      row.reduce((sum, index) => sum + aspects[index]! * height, 0) +
      ARRANGE_GAP * (row.length - 1),
  );
  const width = Math.max(...rowWidths);
  const blockHeight = rows.length * height + ARRANGE_GAP * (rows.length - 1);
  const left = centre.x - width / 2;
  let top = centre.y - blockHeight / 2;

  const placed: ArrangeBox[] = [];
  rows.forEach((row, rowIndex) => {
    let x = left + (width - rowWidths[rowIndex]!) / 2;
    for (const index of row) {
      const item = items[index]!;
      const itemWidth = aspects[index]! * height;
      placed.push({
        id: item.id,
        referenceId: item.referenceId,
        frameId: item.frameId,
        ...(item.members ? { members: item.members, photos: item.photos } : {}),
        x: round(x),
        y: round(top),
        width: round(itemWidth),
        height: round(height),
      });
      x += itemWidth + ARRANGE_GAP;
    }
    top += height + ARRANGE_GAP;
  });

  return placed;
}

const FRAME_HEIGHT_STEPS = 20;

export function frameRows(
  boxes: readonly ArrangeBox[],
  frame: FrameBox,
  order: ArrangeOrdering = readingOrder,
): ArrangeBox[] {
  const items = order(boxes);
  if (items.length === 0) return [];

  const inner = frameInnerBox(frame);
  if (inner.width <= 0 || inner.height <= 0) return [];

  const aspects = items.map((box) => box.width / box.height);

  const pack = (height: number): number[][] | null => {
    const rows: number[][] = [];
    let current: number[] = [];
    let width = 0;

    for (let index = 0; index < items.length; index++) {
      const itemWidth = aspects[index]! * height;
      if (itemWidth > inner.width) return null;
      const extended = current.length === 0 ? itemWidth : width + ARRANGE_GAP + itemWidth;
      if (current.length > 0 && extended > inner.width) {
        rows.push(current);
        current = [index];
        width = itemWidth;
      } else {
        current.push(index);
        width = extended;
      }
    }
    if (current.length > 0) rows.push(current);

    const blockHeight = rows.length * height + ARRANGE_GAP * (rows.length - 1);
    return blockHeight <= inner.height ? rows : null;
  };

  let low = 0;
  let high = inner.height;
  let best: { height: number; rows: number[][] } | null = null;
  for (let step = 0; step < FRAME_HEIGHT_STEPS; step++) {
    const height = (low + high) / 2;
    const rows = pack(height);
    if (rows) {
      best = { height, rows };
      low = height;
    } else {
      high = height;
    }
  }
  if (!best) return [];

  return placeRows(items, aspects, best.rows, best.height, {
    x: inner.x + inner.width / 2,
    y: inner.y + inner.height / 2,
  });
}

export const MOVED = 0.5;

export function arrangeChanges(
  boxes: readonly ArrangeBox[],
  order?: ArrangeOrdering,
): ArrangeBox[] {
  return changed(boxes, arrangeRows(boxes, order));
}

function changed(
  boxes: readonly ArrangeBox[],
  placed: readonly ArrangeBox[],
): ArrangeBox[] {
  const before = new Map(boxes.map((box) => [box.id, box]));
  return placed.filter((box) => {
    const original = before.get(box.id)!;
    return (
      Math.abs(original.x - box.x) > MOVED ||
      Math.abs(original.y - box.y) > MOVED ||
      Math.abs(original.width - box.width) > MOVED ||
      Math.abs(original.height - box.height) > MOVED
    );
  });
}

export function groupChanges(
  groups: readonly ArrangeGroup[],
  order?: ArrangeOrdering,
): ArrangeBox[] {
  return groups.flatMap((group) =>
    changed(
      group.boxes,
      group.frame ? frameRows(group.boxes, group.frame, order) : arrangeRows(group.boxes, order),
    ),
  );
}

export type ElementPlacement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  points?: [number, number][];
};

export function elementPlacements(
  before: readonly ArrangeBox[],
  moved: readonly ArrangeBox[],
): ElementPlacement[] {
  const originals = new Map(before.map((box) => [box.id, box]));

  return moved.flatMap((box): ElementPlacement[] => {
    if (!box.members) {
      return [{ id: box.id, x: box.x, y: box.y, width: box.width, height: box.height }];
    }

    const original = originals.get(box.id);
    if (!original) return [];
    const scale =
      original.width > 0
        ? box.width / original.width
        : original.height > 0
          ? box.height / original.height
          : 1;

    return box.members.map((member) => {
      const placement: ElementPlacement = {
        id: member.id,
        x: round(box.x + (member.x - original.x) * scale),
        y: round(box.y + (member.y - original.y) * scale),
        width: round(member.width * scale),
        height: round(member.height * scale),
      };
      if (member.fontSize !== undefined) placement.fontSize = round(member.fontSize * scale);
      if (member.points) {
        placement.points = member.points.map(([x, y]) => [round(x * scale), round(y * scale)]);
      }
      return placement;
    });
  });
}
