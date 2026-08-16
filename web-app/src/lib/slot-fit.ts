import type { LayoutBlock, LayoutSlot, Placement } from "./moodboard-layouts";
import { CROP_ASPECTS, type CropAspectId } from "./reference-version";

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
  /// What it would cover cut to `cropTo`. Never 100: the shapes are a fixed
  /// list, so the nearest one to a slot is usually not the slot.
  fillsCropped: number;
  cropTo: CropAspectId;
};

/// Which of the pictures just placed sit loosely in their slots.
///
/// Two things are deliberately not reported. A picture whose size was never
/// recorded — nothing to measure, and it is drawn to the whole slot anyway. And
/// a picture whose nearest shape would not buy it `SLOT_FILL_GAIN` more of the
/// slot than it already covers: that is the cut that costs a photograph read to
/// change nothing, and the reason a board whose slots no shape can close is
/// mentioned once rather than on every rebuild.
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

    const cropTo = nearestCropAspect(slot.width / slot.height);
    if (!cropTo) continue;
    const cropped = slotFill(slot, { width: CROP_ASPECTS[cropTo], height: 1 });
    if (cropped === null || cropped - fill < gain) continue;

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

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function percent(fill: number) {
  return Math.round(fill * 100);
}
