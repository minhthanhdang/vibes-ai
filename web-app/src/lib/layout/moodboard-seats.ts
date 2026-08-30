import type { BoardItem } from "@/lib/boards/board-contents";
import type { LayoutBlock, LayoutSlot, MoodboardLayout, Placement } from "@/lib/layout/moodboard-layouts";
import { scenePlacements } from "@/lib/layout/slot-fit";
import { lineKey } from "@/lib/util/text";

export type KeptSeats = {
  kept: Placement[];
  free: LayoutSlot[];
  joining: LayoutBlock[];
};

const SET_TOLERANCE = 0.01;

export function keptSeats({
  items,
  layout,
  blocks,
}: {
  items: readonly BoardItem[];
  layout: MoodboardLayout;
  blocks: readonly LayoutBlock[];
}): KeptSeats {
  const offered = new Map(blocks.map((block) => [block.id, block]));
  const takenSlots = new Map<string, LayoutBlock>();
  const takenBlocks = new Set<string>();

  for (const { slot, block } of scenePlacements(items, layout)) {
    const staying = offered.get(block.id);
    if (!staying || staying.kind !== "image" || takenBlocks.has(staying.id)) continue;
    takenSlots.set(slot.id, staying);
    takenBlocks.add(staying.id);
  }

  for (const slot of layout.slots) {
    if (slot.kind !== "text" || takenSlots.has(slot.id)) continue;
    const set = items.find((item) => item.kind === "text" && setIn(slot, item));
    if (!set) continue;
    const line = blocks.find(
      (block) => block.kind === "text" && !takenBlocks.has(block.id) && sameWords(block.text, set.text),
    );
    if (!line) continue;
    takenSlots.set(slot.id, line);
    takenBlocks.add(line.id);
  }

  const kept: Placement[] = [];
  const free: LayoutSlot[] = [];
  for (const slot of layout.slots) {
    const block = takenSlots.get(slot.id);
    if (block) kept.push({ slot, block });
    else free.push(slot);
  }

  return {
    kept,
    free,
    joining: blocks.filter((block) => !takenBlocks.has(block.id)),
  };
}

function setIn(slot: LayoutSlot, item: BoardItem) {
  return (
    near(item.x, slot.x, slot.width) &&
    near(item.y, slot.y, slot.height) &&
    near(item.width, slot.width, slot.width)
  );
}

function near(a: number, b: number, span: number) {
  return Math.abs(a - b) <= Math.max(1, span * SET_TOLERANCE);
}

function sameWords(a: string | null | undefined, b: string | null | undefined) {
  const left = lineKey(a ?? "");
  return left.length > 0 && left === lineKey(b ?? "");
}
