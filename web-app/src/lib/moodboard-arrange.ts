import { DROPPED_IMAGE_GAP } from "./moodboard-drop";
import { referenceIdFromFileId } from "./moodboard-scene";
import { selectedElementIds } from "./moodboard-selection";

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

export type ArrangeTargets = {
  scope: ArrangeScope;
  boxes: ArrangeBox[];
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

/// Images only. A caption, an arrow pointing at a photo and a palette bar are on
/// the board *because* of where they are, and sweeping them into the grid would
/// destroy the one thing they carry. Tombstones are skipped for the obvious
/// reason and locked elements because locked means "not by accident" — which is
/// exactly what a one-click re-layout would be.
export function arrangeableImages(elements: unknown, within?: readonly string[]): ArrangeBox[] {
  if (!Array.isArray(elements)) return [];
  const wanted = within ? new Set(within) : null;

  const boxes: ArrangeBox[] = [];
  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element || element.isDeleted === true || element.locked === true) continue;
    if (element.type !== "image") continue;

    const id = element.id;
    if (typeof id !== "string" || (wanted && !wanted.has(id))) continue;

    const x = finite(element.x);
    const y = finite(element.y);
    const width = positive(element.width);
    const height = positive(element.height);
    if (x === null || y === null || width === null || height === null) continue;

    boxes.push({ id, x, y, width, height, referenceId: referenceIdFromFileId(element.fileId) });
  }

  return boxes;
}

/// A selection of two or more photos is the director saying which ones; anything
/// less is the whole board. Selecting one image and tidying is not a request to
/// arrange one image, so it falls through to the board rather than doing
/// nothing.
export function arrangeTargets(elements: unknown, appState: unknown): ArrangeTargets {
  const selected = arrangeableImages(elements, selectedElementIds(appState));
  if (selected.length >= 2) return { scope: "selection", boxes: selected };
  return { scope: "board", boxes: arrangeableImages(elements) };
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

  const rowWidths = rows.map(
    (row) =>
      row.reduce((sum, index) => sum + aspects[index]! * height, 0) +
      ARRANGE_GAP * (row.length - 1),
  );
  const width = Math.max(...rowWidths);
  const blockHeight = rows.length * height + ARRANGE_GAP * (rows.length - 1);

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
  const left = (bounds.x + bounds.right) / 2 - width / 2;
  let top = (bounds.y + bounds.bottom) / 2 - blockHeight / 2;

  const placed: ArrangeBox[] = [];
  rows.forEach((row, rowIndex) => {
    let x = left + (width - rowWidths[rowIndex]!) / 2;
    for (const index of row) {
      const itemWidth = aspects[index]! * height;
      placed.push({
        id: items[index]!.id,
        /// Carried through so the output is the same photos rather than four
        /// numbers each — which is what lets a second pass be ordered the same
        /// way as the first and come out a no-op.
        referenceId: items[index]!.referenceId,
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
  const before = new Map(boxes.map((box) => [box.id, box]));
  return arrangeRows(boxes, order).filter((placed) => {
    const original = before.get(placed.id)!;
    return (
      Math.abs(original.x - placed.x) > MOVED ||
      Math.abs(original.y - placed.y) > MOVED ||
      Math.abs(original.width - placed.width) > MOVED ||
      Math.abs(original.height - placed.height) > MOVED
    );
  });
}
