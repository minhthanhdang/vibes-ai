import type { BoardItem } from "@/lib/boards/board-contents";
import type { LayoutBlock, LayoutSlot, MoodboardLayout, Placement } from "@/lib/layout/moodboard-layouts";
import { scenePlacements } from "@/lib/layout/slot-fit";

/// Which of a board's blocks are already sitting somewhere, when the board is
/// rebuilt to put one picture on it or take one off.
///
/// A rebuild asks the compositor for an assignment of *every* block to *every*
/// slot, which is the right question for a board that does not exist yet and the
/// wrong one for a board the user is looking at: adding a ninth photograph to
/// a 3×3 re-decides where the other eight go, so a call that named one picture
/// moves nine. The reason that is a correctness problem rather than a taste one is
/// the crop→board loop — a cut is held to the exact shape of the opening it was
/// made for (§V), so a reflow that moves it into a different slot turns the
/// photograph read the user just paid for into a loose fit again.
///
/// So: a picture still sitting where the template put it keeps its slot, and the
/// compositor is asked only about what has no place yet, against the slots that
/// are free. When nothing is joining — a pure removal — there is nothing left to
/// judge and no call to make.
///
/// Strict about what counts as sitting somewhere, because it is built on
/// `scenePlacements`: a picture the user has dragged, resized or turned is in
/// their arrangement rather than in a slot, and pinning it would be the pipeline
/// deciding their hands meant the template.
///
/// Pure: a scene, a template and a block list in; three lists out.

export type KeptSeats = {
  /// Blocks that are staying exactly where they are, with the slot each is in.
  kept: Placement[];
  /// The slots nothing is sitting in — the only ones the compositor is offered.
  free: LayoutSlot[];
  /// The blocks with no place yet: the pictures joining the board, and every line
  /// of text that is not already set at a text slot.
  joining: LayoutBlock[];
};

/// How far a text element may sit from its slot and still count as set in it.
/// The same fraction-of-the-slot rule the picture pairing uses, so a nudge on a
/// wide headline block and a nudge on a narrow caption are the same nudge.
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

  /// The pictures, by geometry: an element that is the box `fitInSlot` would have
  /// drawn is in that slot. The block kept is the *offered* one rather than the
  /// element's own box, so the picture is re-drawn from the reference's recorded
  /// size and a rebuild cannot shrink it a little every time.
  for (const { slot, block } of scenePlacements(items, layout)) {
    const staying = offered.get(block.id);
    if (!staying || staying.kind !== "image" || takenBlocks.has(staying.id)) continue;
    takenSlots.set(slot.id, staying);
    takenBlocks.add(staying.id);
  }

  /// The lines, by geometry *and* by words. A text block has no id of its own on
  /// the board — it is its words — so a line counts as already set only when the
  /// element carrying those words is still at a text slot's own box.
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
  /// Slot order, so the merged plan reads the way the board does rather than the
  /// way the two lists were built.
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

/// Is this text element the box a text slot is written at? `composeLayoutElements`
/// puts a line at the slot's own origin and width — the height follows the type —
/// so those three are what says "still set here".
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

/// The same words, whatever they were retyped as. Matched the way every other
/// line edit in this layer matches: whitespace collapsed and case ignored, because
/// a wording arrives quoted back rather than as an id.
function sameWords(a: string | null | undefined, b: string | null | undefined) {
  const words = (text: string | null | undefined) =>
    (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const left = words(a);
  return left.length > 0 && left === words(b);
}
