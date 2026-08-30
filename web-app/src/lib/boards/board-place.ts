import { boardItems, type BoardItem, type Rect } from "@/lib/boards/board-contents";
import { DROPPED_IMAGE_GAP, DROPPED_IMAGE_MAX_EDGE, droppedImageSize } from "@/lib/canvas/moodboard-drop";
import { referenceFileId, referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

export type PlaceResult = {
  elements: SceneElement[];
  added: string[];
  removed: string[];
  notOnBoard: string[];
  alreadyOn: string[];
};

type PictureSize = { width?: number | null; height?: number | null } | null | undefined;

export function placeOnBoard({
  elements,
  page,
  add = [],
  remove = [],
  sizeOf,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
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
      status: "saved",
      x: round(x),
      y: round(top + (tallest - box.height) / 2),
      width: box.width,
      height: box.height,
    } satisfies SceneElement;
  });
}

function houseSize(onBoard: readonly BoardItem[]): number {
  const edges = onBoard
    .filter((item) => item.kind === "image")
    .map((item) => Math.max(item.width, item.height))
    .sort((a, b) => a - b);
  if (!edges.length) return DROPPED_IMAGE_MAX_EDGE;
  return edges[Math.floor((edges.length - 1) / 2)];
}

function sizedAt(size: PictureSize, edge: number) {
  const shape = droppedImageSize(size?.width ?? null, size?.height ?? null);
  const scale = edge / DROPPED_IMAGE_MAX_EDGE;
  return { width: round(shape.width * scale), height: round(shape.height * scale) };
}

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
