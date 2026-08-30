import type { Rect } from "@/lib/boards/board-contents";
import { drawnBounds, type RenderDraw, type RenderPlan } from "@/lib/render/render-plan";

export const OCCUPANCY_BANDS = 3;

export const BACKDROP_COVERAGE = 0.9;

export type OccupancyAxis = "y" | "x";

export type Band = {
  from: number;
  to: number;
  covered: number;
};

export type OccupancyRead = {
  axis: OccupancyAxis;
  bands: Band[];
  covered: number;
  backdrops: number;
};

export type OccupancyOptions = {
  axis?: OccupancyAxis;
  bands?: number;
};

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

export function isBackdrop(plan: RenderPlan, draw: RenderDraw): boolean {
  const area = plan.width * plan.height;
  if (area <= 0) return false;
  const inside = intersect(drawnBounds(draw), {
    x: 0,
    y: 0,
    width: plan.width,
    height: plan.height,
  });
  if (!inside) return false;
  return (inside.width * inside.height) / area >= BACKDROP_COVERAGE;
}

export function bandOccupancy(plan: RenderPlan, options: OccupancyOptions = {}): OccupancyRead {
  const axis = options.axis ?? "y";
  const count = Math.max(1, Math.floor(options.bands ?? OCCUPANCY_BANDS));
  const frame: Rect = { x: 0, y: 0, width: plan.width, height: plan.height };
  const area = plan.width * plan.height;

  const boxes: Rect[] = [];
  let backdrops = 0;
  for (const draw of plan.draws) {
    const inside = intersect(drawnBounds(draw), frame);
    if (!inside) continue;
    if (isBackdrop(plan, draw)) {
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

export function emptyBands(read: OccupancyRead, floor = 0.02): number[] {
  return read.bands.flatMap((band, at) => (band.covered <= floor ? [at] : []));
}

function bandName(read: OccupancyRead, at: number): string {
  const names =
    read.bands.length !== 3
      ? null
      : read.axis === "y"
        ? ["the top third", "the middle third", "the bottom third"]
        : ["the left third", "the middle third", "the right third"];
  return names?.[at] ?? `band ${at + 1} of ${read.bands.length}`;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

export function occupancyNote(read: OccupancyRead): string {
  const ground = read.backdrops
    ? `, not counting ${read.backdrops === 1 ? "a draw" : `${read.backdrops} draws`} covering the whole rectangle`
    : "";
  const bare = emptyBands(read);

  if (!read.bands.length || (bare.length === read.bands.length && read.covered <= 0)) {
    return `Nothing stands on this page yet${ground}.`;
  }

  const perBand = read.bands
    .map((band, at) => `${percent(band.covered)} of ${bandName(read, at)}`)
    .join(", ");
  const empty =
    bare.length && bare.length < read.bands.length
      ? ` Next to nothing stands in ${bare.map((at) => bandName(read, at)).join(" or ")}.`
      : "";

  return `Something stands on ${percent(read.covered)} of this page${ground}: ${perBand}.${empty}`;
}
