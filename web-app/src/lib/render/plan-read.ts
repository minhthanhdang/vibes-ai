import { LAYOUT_TEXT_MAX_FONT } from "@/lib/layout/moodboard-layouts";
import { contrastLine, contrastRead, type ContrastRead } from "@/lib/render/contrast";
import {
  bandOccupancy,
  emptyBands,
  isBackdrop,
  type OccupancyOptions,
} from "@/lib/render/occupancy";
import {
  drawnBounds,
  type RenderDraw,
  type RenderPlan,
  type TextDraw,
} from "@/lib/render/render-plan";

export type PlanRead = {
  shape: string;
  landed: string;
  ink: number;
  standing: string;
  covered: number;
  margins: Margins;
  framed: string;
  type: TypeRead | null;
  typed: string;
  contrast: ContrastRead;
  read: string;
};

export type Margins = { top: number; right: number; bottom: number; left: number };

export type TypeRead = {
  largest: number;
  smallest: number;
  sizes: number;
  largestPx: number;
  atCeiling: boolean;
};

const percent = (share: number) => `${Math.round(share * 100)}%`;

function landedIn(draws: readonly RenderDraw[]): string {
  const counted = new Map<string, number>();
  for (const draw of draws) counted.set(draw.kind, (counted.get(draw.kind) ?? 0) + 1);
  return [...counted].map(([kind, count]) => `${count} ${kind}`).join(", ") || "nothing";
}

function bandNames(count: number, axis: "y" | "x"): string {
  if (count !== 3) return `${count} bands`;
  return axis === "y" ? "top-middle-bottom" : "left-middle-right";
}

function marginsOf(plan: RenderPlan): Margins {
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;

  for (const draw of plan.draws) {
    const box = drawnBounds(draw);
    if (isBackdrop(plan, draw)) continue;
    top = Math.min(top, box.y);
    left = Math.min(left, box.x);
    bottom = Math.max(bottom, box.y + box.height);
    right = Math.max(right, box.x + box.width);
  }

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

const MARGIN_FLOOR = 0.1;

function framedIn(margins: Margins): string {
  const said = (["top", "right", "bottom", "left"] as const)
    .filter((edge) => margins[edge] >= MARGIN_FLOOR)
    .map((edge) => `${percent(margins[edge])} ${edge}`);
  return said.length ? `nothing within ${said.join(", ")}` : "";
}

function typeOf(plan: RenderPlan): TypeRead | null {
  const sizes = plan.draws
    .filter((draw): draw is TextDraw => draw.kind === "text")
    .map(({ fontSize }) => fontSize)
    .filter((size) => size > 0);
  if (!sizes.length || plan.height <= 0) return null;

  const distinct = new Set(sizes.map((size) => Math.round(size)));
  const largest = Math.max(...sizes);
  const largestPx = plan.scale > 0 ? Math.round(largest / plan.scale) : Math.round(largest);
  return {
    largest: largest / plan.height,
    smallest: Math.min(...sizes) / plan.height,
    sizes: distinct.size,
    largestPx,
    atCeiling: largestPx >= LAYOUT_TEXT_MAX_FONT,
  };
}

function typedIn(type: TypeRead | null): string {
  if (!type) return "";
  const step = type.smallest > 0 ? type.largest / type.smallest : 1;
  const spread =
    type.sizes > 1 ? `${type.sizes} sizes, ${step.toFixed(1)}x apart` : "one size throughout";
  const ceiling = type.atCeiling
    ? type.largestPx > LAYOUT_TEXT_MAX_FONT
      ? ` (${type.largestPx}px, past the ${LAYOUT_TEXT_MAX_FONT}px a put sets)`
      : ` (${type.largestPx}px, the ceiling a put sets)`
    : "";
  return `largest type ${percent(type.largest)} of the frame${ceiling}, ${spread}`;
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
    ? plan.draws.reduce((sum, draw) => {
        if (isBackdrop(plan, draw)) return sum;
        const box = drawnBounds(draw);
        return sum + box.width * box.height;
      }, 0) / area
    : 0;

  const standing = [
    `${read.bands.map(({ covered }) => percent(covered)).join(" / ")} ${bandNames(read.bands.length, read.axis)}`,
    read.backdrops ? `${read.backdrops} backdrop` : "",
    bare.length ? `${bare.map((at) => named[at]).join(" and ")} bare` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const margins = marginsOf(plan);
  const type = typeOf(plan);
  const contrast = contrastRead(plan);
  return {
    shape: `${Math.round(plan.frame.width)}x${Math.round(plan.frame.height)}`,
    landed: landedIn(plan.draws),
    ink,
    standing,
    covered: read.covered,
    margins,
    framed: framedIn(margins),
    type,
    typed: typedIn(type),
    contrast,
    read: contrastLine(contrast),
  };
}

export function planReadLine(read: PlanRead): string {
  return `${read.shape}, ${read.landed}, ${percent(read.ink)} of the page inked, standing on ${read.standing}${read.framed ? `, ${read.framed}` : ""}${read.typed ? `, ${read.typed}` : ""}${read.read ? `, ${read.read}` : ""}`;
}
