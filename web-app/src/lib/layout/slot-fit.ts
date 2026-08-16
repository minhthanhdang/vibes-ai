import type { BoardItem } from "@/lib/boards/board-contents";
import type {
  LayoutBlock,
  LayoutSlot,
  MoodboardLayout,
  Placement,
} from "@/lib/layout/moodboard-layouts";
import { CROP_ASPECTS, cropShapeAt, type CropAspectId, type CropShape } from "@/lib/references/reference-version";

/// The seam between agent 4 and agent 3, as arithmetic.
///
/// A composed board contains its photographs rather than filling their slots:
/// excalidraw stretches an image element to its box, so a slot filled edge to
/// edge is a photograph squashed to a shape it was not shot at. Which means a
/// portrait in a filmstrip frame sits in the middle of it with a band of page
/// either side, and the only thing that makes it fit is a *cut* — agent 3's
/// job, and until now a seam the design doc named and nothing crossed.
///
/// This is the crossing: after the board is written, which pictures sit loosely
/// in their slot and what shape each of them would have to be. The answer rides
/// back on `compose_moodboard` so the orchestrator can offer the crop, and the
/// shape is one of `CROP_ASPECTS` so the offer is a `crop_reference` call it can
/// already make — no new declaration, no new model call, no coordinates.
///
/// Pure: shapes in, shapes out.

/// How much of its slot a contained picture has to cover before the space
/// around it stops being worth a sentence.
///
/// Area, not edge: a 3:2 photograph in a 16:9 slot covers 84% and reads as
/// deliberate breathing room, while the same photograph in a 9:16 slot covers
/// 30% and reads as a mistake. 0.8 sits above the first and well under the
/// second.
export const SLOT_FILL_FLOOR = 0.8;

/// How much more of the slot the cut has to buy before it is worth offering.
///
/// This is the cost rule and the loop guard in one. A crop is the most expensive
/// call in the pipeline, so a cut that closes two points of a gap is not worth a
/// photograph read — and HERO_LEFT's supporting strips are 3.52:1, wider than
/// any shape on the list, so a picture already cut to 2.39:1 for one of them
/// still sits under the floor. Measured on the *gain*, it is offered once and
/// then never again; measured on the floor alone, every rebuild of that board
/// would offer the same cut of the same picture forever.
export const SLOT_FILL_GAIN = 0.1;

/// The share of a slot's area a contained picture covers, 0–1.
///
/// Contained means one edge touches and the other is scaled with it, so the
/// answer is entirely a function of the two aspect ratios — the pixel sizes
/// cancel. Null for a picture whose size was never recorded: that one takes the
/// whole slot (the same call the drop makes), and a fit nobody can check is
/// worse than silence.
export function slotFill(slot: LayoutSlot, block: Pick<LayoutBlock, "width" | "height">) {
  const width = positive(block.width);
  const height = positive(block.height);
  if (!width || !height || !positive(slot.width) || !positive(slot.height)) return null;

  const picture = width / height;
  const opening = slot.width / slot.height;
  return Math.min(picture / opening, opening / picture);
}

/// The nearest shape a director can ask a crop to be held to.
///
/// Nearest in log space, because shape distance is multiplicative: 2.39:1 is as
/// far from 16:9 as 16:9 is from 1.34:1, and a linear difference would call the
/// wide end of the list interchangeable while splitting hairs at the square.
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

/// A picture on the board with space around it, and the cut that would close it.
export type LooseFit = {
  referenceId: string;
  slotId: string;
  /// Percent of the slot the picture covers as it stands. Said as a whole
  /// number because it is a sentence the director reads, not a measurement.
  fills: number;
  /// What it would cover once cut. 100, because a cut asked for a board is held
  /// to the *slot's* own shape rather than to the nearest of six names — the
  /// executor refines it (§V), so the six are the model's vocabulary and not the
  /// list of shapes a cut can be. Kept as a field rather than dropped because it
  /// is the half of the sentence that says the crop is worth making.
  fillsCropped: number;
  /// The shape to ask `crop_reference` for. One of the six names — the enum the
  /// declaration offers — and deliberately not the exact ratio: naming an
  /// arbitrary shape would widen the declaration for every turn to say something
  /// the server already knows and can apply for free.
  cropTo: CropAspectId;
};

/// Which of the pictures just placed sit loosely in their slots.
///
/// Two things are deliberately not reported. A picture whose size was never
/// recorded — nothing to measure, and it is drawn to the whole slot anyway. And
/// a picture the cut would not buy `SLOT_FILL_GAIN` more of the slot for: that is
/// the photograph read that changes nothing.
///
/// The gain is measured against the *slot*, because that is now the shape the cut
/// is held to: a crop asked for a board is refined to the opening it is filling
/// (§V), so the answer is the whole of what is showing rather than what the
/// nearest of six names would have left. That closes this loop by construction —
/// a picture cut to its slot fills it, so it is above the floor and never
/// mentioned again — where measuring against the nearest name left HERO_LEFT's
/// 3.52:1 strips unclosable by anything on the list and therefore never
/// mentioned at all.
///
/// Worst fit first, since one board can have several and the orchestrator is
/// being asked to name them in a sentence.
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
    /// The cut is made to `shape`, so what it covers is the slot itself. Held to
    /// the named shape instead this would be `slotFill(slot, CROP_ASPECTS[cropTo])`
    /// — and the gap between the two is exactly what this iteration bought.
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

/// The opening itself, as a shape a cut can be held to.
export function slotShape(slot: LayoutSlot): CropShape | null {
  if (!positive(slot.width) || !positive(slot.height)) return null;
  return cropShapeAt(slot.width / slot.height);
}

/// Which opening a picture on a stored board is sitting in, and what shape that
/// opening is.
///
/// The one thing `crop_reference` needs that its own arguments cannot carry: the
/// model names a board and a frame, and the exact ratio of the slot that frame
/// occupies is a fact about the scene. Strict, like everything built on
/// `scenePlacements` — a picture the director has dragged out of its slot is in
/// their arrangement rather than in an opening, and cutting it to a shape nobody
/// is holding it to would be the pipeline arguing with their hands.
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

/// What the orchestrator is to do about a loose fit, said once for both doors.
///
/// The compose that placed the picture and the read of a board already standing
/// are the same sentence, because they are the same situation: page showing
/// around a photograph, and one call that closes it.
export const LOOSE_IN_SLOT_NOTE =
  "these are on the board with page showing around them — offer the director a crop_reference at the shape beside each one, passing this board's id as boardId so the cut is held to that slot's own shape and takes the picture's place there the moment they accept it. Say that taking the cut is all it needs and do not call swap_on_board for it. Ask first; a cut nobody wanted is a row they have to delete";

/// How far a picture may sit from where the template put it and still count as
/// sitting in that slot. A fraction of the slot's own size, so a nudge on a
/// 1000-unit hero and a nudge on a 200-unit strip are the same nudge.
const SEATED_TOLERANCE = 0.01;

/// Radians. A picture turned by hand is not in its slot any more, it is where
/// the director put it — and the scatter's slots are tilted, so this cannot be
/// "the angle is zero".
const SEATED_ANGLE_TOLERANCE = 0.01;

/// The pictures of a *stored scene*, paired with the slots they are sitting in.
///
/// `looseFits` answers off placements, and a compose has them in hand. A board
/// that was composed an hour ago has only elements — so this is the way back:
/// the board remembers the template it was composed at (`Moodboard.layout`), the
/// slot coordinates are constants, and an element that is still where that
/// template put it can be paired with its slot by geometry alone.
///
/// The pairing is deliberately strict. A picture counts as being in a slot only
/// if it is the box `fitInSlot` would have drawn — contained, centred, touching
/// an edge, at the slot's own angle. Anything the director has moved, resized or
/// turned since is *their* arrangement, and reporting a gap between it and a
/// slot nobody is using any more would be the pipeline arguing with the hands
/// that composed the board. Such a picture is left out rather than guessed at,
/// which is the same call `slotFill` makes for a size that was never recorded.
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

/// Is this board still the arrangement its template composed — every picture on
/// it sitting in a slot of that template?
///
/// The question a caption asks. A board that has just been composed is named by
/// its template ("6 photographs · Hero left") and a board read back off its scene
/// was named by its page ("6 photographs · 1920×1080"), so the same board arrived
/// in the chat under two different names depending on which tool fetched it. The
/// template is the better name — it is the shape the director has been looking at
/// — but only while the board is still standing in it: once they have dragged a
/// picture out of its slot, the template is the shape the board *started* at and
/// the page is the only true thing left to say.
///
/// Strictly every picture, using the same pairing the fit report uses: one
/// photograph moved is an arrangement the template no longer describes.
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

/// Is this element the box the template would have drawn it as? The element's
/// own width and height carry the photograph's aspect ratio — a contained fit
/// preserves it — so the slot's arithmetic can be re-run against them without
/// the reference's pixel size, which is exactly what makes this a read.
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
