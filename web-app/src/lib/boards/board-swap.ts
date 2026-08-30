import { boardItems, type Rect } from "@/lib/boards/board-contents";
import { fitInSlot, type LayoutSlot, type MoodboardLayout } from "@/lib/layout/moodboard-layouts";
import { referenceFileId, referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";
import { boardPages, pageHolds, type BoardPage } from "@/lib/pages/board-pages";
import { pagedPlacements } from "@/lib/pages/page-fit";

export type SwapRequest = { takeOff: string; putOn: string };

export type TradedPlaces = {
  takeOff: string;
  putOn: string;
  putOnSlotId?: string;
  takeOffSlotId?: string;
};

export type SwappedPicture = {
  takeOff: string;
  putOn: string;
  slotId?: string;
};

export type SwapResult = {
  elements: SceneElement[];
  swapped: SwappedPicture[];
  traded: TradedPlaces[];
  notOnBoard: string[];
  alreadyOnBoard: string[];
};

type PictureSize = { width?: number | null; height?: number | null } | null | undefined;

export function swapOnBoard({
  elements,
  layout = null,
  swaps,
  sizeOf,
  onPage = null,
}: {
  elements: readonly SceneElement[];
  layout?: MoodboardLayout | null;
  swaps: readonly SwapRequest[];
  sizeOf: (referenceId: string) => PictureSize;
  onPage?: BoardPage | null;
}): SwapResult {
  const next = [...elements];
  const pages = boardPages(next);
  const slots = new Map<string, LayoutSlot>(
    layout
      ? pagedPlacements(boardItems(next), pages, layout).map(({ slot, block }) => [
          block.id,
          slot,
        ])
      : [],
  );

  const here = (element: SceneElement) => {
    if (!onPage) return true;
    const box = rectOf(element);
    return box !== null && pageHolds(pages, onPage, box);
  };

  const onBoard = new Set(
    next
      .filter((element) => here(element))
      .map((element) => referenceIdFromFileId(element.fileId))
      .filter((id): id is string => id !== null),
  );

  const swapped: SwappedPicture[] = [];
  const traded: TradedPlaces[] = [];
  const notOnBoard: string[] = [];
  const alreadyOnBoard: string[] = [];
  const used = new Set<number>();

  const carrying = (referenceId: string) =>
    next.findIndex(
      (element, at) =>
        !used.has(at) &&
        element.type === "image" &&
        referenceIdFromFileId(element.fileId) === referenceId &&
        here(element),
    );

  const landing = (element: SceneElement, slot: LayoutSlot | undefined, referenceId: string) => {
    const size = pictureSize(sizeOf(referenceId));
    return slot
      ? fitInSlot(slot, { id: referenceId, kind: "image", width: size?.width, height: size?.height })
      : reweighted(rectOf(element), size);
  };

  for (const { takeOff, putOn } of swaps) {
    if (!takeOff || !putOn || takeOff === putOn) continue;

    const index = carrying(takeOff);
    if (index < 0) {
      notOnBoard.push(takeOff);
      continue;
    }

    const element = next[index];
    const slot = slots.get(takeOff);

    if (onBoard.has(putOn)) {
      const other = carrying(putOn);
      if (other < 0) {
        alreadyOnBoard.push(putOn);
        continue;
      }

      const held = next[other];
      const heldSlot = slots.get(putOn);
      const intoTakeOffs = landing(element, slot, putOn);
      const intoPutOns = landing(held, heldSlot, takeOff);

      next[index] = { ...element, fileId: referenceFileId(putOn), ...(intoTakeOffs ?? {}) };
      next[other] = { ...held, fileId: referenceFileId(takeOff), ...(intoPutOns ?? {}) };
      used.add(index);
      used.add(other);
      traded.push({
        takeOff,
        putOn,
        ...(slot && { putOnSlotId: slot.id }),
        ...(heldSlot && { takeOffSlotId: heldSlot.id }),
      });
      continue;
    }

    const box = landing(element, slot, putOn);

    next[index] = { ...element, fileId: referenceFileId(putOn), ...(box ?? {}) };
    used.add(index);
    onBoard.delete(takeOff);
    onBoard.add(putOn);
    swapped.push({ takeOff, putOn, ...(slot && { slotId: slot.id }) });
  }

  return { elements: next, swapped, traded, notOnBoard, alreadyOnBoard };
}

function reweighted(box: Rect | null, size: { width: number; height: number } | null): Rect | null {
  if (!box || !size) return box;

  const height = Math.round(Math.sqrt((box.width * box.height * size.height) / size.width));
  const width = Math.round(height * (size.width / size.height));
  if (!(width > 0) || !(height > 0)) return box;

  return {
    x: Math.round(box.x + (box.width - width) / 2),
    y: Math.round(box.y + (box.height - height) / 2),
    width,
    height,
  };
}

function rectOf(element: SceneElement): Rect | null {
  const x = finite(element.x);
  const y = finite(element.y);
  const width = finite(element.width);
  const height = finite(element.height);
  if (x === null || y === null || !width || !height || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function pictureSize(size: PictureSize) {
  const width = finite(size?.width);
  const height = finite(size?.height);
  return width && height && width > 0 && height > 0 ? { width, height } : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
