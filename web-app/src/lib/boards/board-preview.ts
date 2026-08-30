import type { BoardItem as BoardSceneItem, Rect } from "@/lib/boards/board-contents";
import { fitInSlot, type Placement, type SlotKind } from "@/lib/layout/moodboard-layouts";

export type BoardPreviewItem = {
  kind: SlotKind;
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
  thumbUrl?: string;
};

export type BoardPreview = {
  aspectRatio: number;
  items: BoardPreviewItem[];
};

function percent(value: number, of: number) {
  const share = (value / of) * 100;
  return Math.round(share * 100) / 100 || 0;
}

export function boardPreview(
  placements: readonly Placement[],
  page: { width: number; height: number },
  thumbUrlOf: (referenceId: string) => string | null | undefined,
): BoardPreview | null {
  return previewOf(
    placements.map(({ slot, block }) => ({
      kind: slot.kind,
      ...(slot.kind === "image" ? fitInSlot(slot, block) : slot),
      ...(slot.angle ? { angle: slot.angle } : {}),
      ...(slot.kind === "image" ? { thumbUrl: thumbUrlOf(block.id) } : {}),
    })),
    { x: 0, y: 0, ...page },
  );
}

export function scenePreview(
  items: readonly BoardSceneItem[],
  page: Rect,
  thumbUrlOf: (referenceId: string) => string | null | undefined,
): BoardPreview | null {
  return previewOf(
    items
      .filter((item) => item.kind !== "shape")
      .map((item) => ({
        kind: item.kind as "image" | "text",
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        ...(item.angle ? { angle: item.angle } : {}),
        ...(item.referenceId ? { thumbUrl: thumbUrlOf(item.referenceId) } : {}),
      })),
    page,
  );
}

type PreviewBox = Rect & { kind: SlotKind; angle?: number; thumbUrl?: string | null };

function previewOf(boxes: readonly PreviewBox[], page: Rect): BoardPreview | null {
  if (!(page.width > 0) || !(page.height > 0)) return null;

  const items = boxes.map(
    ({ kind, x, y, width, height, angle, thumbUrl }): BoardPreviewItem => ({
      kind,
      left: percent(x - page.x, page.width),
      top: percent(y - page.y, page.height),
      width: percent(width, page.width),
      height: percent(height, page.height),
      ...(angle && { angle: Math.round(((angle * 180) / Math.PI) * 100) / 100 }),
      ...(thumbUrl && { thumbUrl }),
    }),
  );

  if (!items.length) return null;

  return {
    aspectRatio: page.width / page.height,
    items: [
      ...items.filter((item) => item.kind === "image"),
      ...items.filter((item) => item.kind !== "image"),
    ],
  };
}
