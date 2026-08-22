import {
  BACKDROP_COVERAGE,
  bandOccupancy,
  emptyBands,
  type OccupancyOptions,
} from "@/lib/render/occupancy";
import { rotatedBounds, type RenderDraw, type RenderPlan } from "@/lib/render/render-plan";

/// What a design left on a page, as one operator's line.
///
/// §VIII answers "free placement can make an ugly page" with a fixture set that
/// is eyeballed, and iterations of that set kept producing the same argument in
/// two places: `npm run design:fixtures` measured what landed and
/// `npm run design:check` — the typed, one-off ask — did not, so any question of
/// the form "does this ask read differently from that one" could only be put to
/// the three pinned fixtures. The read lives here so both doors say it, in the
/// same words, and so the arithmetic under it is testable without a bucket.
///
/// Nothing here is a verdict. `occupancy.ts` says why at length: a bare band is
/// sometimes the design. This is the same fact said for a person reading a
/// terminal rather than for a model reading a tool answer.

export type PlanRead = {
  /// What landed, by draw kind rather than by element — the thing that tells
  /// two run logs apart before anybody opens the pictures. An outline is its own
  /// kind because §III.2 makes it a shape the model was *told* about rather than
  /// one it saw.
  landed: string;
  /// The share of the frame the draw boxes add up to, overlaps counted twice.
  /// Not a coverage figure and deliberately not the union — a stack of four
  /// blocks on one spot passes 100% here and that is the reading that says
  /// "everything is piled in one corner", which the union hides.
  ink: number;
  /// The band read, said the way somebody would say it out loud.
  standing: string;
  /// The union share of the frame, from the same read the bands come from.
  covered: number;
  /// How much of each edge nothing reaches, as a share of that axis — the
  /// bounding box of everything that is not ground, measured against the frame.
  margins: Margins;
  /// The margins, said the way somebody would say them out loud, or the empty
  /// string when the design reaches every edge.
  framed: string;
};

export type Margins = { top: number; right: number; bottom: number; left: number };

const percent = (share: number) => `${Math.round(share * 100)}%`;

function landedIn(draws: readonly RenderDraw[]): string {
  const counted = new Map<string, number>();
  for (const draw of draws) counted.set(draw.kind, (counted.get(draw.kind) ?? 0) + 1);
  return [...counted].map(([kind, count]) => `${count} ${kind}`).join(", ") || "nothing";
}

/// Thirds have names here for the same reason they do in `occupancyNote`, and
/// past three the bands are numbered rather than given invented vocabulary.
function bandNames(count: number, axis: "y" | "x"): string {
  if (count !== 3) return `${count} bands`;
  return axis === "y" ? "top-middle-bottom" : "left-middle-right";
}

/// The margins the design left, which is the flaw the bands miss.
///
/// The three-band read cleared two of the three §VIII fixtures — the banner at
/// 7% / 53% / 7% and the spread at 14% / 68% / 4% named no band bare — and both
/// pictures show the same thing the welcome sign shows: a strip of content
/// floating in the middle of a frame a third taller than it needs. A band is
/// only bare when *nothing* reaches it, and one caption dipping into the bottom
/// third is enough to clear the floor while the other 29% of the page stays
/// white. The bounding box does not have that hole in it: it says how far the
/// work gets from each edge and it says it the same way whatever the ask was.
///
/// Ground is left out for the reason `bandOccupancy` leaves it out — a
/// full-bleed backdrop reaches every edge and would answer every page with
/// "no margins", which is the one answer that cannot be acted on.
///
/// What it said the first time all three fixtures were put through it, which is
/// the sharpest statement of §VIII's taste risk so far and the first one that
/// is the same sentence about all three:
///
///   welcome sign  1080x1920   nothing within 32% top, 39% bottom
///   banner        1920x1080   nothing within 28% top, 28% bottom
///   photo spread  1920x1080   nothing within 25% top, 29% bottom
///
/// A quarter to two fifths of the frame dead at each end, on every ask, and no
/// left or right margin over the floor on any of them. The design is not
/// misplacing its work — it is choosing a page a third taller than the work it
/// intends to put on it, and then centring. That is one flaw with one cause,
/// where the bands read as three unrelated numbers.
///
/// Deliberately not in `occupancyNote` and so not in any tool's answer. Four
/// separate attempts have now put this fact in front of the model — an
/// instruction correction, a skill paragraph, the band read in `get_page`, and
/// the ask reworded — and none of them moved the page (§VIII, `occupancy.ts`).
/// A fifth sentence is not the next thing to try.
function marginsOf(plan: RenderPlan): Margins {
  const area = plan.width * plan.height;
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;

  for (const draw of plan.draws) {
    const box = rotatedBounds(draw.box, draw.angle);
    if (area > 0 && (box.width * box.height) / area >= BACKDROP_COVERAGE) continue;
    top = Math.min(top, box.y);
    left = Math.min(left, box.x);
    bottom = Math.max(bottom, box.y + box.height);
    right = Math.max(right, box.x + box.width);
  }

  /// A page with nothing standing on it is all margin, which is the true answer
  /// and the one a caller can print beside "nothing".
  if (!Number.isFinite(top)) return { top: 1, right: 1, bottom: 1, left: 1 };

  const share = (value: number, span: number) =>
    span > 0 ? Math.min(1, Math.max(0, value / span)) : 0;
  return {
    top: share(top, plan.height),
    right: share(plan.width - right, plan.width),
    bottom: share(plan.height - bottom, plan.height),
    left: share(left, plan.width),
  };
}

/// Only the edges worth saying, and only past a margin a designer would have
/// chosen on purpose. A tenth of the frame is a margin; a third of it is the
/// page being the wrong size for the work on it.
const MARGIN_FLOOR = 0.1;

function framedIn(margins: Margins): string {
  const said = (["top", "right", "bottom", "left"] as const)
    .filter((edge) => margins[edge] >= MARGIN_FLOOR)
    .map((edge) => `${percent(margins[edge])} ${edge}`);
  return said.length ? `nothing within ${said.join(", ")}` : "";
}

export function planRead(plan: RenderPlan, options: OccupancyOptions = {}): PlanRead {
  const read = bandOccupancy(plan, options);
  const bare = emptyBands(read);
  const named =
    read.bands.length === 3
      ? read.axis === "y"
        ? ["top", "middle", "bottom"]
        : ["left", "middle", "right"]
      : read.bands.map((_, at) => `band ${at + 1}`);

  const area = plan.width * plan.height;
  const ink = area
    ? plan.draws.reduce((sum, { box }) => sum + box.width * box.height, 0) / area
    : 0;

  const standing = [
    `${read.bands.map(({ covered }) => percent(covered)).join(" / ")} ${bandNames(read.bands.length, read.axis)}`,
    read.backdrops ? `${read.backdrops} backdrop` : "",
    bare.length ? `${bare.map((at) => named[at]).join(" and ")} bare` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const margins = marginsOf(plan);
  return {
    landed: landedIn(plan.draws),
    ink,
    standing,
    covered: read.covered,
    margins,
    framed: framedIn(margins),
  };
}

/// The whole read on one line, for the log of a single ask. `design:fixtures`
/// prints the same fields over two lines because it tabulates them afterwards;
/// a one-off ask has nothing to line up with and reads better whole.
export function planReadLine(read: PlanRead): string {
  return `${read.landed}, ${percent(read.ink)} of the page inked, standing on ${read.standing}${read.framed ? `, ${read.framed}` : ""}`;
}
