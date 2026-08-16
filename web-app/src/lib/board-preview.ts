import { fitInSlot, type Placement, type SlotKind } from "./moodboard-layouts";

/// One thing on the miniature, in percent of the page.
///
/// Percent rather than page units because the tile that draws it does not know
/// the page size and should not have to: it draws a box at `aspectRatio` and
/// puts these inside it, so the same numbers are right at any width.
export type BoardPreviewItem = {
  kind: SlotKind;
  left: number;
  top: number;
  width: number;
  height: number;
  /// Degrees clockwise, for CSS. Excalidraw's own angle is radians about the
  /// element's centre, which is what a CSS rotate already is.
  angle?: number;
  /// The photograph, for an image item. Absent when the reference has no
  /// thumbnail yet — the box is still drawn, because a picture that has not
  /// finished uploading is on the board all the same.
  thumbUrl?: string;
};

/// The arrangement itself, small enough to put on an attachment.
export type BoardPreview = {
  /// The page's shape, so the miniature is the board's proportions and not the
  /// strip's.
  aspectRatio: number;
  items: BoardPreviewItem[];
};

/// Percent, to two places. A board is at most a dozen items and each carries
/// four of these, so the precision that survives is the precision a 200px-wide
/// tile can draw.
function percent(value: number, of: number) {
  const share = (value / of) * 100;
  return Math.round(share * 100) / 100 || 0;
}

/// A composed board as the chat can draw it without a canvas.
///
/// The boxes are `fitInSlot`'s, not the slots' — the same arithmetic the scene
/// is written with — so a photograph sitting loose in its slot is loose in the
/// miniature too. That is the point of showing the arrangement rather than one
/// photograph off it: the gap the answer's `looseInSlot` names is the gap the
/// director can see.
///
/// Images before text, the order `composedScene` writes them in, so a caption
/// lands over its photograph here the way it does on the board.
export function boardPreview(
  placements: readonly Placement[],
  page: { width: number; height: number },
  thumbUrlOf: (referenceId: string) => string | null | undefined,
): BoardPreview | null {
  if (!(page.width > 0) || !(page.height > 0)) return null;

  const items = placements.map(({ slot, block }): BoardPreviewItem => {
    const box = slot.kind === "image" ? fitInSlot(slot, block) : slot;
    const thumbUrl = slot.kind === "image" ? thumbUrlOf(block.id) : null;
    return {
      kind: slot.kind,
      left: percent(box.x, page.width),
      top: percent(box.y, page.height),
      width: percent(box.width, page.width),
      height: percent(box.height, page.height),
      ...(slot.angle && { angle: Math.round(((slot.angle * 180) / Math.PI) * 100) / 100 }),
      ...(thumbUrl && { thumbUrl }),
    };
  });

  if (!items.length) return null;

  return {
    aspectRatio: page.width / page.height,
    items: [
      ...items.filter((item) => item.kind === "image"),
      ...items.filter((item) => item.kind !== "image"),
    ],
  };
}
