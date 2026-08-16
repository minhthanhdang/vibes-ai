import { DROPPED_IMAGE_GAP } from "@/lib/canvas/moodboard-drop";
import {
  boardFrames,
  frameInnerBox,
  frameOf,
  type FrameBox,
} from "@/lib/canvas/moodboard-frames";
import { referenceIdFromFileId } from "@/lib/scene/moodboard-scene";
import { selectedElementIds } from "@/lib/canvas/moodboard-selection";

/// Tidying the photos on a board into a justified grid.
///
/// Excalidraw aligns and distributes, but both keep every element the size it
/// already is — so a board collected over an afternoon (six from the sidebar,
/// two pasted, one dragged in from Pinterest at whatever size it happened to
/// land) stays a pile of mismatched rectangles no matter which of them is used.
/// A moodboard is read as one image, and the arrangement that makes a mixed set
/// read that way is rows of a common height with the edges lining up — which
/// means resizing, and that is the part excalidraw has no notion of.
///
/// No canvas, no React, no DOM: what goes in is boxes, what comes out is boxes.

/// The same gap a batch drop leaves between photos, for the same reason — the
/// grid has to read as separate images rather than as a contact sheet.
export const ARRANGE_GAP = DROPPED_IMAGE_GAP;

/// One element inside a unit that holds more than a photo, with the geometry a
/// rigid transform has to rewrite. `fontSize` and `points` are there because
/// scaling a text element without its size, or an arrow without its points,
/// leaves an element whose box and whose drawing disagree.
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
  /// Which reference the photo is of, so an ordering can ask what is *in* it —
  /// the colour sort is the only caller, and it is why the box carries a
  /// pointer at all rather than being four numbers.
  referenceId?: string | null;
  /// Which frame owns it, if any. Carried for the same reason: a layout has to
  /// know which section a photo is in before it decides where to put it.
  frameId?: string | null;
  /// Everything the unit is made of, when it is a *group* rather than a lone
  /// photo — the photo, its caption, the arrow pointing at it. Absent for an
  /// ungrouped photo, which is its own whole unit and needs no member list.
  members?: readonly ArrangeMember[];
  /// How many photos the group holds, so a control can still say how many images
  /// a tidy touches when one press moves more of them than it moves units.
  photos?: number;
};

/// How the grid is filled. The default is the order the board already reads in;
/// `colourOrder` is the other one, and a caller passes it rather than this
/// module knowing that palettes exist.
export type ArrangeOrdering = (boxes: readonly ArrangeBox[]) => ArrangeBox[];

/// What is being tidied, and whether the director asked for a part of the board
/// or all of it — the button says which, because "tidy" that silently moved the
/// whole board when two photos were selected would be the wrong action taken
/// without asking.
export type ArrangeScope = "selection" | "board";

/// One section's worth of photos. A `frame` of null is the canvas itself —
/// everything that is not in a section — and it is laid out on its own bounds;
/// a frame group is laid out *inside* the frame, which is what makes a frame a
/// section rather than a rectangle that happens to be behind some photos.
export type ArrangeGroup = {
  frame: FrameBox | null;
  boxes: ArrangeBox[];
};

export type ArrangeTargets = {
  scope: ArrangeScope;
  boxes: ArrangeBox[];
  groups: ArrangeGroup[];
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

/// The group an element belongs to as far as a click is concerned: excalidraw
/// nests groups and selects the outermost one, so that is the object the
/// director thinks they are moving.
function outerGroupId(element: Record<string, unknown>): string | null {
  const groups = element.groupIds;
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const outer = groups[groups.length - 1];
  return typeof outer === "string" && outer.length > 0 ? outer : null;
}

function memberGeometry(element: Record<string, unknown>): ArrangeMember | null {
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

/// What the layout moves around: a photo, or a *group* holding one. A caption, an
/// arrow pointing at a photo and a palette bar are on the board because of what
/// they sit next to, so none of them is ever laid out as a photo — but the moment
/// the director groups one with the photo it belongs to, it has said so, and the
/// tidy has to carry it along or the press that was supposed to straighten the
/// board is the press that separates every annotation on it from its subject.
///
/// A group is one unit whatever it holds: a group of five photos is an
/// arrangement the director composed, and packing it as a block keeps it while
/// still tidying the board around it. Tombstones are skipped for the obvious
/// reason and locked elements — including a group with one locked member —
/// because locked means "not by accident", which is exactly what a one-click
/// re-layout would be.
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

  /// A bound label has `containerId` and no `groupIds` of its own, so it is not
  /// in the group its container is in — it has to be collected from the other
  /// side or a labelled shape scales away from its own text.
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
    /// A frame owns what is inside it and is laid out *around* rather than with
    /// its contents; one caught in a group would be scaled by a rule written for
    /// what it contains.
    if (parts.some((part) => part.type === "frame" || part.type === "magicframe")) continue;
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
      /// The group's own id, so a unit is the same unit on the next pass and two
      /// photos in one group never produce two entries.
      id: group,
      x: bounds.x,
      y: bounds.y,
      width,
      height,
      /// The topmost photo's, so a colour sort files the group under the photo
      /// that was put down first and a group inside a section stays in it.
      referenceId: referenceIdFromFileId(element.fileId),
      frameId: typeof element.frameId === "string" ? element.frameId : null,
      members,
      photos: parts.filter((part) => part.type === "image").length,
    });
  }

  return units;
}

/// The photos split by the section they are in. The canvas group comes first
/// and the frames follow in z-order, so a caller writing them back in order
/// writes the board before its sections.
///
/// A `frameId` naming a frame that is not on the board is a photo on the canvas:
/// excalidraw clears membership when a frame is deleted, but a scene written by
/// something else could say otherwise, and laying a photo out inside a frame
/// that does not exist has nowhere to put it.
export function arrangeGroups(
  boxes: readonly ArrangeBox[],
  frames: readonly FrameBox[],
): ArrangeGroup[] {
  const free: ArrangeBox[] = [];
  const framed = new Map<string, ArrangeBox[]>();

  for (const box of boxes) {
    const frame = frameOf(frames, box.frameId);
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
    if (boxesInFrame) groups.push({ frame, boxes: boxesInFrame });
  }

  return groups;
}

/// A selection of two or more photos is the director saying which ones; anything
/// less is the whole board. Selecting one image and tidying is not a request to
/// arrange one image, so it falls through to the board rather than doing
/// nothing.
export function arrangeTargets(elements: unknown, appState: unknown): ArrangeTargets {
  const frames = boardFrames(elements);
  const all = arrangeableUnits(elements);

  /// Selecting a frame is selecting the section, so it aims the tidy at what is
  /// in it — the gesture a director reaches for on a board that has sections,
  /// and one that otherwise fell through to "tidy the whole board" because a
  /// frame is not itself a photo.
  const chosen = new Set(selectedElementIds(appState));
  const chosenFrames = new Set(
    frames.filter((frame) => chosen.has(frame.id)).map((frame) => frame.id),
  );
  /// A group's unit is keyed by the group rather than by an element, so what the
  /// selection has to be asked about is its members — selecting a captioned photo
  /// selects the photo and the caption, and neither of them is the unit's id.
  const selected = all.filter(
    (box) =>
      (box.members
        ? box.members.some((member) => chosen.has(member.id))
        : chosen.has(box.id)) ||
      (typeof box.frameId === "string" && chosenFrames.has(box.frameId)),
  );

  const boxes = selected.length >= 2 ? selected : all;
  return {
    scope: selected.length >= 2 ? "selection" : "board",
    boxes,
    groups: arrangeGroups(boxes, frames),
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

/// The order the grid is filled in, which is the order the board already reads
/// in — left to right, top to bottom. Tidying is meant to straighten what the
/// director arranged, not to reshuffle it into z-order, where the last photo
/// pasted would jump to the end no matter where it was put.
///
/// Rows are banded rather than sorted on `y` alone: two photos side by side are
/// never at the same pixel, and a strict sort would read a row as a diagonal.
/// The band is half the median height, and it is measured from the top member of
/// the row, so a long staircase eventually starts a new row — which is what it
/// looks like anyway.
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

/// The photos laid out in rows of one common height, each keeping its own
/// aspect ratio, rows centred under one another. It is the arrangement a contact
/// sheet and a shot list converge on, and the reason it is the right one for a
/// moodboard is that a set of photos at a common height reads as *one image* —
/// which is what a moodboard is for. A 6000px still dropped beside a thumbnail
/// saved off Pinterest does not, however carefully the two are lined up.
///
/// One height for the whole board rather than one per row (which is what a
/// justified layout gives, and what makes its edges flush): every photo on a
/// moodboard is a photo the director chose, and a layout that sizes a row of two
/// panoramas to the width of a row of five portraits has decided which of them
/// matters. The cost is a ragged right edge, which is the honest one.
///
/// The grid keeps exactly the area the photos already covered, so tidying does
/// not also zoom the board: what was on screen before is on screen after. That
/// is also what makes tidying twice the same as tidying once — the second pass
/// reads back the area and the aspect ratios the first one wrote.
export function arrangeRows(
  boxes: readonly ArrangeBox[],
  order: ArrangeOrdering = readingOrder,
): ArrangeBox[] {
  const items = order(boxes);
  if (items.length === 0) return [];

  const aspects = items.map((box) => box.width / box.height);
  const totalAspect = aspects.reduce((sum, aspect) => sum + aspect, 0);
  const totalArea = items.reduce((sum, box) => sum + box.width * box.height, 0);

  /// As square a block as the shapes allow: at a common height, a row of aspect
  /// sum `a` is `a` units wide and one unit tall, so `rows = √total` is the
  /// square one. A row of photos runs off the side of the viewport by six, and
  /// a column off the bottom.
  const rowCount = Math.min(items.length, Math.max(1, Math.round(Math.sqrt(totalAspect))));
  const rowAspect = totalAspect / rowCount;
  const height = Math.sqrt(totalArea / totalAspect);

  /// Greedy: a row closes as soon as it is as wide as the target, and the last
  /// one takes whatever is left — so it is the only row that can come out short,
  /// and being centred is what keeps that from reading as a missing corner.
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

  /// Centred on the middle of what it replaces, so the block is where the photos
  /// were and the director does not have to go looking for the board. The middle
  /// of the *bounds* rather than of the photos: the block's own bounds then land
  /// back on the same point, which is what makes a second tidy a no-op.
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

/// The rows put down around a centre point. Shared by the two layouts because
/// they differ only in how the common height and the row breaks are arrived at —
/// the free grid solves for the area it already covered, a frame solves for the
/// box it has to fit in, and both then land centred on a point.
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
        /// Carried through so the output is the same photos rather than four
        /// numbers each — which is what lets a second pass be ordered the same
        /// way as the first and come out a no-op.
        referenceId: item.referenceId,
        frameId: item.frameId,
        /// The originals, untouched: what a placed unit is *made of* has not
        /// changed, and `elementPlacements` needs the before-geometry to work
        /// out the transform the group has to be rewritten by.
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

/// How close the search for a frame's common height gets. Twenty halvings of a
/// frame's height is far under the rounding the placement does anyway, and the
/// count is fixed so the layout is the same function every time it is run — a
/// search that stopped on a tolerance would make the result depend on how big
/// the frame happened to be.
const FRAME_HEIGHT_STEPS = 20;

/// The photos filling a frame: the same rows of one common height, sized so the
/// block fits inside the frame and centred in it.
///
/// A frame is a section of the board with a size the director chose, so this
/// solves for that size rather than preserving the area the photos covered —
/// which is the whole difference between a section and a region of canvas. It is
/// still a fixed point: the frame does not move, so a second pass reads back the
/// same aspect ratios and solves the same problem.
///
/// The common height is found by halving rather than in closed form, because the
/// row breaks are decided greedily *from* the height: there is no formula that
/// gives the tallest height whose greedy packing still fits. Twenty steps is
/// exact to well under a pixel.
export function frameRows(
  boxes: readonly ArrangeBox[],
  frame: FrameBox,
  order: ArrangeOrdering = readingOrder,
): ArrangeBox[] {
  const items = order(boxes);
  if (items.length === 0) return [];

  const inner = frameInnerBox(frame);
  /// A frame too small to hold its own padding is one nothing can be laid out
  /// in; leaving its photos where they are says that better than piling them at
  /// a point.
  if (inner.width <= 0 || inner.height <= 0) return [];

  const aspects = items.map((box) => box.width / box.height);

  /// Greedy left to right, a row closing when the next photo would not fit the
  /// frame's width. Null means this height does not work at all — either one
  /// photo alone is wider than the frame, or the rows do not fit its height.
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

/// Half a scene unit is well under a pixel at any zoom a board is read at, so
/// two placements this close apart are the same placement — which is what keeps
/// the rounding of an already-tidy board from counting as a change.
const MOVED = 0.5;

/// What actually has to be written back. A board that is already tidy produces
/// nothing, so tidying it again is not an undo step that did nothing.
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

/// What a tidy of a board with sections has to write back: each frame's photos
/// laid out inside that frame, and everything else on the canvas laid out as one
/// grid. One list, because it is one edit and one undo step — a tidy that had to
/// be pressed once per section would be the arranging it exists to replace.
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

/// What one element has to be written back as. A lone photo is its unit, so this
/// is the placed box; a group is a rigid body, so every element in it is mapped
/// by the one transform that took the group's old bounds onto its new ones.
export type ElementPlacement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  points?: [number, number][];
};

/// The layout turned from units into elements.
///
/// A group scales as one object — the same thing excalidraw's own resize handles
/// do to a multi-element selection — because the alternative is a caption that
/// keeps its size while the photo above it halves, which is the arrangement the
/// director grouped them to avoid. The scale is uniform: the layout preserves
/// each unit's aspect ratio, so width and height are multiplied by one number.
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
    const scale = original.width > 0 ? box.width / original.width : 1;

    return box.members.map((member) => {
      const placement: ElementPlacement = {
        id: member.id,
        x: round(box.x + (member.x - original.x) * scale),
        y: round(box.y + (member.y - original.y) * scale),
        width: round(member.width * scale),
        height: round(member.height * scale),
      };
      /// Text has a size of its own that no width tells excalidraw about, so a
      /// caption scaled without it comes out at yesterday's point size inside
      /// today's box.
      if (member.fontSize !== undefined) placement.fontSize = round(member.fontSize * scale);
      /// An arrow or a stroke is drawn from its points, not from its box.
      if (member.points) {
        placement.points = member.points.map(([x, y]) => [round(x * scale), round(y * scale)]);
      }
      return placement;
    });
  });
}
