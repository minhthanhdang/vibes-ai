import type { BoardItem } from "@/lib/boards/board-contents";
import type {
  LayoutBlock,
  LayoutSlot,
  MoodboardLayout,
  Placement,
} from "@/lib/layout/moodboard-layouts";
import { CROP_ASPECTS, cropShapeAt, type CropAspectId, type CropShape } from "@/lib/references/reference-version";

export const SLOT_FILL_FLOOR = 0.8;

export const SLOT_FILL_GAIN = 0.1;

export function slotFill(slot: LayoutSlot, block: Pick<LayoutBlock, "width" | "height">) {
  const width = positive(block.width);
  const height = positive(block.height);
  if (!width || !height || !positive(slot.width) || !positive(slot.height)) return null;

  const picture = width / height;
  const opening = slot.width / slot.height;
  return Math.min(picture / opening, opening / picture);
}

export function nearestCropAspect(ratio: number): CropAspectId | null {
  if (!positive(ratio)) return null;
  let nearest: CropAspectId | null = null;
  let best = Infinity;
  for (const [id, value] of Object.entries(CROP_ASPECTS) as [CropAspectId, number][]) {
    const distance = Math.abs(Math.log(value / ratio));
    if (distance < best) {
      best = distance;
      nearest = id;
    }
  }
  return nearest;
}

export type LooseFit = {
  referenceId: string;
  slotId: string;
  fills: number;
  fillsCropped: number;
  cropTo: CropAspectId;
};

export function looseFits(
  placements: readonly Placement[],
  { floor = SLOT_FILL_FLOOR, gain = SLOT_FILL_GAIN }: { floor?: number; gain?: number } = {},
): LooseFit[] {
  const loose: LooseFit[] = [];

  for (const { slot, block } of placements) {
    if (slot.kind !== "image" || block.kind !== "image") continue;
    const fill = slotFill(slot, block);
    if (fill === null || fill >= floor) continue;

    const shape = slotShape(slot);
    if (!shape) continue;
    const cropTo = nearestCropAspect(shape.ratio);
    if (!cropTo) continue;
    const cropped = 1;
    if (cropped - fill < gain) continue;

    loose.push({
      referenceId: block.id,
      slotId: slot.id,
      fills: percent(fill),
      fillsCropped: percent(cropped),
      cropTo,
    });
  }

  return loose.sort((a, b) => a.fills - b.fills);
}

export function slotShape(slot: LayoutSlot): CropShape | null {
  if (!positive(slot.width) || !positive(slot.height)) return null;
  return cropShapeAt(slot.width / slot.height);
}

export function slotShapeFor(
  items: readonly BoardItem[],
  layout: MoodboardLayout,
  referenceId: string,
): { slotId: string; shape: CropShape } | null {
  for (const { slot, block } of scenePlacements(items, layout)) {
    if (block.id !== referenceId) continue;
    const shape = slotShape(slot);
    return shape ? { slotId: slot.id, shape } : null;
  }
  return null;
}

export const LOOSE_IN_SLOT_NOTE =
  "these are on the board with page showing around them — an edit_reference at the shape beside each one, passing this board's id as boardId, cuts the picture to that slot's own shape and puts the cut in its place there in the one call. Nothing else is owed for it; the exchange is made inside that call";

const SEATED_TOLERANCE = 0.01;

const SEATED_ANGLE_TOLERANCE = 0.01;

export function scenePlacements(
  items: readonly BoardItem[],
  layout: MoodboardLayout,
): Placement[] {
  const pictures = items.filter(
    (item): item is BoardItem & { referenceId: string } =>
      item.kind === "image" && typeof item.referenceId === "string" && item.referenceId !== "",
  );

  const placements: Placement[] = [];
  const taken = new Set<number>();

  for (const slot of layout.slots) {
    if (slot.kind !== "image") continue;

    let best = -1;
    let nearest = Infinity;
    pictures.forEach((item, index) => {
      if (taken.has(index) || !seatedIn(slot, item)) return;
      const distance = Math.hypot(
        item.x + item.width / 2 - (slot.x + slot.width / 2),
        item.y + item.height / 2 - (slot.y + slot.height / 2),
      );
      if (distance < nearest) {
        nearest = distance;
        best = index;
      }
    });
    if (best < 0) continue;

    taken.add(best);
    const item = pictures[best];
    placements.push({
      slot,
      block: { id: item.referenceId, kind: "image", width: item.width, height: item.height },
    });
  }

  return placements;
}

export function standsAsComposed(
  items: readonly BoardItem[],
  layout: MoodboardLayout | null,
): boolean {
  if (!layout) return false;
  const pictures = items.filter(
    (item) => item.kind === "image" && typeof item.referenceId === "string" && item.referenceId,
  );
  if (!pictures.length) return false;
  return scenePlacements(items, layout).length === pictures.length;
}

function seatedIn(slot: LayoutSlot, item: BoardItem) {
  if (Math.abs((item.angle ?? 0) - (slot.angle ?? 0)) > SEATED_ANGLE_TOLERANCE) return false;

  const scale = Math.min(slot.width / item.width, slot.height / item.height);
  const width = item.width * scale;
  const height = item.height * scale;

  return (
    near(width, item.width, slot.width) &&
    near(height, item.height, slot.height) &&
    near(slot.x + (slot.width - width) / 2, item.x, slot.width) &&
    near(slot.y + (slot.height - height) / 2, item.y, slot.height)
  );
}

function near(a: number, b: number, span: number) {
  return Math.abs(a - b) <= Math.max(1, span * SEATED_TOLERANCE);
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function percent(fill: number) {
  return Math.round(fill * 100);
}
