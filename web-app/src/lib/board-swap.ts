import { boardItems, type Rect } from "./board-contents";
import { fitInSlot, type LayoutSlot, type MoodboardLayout } from "./moodboard-layouts";
import { referenceFileId, referenceIdFromFileId, type SceneElement } from "./moodboard-scene";
import { scenePlacements } from "./slot-fit";

/// One picture on a board, in place of another, and nothing else touched.
///
/// This is the last step of the loop `LOOSE_IN_SLOT_NOTE` writes out — a picture
/// sits loosely in its slot, the cropper offers a cut of it, the director takes
/// the cut, and the cut goes on the board. Until now that step went through
/// `compose_moodboard`'s add/remove, which is a *rebuild*: the compositor is paid
/// to reassign every block, and the arrangement the director had accepted a
/// moment earlier comes back reshuffled. Nobody asked for that, and on a board
/// they had dragged into shape by hand it is the arrangement itself that is lost.
///
/// A replacement is not a composition. Which picture goes where is already
/// settled — the answer is "where the old one was" — so there is no judgement
/// left to buy, and the whole operation is an edit to one element of the stored
/// scene. Zero model calls, and the only thing that moves is the box that had to.
///
/// No canvas, no React, no DOM.

export type SwapRequest = { takeOff: string; putOn: string };

export type SwappedPicture = {
  takeOff: string;
  putOn: string;
  /// The slot it went into, for a board still standing as it was composed. Absent
  /// for a picture the director had moved themselves — the box is still theirs,
  /// it is just holding something else now.
  slotId?: string;
};

export type SwapResult = {
  elements: SceneElement[];
  swapped: SwappedPicture[];
  /// Asked to take off a picture no element on the board carries. Said rather
  /// than ignored: it means a different picture was meant, and only the director
  /// knows which.
  notOnBoard: string[];
  /// Asked to put on a picture that is already there. Swapping it in would draw
  /// it twice, which is never what a replacement means.
  alreadyOnBoard: string[];
};

type PictureSize = { width?: number | null; height?: number | null } | null | undefined;

/// Put `putOn` where `takeOff` is, on the stored scene, for each pair in turn.
///
/// Two rules decide the new box, and which one applies is a question about the
/// *board* rather than about the picture:
///
/// - A picture still sitting where the board's template put it is re-fitted to
///   that slot. That is the whole point of the exchange: the cut was made to a
///   shape the slot could hold, so it is the slot the gain shows up against, not
///   the smaller box the loose original was drawn in.
/// - A picture the director moved, resized or turned is refitted to the room it
///   was occupying — same centre, same area, its own shape. Containing it in the
///   old box instead would shrink the picture on every swap, and a director who
///   sized a photograph on a hand-arranged board sized the *weight* of it.
export function swapOnBoard({
  elements,
  layout = null,
  swaps,
  sizeOf,
}: {
  elements: readonly SceneElement[];
  layout?: MoodboardLayout | null;
  swaps: readonly SwapRequest[];
  sizeOf: (referenceId: string) => PictureSize;
}): SwapResult {
  const next = [...elements];
  const slots = new Map<string, LayoutSlot>(
    layout
      ? scenePlacements(boardItems(next), layout).map(({ slot, block }) => [block.id, slot])
      : [],
  );

  const onBoard = new Set(
    next
      .map((element) => referenceIdFromFileId(element.fileId))
      .filter((id): id is string => id !== null),
  );

  const swapped: SwappedPicture[] = [];
  const notOnBoard: string[] = [];
  const alreadyOnBoard: string[] = [];
  /// An element may only be swapped once a call. Two pairs naming the same
  /// picture out would otherwise both land on the first element carrying it, and
  /// the second would undo the first.
  const used = new Set<number>();

  for (const { takeOff, putOn } of swaps) {
    if (!takeOff || !putOn || takeOff === putOn) continue;

    if (onBoard.has(putOn)) {
      alreadyOnBoard.push(putOn);
      continue;
    }

    const index = next.findIndex(
      (element, at) =>
        !used.has(at) &&
        element.type === "image" &&
        referenceIdFromFileId(element.fileId) === takeOff,
    );
    if (index < 0) {
      notOnBoard.push(takeOff);
      continue;
    }

    const element = next[index];
    const slot = slots.get(takeOff);
    const size = pictureSize(sizeOf(putOn));
    const box = slot
      ? fitInSlot(slot, { id: putOn, kind: "image", width: size?.width, height: size?.height })
      : reweighted(rectOf(element), size);

    next[index] = { ...element, fileId: referenceFileId(putOn), ...(box ?? {}) };
    used.add(index);
    onBoard.delete(takeOff);
    onBoard.add(putOn);
    swapped.push({ takeOff, putOn, ...(slot && { slotId: slot.id }) });
  }

  return { elements: next, swapped, notOnBoard, alreadyOnBoard };
}

/// The same room, at a different shape: centre and area kept, so a swap neither
/// shrinks the picture nor lets it grow into its neighbours.
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
