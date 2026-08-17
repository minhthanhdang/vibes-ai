import { boardItems, type BoardItem, type Rect } from "@/lib/boards/board-contents";
import { DROPPED_IMAGE_GAP, DROPPED_IMAGE_MAX_EDGE, droppedImageSize } from "@/lib/canvas/moodboard-drop";
import { referenceFileId, referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

/// Putting a picture on a board the user arranged themselves, and taking one
/// off, without laying the board out again.
///
/// `swapOnBoard` made the argument for a picture in the *place of* another and
/// `rewordOnBoard` for the words of a line. This is the third verb of the same
/// field and the one that was still going through a rebuild: "put the sunset on
/// that board too". On a board standing in its template a rebuild is the right
/// answer — a 3×3 that gains a tenth picture wants a bigger template and every
/// slot reassigned. On a board the user dragged together there is no template
/// to reflow into, so the rebuild *invents* one from the block count and writes it
/// over an arrangement they made by hand. Adding a photograph is not a reason to
/// lose the board.
///
/// Nothing here is open to judgement: a picture joining a hand-arranged board goes
/// where there is room, which is under what is already there — the same place a
/// drop puts it, at the size the board's own pictures are.
///
/// No canvas, no React, no DOM.

export type PlaceResult = {
  elements: SceneElement[];
  /// The pictures that joined the board, in the order they were named.
  added: string[];
  removed: string[];
  /// Asked off a board no element of which carries it: the model meant a
  /// different picture and only the user can say which.
  notOnBoard: string[];
  alreadyOn: string[];
};

type PictureSize = { width?: number | null; height?: number | null } | null | undefined;

/// The scene with the named pictures taken off and the named ones put on.
///
/// Removal is exact: every element pointing at that reference goes, so a
/// photograph the user had dropped twice leaves once.
///
/// A picture joining the board is laid in a row beneath everything on it, centred
/// on what is there, at the size the board's other pictures are — the median
/// longest edge rather than the drop's own 320, because a picture arriving among
/// six large ones at a fifth of their size reads as a mistake rather than as a
/// choice. Appended to the end of the array, which is where a drop puts one too:
/// the newest thing on a board is the thing on top of it.
export function placeOnBoard({
  elements,
  page,
  add = [],
  remove = [],
  sizeOf,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  /// The rectangle the board's own arrangement is measured against when there is
  /// nothing on it to measure. It carries a corner because it is a *page* now
  /// (§V) and not every page sits at the origin — a page-scoped edit passes the
  /// page's own rect, so a picture joining an empty page 2 lands on page 2.
  page: Rect;
  add?: readonly string[];
  remove?: readonly string[];
  sizeOf: (referenceId: string) => PictureSize;
  makeId?: () => string;
}): PlaceResult {
  const asked = [...new Set(remove.map((id) => id.trim()).filter(Boolean))];
  const dropped = new Set(asked);

  const carried = new Set(
    elements
      .map((element) => referenceIdFromFileId(element.fileId))
      .filter((id): id is string => id !== null),
  );

  const kept = elements.filter((element) => {
    const referenceId = referenceIdFromFileId(element.fileId);
    return !(referenceId && dropped.has(referenceId));
  });

  const wanted = [...new Set(add.map((id) => id.trim()).filter(Boolean))];
  /// A picture already on the board is not drawn twice — the same refusal the
  /// swap makes, and for the same reason: two elements of one photograph is a
  /// board the user cannot point at unambiguously.
  const alreadyOn = wanted.filter((id) => carried.has(id) && !dropped.has(id));
  const joining = wanted.filter((id) => !carried.has(id) || dropped.has(id));

  return {
    elements: [...kept, ...placed(joining, boardItems(kept), page, sizeOf, makeId)],
    added: joining,
    removed: asked.filter((id) => carried.has(id)),
    notOnBoard: asked.filter((id) => !carried.has(id)),
    alreadyOn,
  };
}

function placed(
  joining: readonly string[],
  onBoard: readonly BoardItem[],
  page: Rect,
  sizeOf: (referenceId: string) => PictureSize,
  makeId: () => string,
): SceneElement[] {
  if (!joining.length) return [];

  const edge = houseSize(onBoard);
  const boxes = joining.map((referenceId) => ({ referenceId, ...sizedAt(sizeOf(referenceId), edge) }));

  const room = arrangementBounds(onBoard, page);
  const width =
    boxes.reduce((total, box) => total + box.width, 0) + DROPPED_IMAGE_GAP * (boxes.length - 1);
  const tallest = Math.max(...boxes.map((box) => box.height));
  const top = room.y + room.height + DROPPED_IMAGE_GAP;

  let left = room.x + room.width / 2 - width / 2;
  return boxes.map((box) => {
    const x = left;
    left += box.width + DROPPED_IMAGE_GAP;
    return {
      id: makeId(),
      type: "image",
      fileId: referenceFileId(box.referenceId),
      /// Never `pending`: the file entry is a reference pointer the board load
      /// rebuilds every time, so the element is complete the moment it lands.
      status: "saved",
      x: round(x),
      /// Centred on the row's own midline, so a portrait and a landscape joining
      /// together sit on one axis rather than on their top edges.
      y: round(top + (tallest - box.height) / 2),
      width: box.width,
      height: box.height,
    } satisfies SceneElement;
  });
}

/// How big the pictures on this board are, which is how big a new one should be.
/// The median rather than the mean: one photograph blown up to a backdrop is a
/// deliberate thing a user does, and it should not decide the size of
/// everything that follows it.
function houseSize(onBoard: readonly BoardItem[]): number {
  const edges = onBoard
    .filter((item) => item.kind === "image")
    .map((item) => Math.max(item.width, item.height))
    .sort((a, b) => a - b);
  if (!edges.length) return DROPPED_IMAGE_MAX_EDGE;
  return edges[Math.floor((edges.length - 1) / 2)];
}

/// The reference's shape at the board's own scale. A reference whose pixel size
/// was never recorded lands square, exactly as a drop of it would — guessing a
/// shape would be worse than an obviously neutral one.
function sizedAt(size: PictureSize, edge: number) {
  const shape = droppedImageSize(size?.width ?? null, size?.height ?? null);
  const scale = edge / DROPPED_IMAGE_MAX_EDGE;
  return { width: round(shape.width * scale), height: round(shape.height * scale) };
}

/// What the new row is placed under and centred on: everything on the board, or
/// the page when there is nothing on it. Deliberately not `sceneBounds`, which
/// always covers the page — a hand-arranged board whose pictures sit in one
/// corner would put the new one a page-height away from them.
export function arrangementBounds(
  onBoard: readonly BoardItem[],
  page: Rect,
): { x: number; y: number; width: number; height: number } {
  if (!onBoard.length) return { x: page.x, y: page.y, width: page.width, height: 0 };

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const item of onBoard) {
    left = Math.min(left, item.x);
    top = Math.min(top, item.y);
    right = Math.max(right, item.x + item.width);
    bottom = Math.max(bottom, item.y + item.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
