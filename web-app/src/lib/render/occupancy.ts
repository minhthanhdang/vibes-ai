import type { Rect } from "@/lib/boards/board-contents";
import { rotatedBounds, type RenderDraw, type RenderPlan } from "@/lib/render/render-plan";

/// How much of a page's frame the design actually stands on, band by band.
///
/// §VIII names free placement as a risk and says the only answer is to eyeball a
/// fixture set, because no test asserts taste. That stays true — this is not a
/// verdict and nothing here passes or fails. It is the smaller thing that makes
/// an eyeball verdict survive a second run: the repeatable flaw the first three
/// fixtures showed was every design leaving the bottom third of its page empty,
/// and "the bottom third is empty" is a number where "it looks unbalanced" is a
/// memory of a picture nobody still has.
///
/// Deliberately geometric and deliberately coarse. It reads the placement plan
/// rather than the pixels, so it needs no bucket, no fonts and no codec — the
/// same split `render-plan.ts` makes for the same reason.

/// Three, because the flaw being watched is a third of a page and because a
/// designer's own vocabulary for a frame is thirds (`composition`). Callers can
/// ask for more; nothing here assumes the default.
export const OCCUPANCY_BANDS = 3;

/// A draw covering this much of the frame is the ground rather than a thing
/// standing on it, and counting it would answer every question with "full".
/// A full-bleed backdrop is exactly what a design reaches for when it has
/// nothing to put at the foot of the page, so a metric it hides the flaw from is
/// worse than no metric.
export const BACKDROP_COVERAGE = 0.9;

export type OccupancyAxis = "y" | "x";

export type Band = {
  /// Where the band sits in the frame, as fractions of the axis.
  from: number;
  to: number;
  /// The share of *this band's* own area that anything is drawn on, counted as
  /// a union — two blocks stacked on the same spot cover it once.
  covered: number;
};

export type OccupancyRead = {
  axis: OccupancyAxis;
  bands: Band[];
  /// The union share of the whole frame, on the same content.
  covered: number;
  /// How many draws were read as ground and left out. Reported rather than
  /// silently dropped: a page whose only element is a backdrop reads as empty
  /// here and that is the right answer only if the count is visible beside it.
  backdrops: number;
};

export type OccupancyOptions = {
  axis?: OccupancyAxis;
  bands?: number;
};

/// The union area of a set of rectangles inside a window, by coordinate
/// compression: every edge becomes a grid line and a cell counts once if
/// anything covers its middle. Exact for axis-aligned boxes, and a page carries
/// tens of draws rather than thousands, so the quadratic cell count is cheaper
/// than the sweep that would replace it.
function unionArea(boxes: readonly Rect[], window: Rect): number {
  const inside = boxes
    .map((box) => intersect(box, window))
    .filter((box): box is Rect => box !== null && box.width > 0 && box.height > 0);
  if (!inside.length) return 0;

  const xs = axisLines(inside.flatMap(({ x, width }) => [x, x + width]));
  const ys = axisLines(inside.flatMap(({ y, height }) => [y, y + height]));

  let area = 0;
  for (let column = 0; column + 1 < xs.length; column += 1) {
    const left = xs[column]!;
    const right = xs[column + 1]!;
    const midX = (left + right) / 2;
    for (let row = 0; row + 1 < ys.length; row += 1) {
      const top = ys[row]!;
      const bottom = ys[row + 1]!;
      const midY = (top + bottom) / 2;
      const covered = inside.some(
        (box) =>
          midX >= box.x && midX <= box.x + box.width && midY >= box.y && midY <= box.y + box.height,
      );
      if (covered) area += (right - left) * (bottom - top);
    }
  }
  return area;
}

function axisLines(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function intersect(box: Rect, window: Rect): Rect | null {
  const x = Math.max(box.x, window.x);
  const y = Math.max(box.y, window.y);
  const right = Math.min(box.x + box.width, window.x + window.width);
  const bottom = Math.min(box.y + box.height, window.y + window.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/// Where a draw lands on the picture, rotation included. The band a rotated
/// title reaches into is the band it is in, whatever its unrotated box says.
function drawnBox(draw: RenderDraw): Rect {
  return rotatedBounds(draw.box, draw.angle);
}

export function bandOccupancy(plan: RenderPlan, options: OccupancyOptions = {}): OccupancyRead {
  const axis = options.axis ?? "y";
  const count = Math.max(1, Math.floor(options.bands ?? OCCUPANCY_BANDS));
  const frame: Rect = { x: 0, y: 0, width: plan.width, height: plan.height };
  const area = plan.width * plan.height;

  const boxes: Rect[] = [];
  let backdrops = 0;
  for (const draw of plan.draws) {
    const box = drawnBox(draw);
    const inside = intersect(box, frame);
    if (!inside) continue;
    if (area > 0 && (inside.width * inside.height) / area >= BACKDROP_COVERAGE) {
      backdrops += 1;
      continue;
    }
    boxes.push(inside);
  }

  const span = axis === "y" ? plan.height : plan.width;
  const bands: Band[] = [];
  for (let at = 0; at < count; at += 1) {
    const from = at / count;
    const to = (at + 1) / count;
    const window: Rect =
      axis === "y"
        ? { x: 0, y: from * span, width: plan.width, height: (to - from) * span }
        : { x: from * span, y: 0, width: (to - from) * span, height: plan.height };
    const windowArea = window.width * window.height;
    bands.push({ from, to, covered: windowArea > 0 ? unionArea(boxes, window) / windowArea : 0 });
  }

  return {
    axis,
    bands,
    covered: area > 0 ? unionArea(boxes, frame) / area : 0,
    backdrops,
  };
}

/// The bands with next to nothing on them, named the way a person would say it.
/// Empty when the design stands on the whole frame, which is what makes it worth
/// printing unconditionally.
export function emptyBands(read: OccupancyRead, floor = 0.02): number[] {
  return read.bands.flatMap((band, at) => (band.covered <= floor ? [at] : []));
}
