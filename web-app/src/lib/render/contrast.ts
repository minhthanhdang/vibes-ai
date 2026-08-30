import { normalizeHexColor } from "@/lib/analysis/analysis";
import type { Rect } from "@/lib/boards/board-contents";
import { drawnBounds, type RenderDraw, type RenderPlan } from "@/lib/render/render-plan";

export const CONTRAST_BODY_MIN = 4.5;
export const CONTRAST_LARGE_MIN = 3;

export const CONTRAST_LARGE_FONT = 24;

export type ContrastPair = {
  textId: string;
  ink: string;
  ground: string;
  ratio: number;
  fontSize: number;
  wants: number;
};

export type ContrastRead = {
  pairs: number;
  overImage: number;
  failing: ContrastPair[];
  worst: ContrastPair | null;
};

type Channels = [number, number, number];

function channels(hex: string): Channels {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as Channels;
}

export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  ) as Channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(ink: string, ground: string): number {
  const [lighter, darker] = [relativeLuminance(ink), relativeLuminance(ground)].sort(
    (a, b) => b - a,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

export function blendColours(under: string, over: string, alpha: number): string {
  if (alpha <= 0) return under;
  if (alpha >= 1) return over;

  const [a, b] = [channels(under), channels(over)];
  const mixed = a.map((value, at) => Math.round((value * (1 - alpha) + b[at]! * alpha) * 255));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function centre(box: Rect): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function holds(box: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function fillOf(draw: RenderDraw): { colour: string; alpha: number } | null {
  if (draw.kind !== "shape") return null;
  const hex = normalizeHexColor(draw.fill);
  if (!hex || draw.opacity <= 0) return null;
  return { colour: hex, alpha: draw.opacity };
}

type Ground = { colour: string; overImage: boolean };

function groundUnder(plan: RenderPlan, at: number): Ground {
  const point = centre(drawnBounds(plan.draws[at]!));
  const layers: { colour: string; alpha: number }[] = [];

  for (let below = at - 1; below >= 0; below -= 1) {
    const draw = plan.draws[below]!;
    if (!holds(drawnBounds(draw), point)) continue;

    if (draw.kind === "text") continue;

    if (draw.kind === "image" && draw.opacity > 0) {
      return { colour: plan.background, overImage: true };
    }

    const fill = fillOf(draw);
    if (!fill) continue;
    layers.push(fill);
    if (fill.alpha >= 1) break;
  }

  const base = normalizeHexColor(plan.background) ?? "#ffffff";
  const colour = layers.reduceRight(
    (under, layer) => blendColours(under, layer.colour, layer.alpha),
    base,
  );
  return { colour, overImage: false };
}

export function contrastRead(plan: RenderPlan): ContrastRead {
  const scale = plan.scale > 0 ? plan.scale : 1;
  const pairs: ContrastPair[] = [];
  let overImage = 0;

  for (let at = 0; at < plan.draws.length; at += 1) {
    const draw = plan.draws[at]!;
    if (draw.kind !== "text") continue;
    const ink = normalizeHexColor(draw.colour);
    if (!ink || draw.opacity <= 0 || !draw.text.trim()) continue;

    const ground = groundUnder(plan, at);
    if (ground.overImage) {
      overImage += 1;
      continue;
    }

    const fontSize = draw.fontSize / scale;
    const laid = blendColours(ground.colour, ink, draw.opacity);
    pairs.push({
      textId: draw.id,
      ink: laid,
      ground: ground.colour,
      ratio: contrastRatio(laid, ground.colour),
      fontSize,
      wants: fontSize >= CONTRAST_LARGE_FONT ? CONTRAST_LARGE_MIN : CONTRAST_BODY_MIN,
    });
  }

  const ranked = pairs.slice().sort((a, b) => a.ratio - b.ratio);
  return {
    pairs: pairs.length,
    overImage,
    failing: ranked.filter((pair) => pair.ratio < pair.wants),
    worst: ranked[0] ?? null,
  };
}

export function contrastLine(read: ContrastRead): string {
  if (!read.pairs && !read.overImage) return "";
  const over = read.overImage ? `, ${read.overImage} over a photograph` : "";
  if (!read.worst) return `no type on ground this can read${over.replace(/^, /, ": ")}`;

  const named = read.failing.length
    ? ` (${read.worst.ink} on ${read.worst.ground}, ${Math.round(read.worst.fontSize)}px)`
    : "";
  const failing = read.failing.length
    ? `${read.failing.length} of ${read.pairs} under what their size wants`
    : `all ${read.pairs} clear`;
  return `worst pair ${read.worst.ratio.toFixed(1)}:1${named}, ${failing}${over}`;
}

export const CONTRAST_NOTE_LIMIT = 3;

export function contrastNote(read: ContrastRead, addressable?: ReadonlySet<string>): string {
  if (!read.failing.length) return "";

  const many = read.failing.length !== 1;
  const how =
    read.failing.length === read.pairs
      ? many
        ? `all ${read.pairs} lines of type on this page`
        : "the one line of type on this page"
      : `${read.failing.length} of the ${read.pairs} lines of type on this page`;
  const said = `${how} ${many ? "stand" : "stands"} too close in colour to what ${many ? "they are" : "it is"} laid on`;
  const opening = said[0]!.toUpperCase() + said.slice(1);

  const named = read.failing
    .filter((pair) => !addressable || addressable.has(pair.textId))
    .slice(0, CONTRAST_NOTE_LIMIT);
  if (!named.length) return `${opening}.`;

  const pairs = named
    .map(
      (pair) =>
        `${pair.textId} is ${pair.ink} on ${pair.ground}, ${pair.ratio.toFixed(1)}:1 where ${Math.round(pair.fontSize)}px wants ${pair.wants}`,
    )
    .join("; ");
  const rest = read.failing.length - named.length;

  return `${opening}: ${pairs}${rest ? `; and ${rest} more` : ""}. Set ${many ? "them" : "it"} in a colour that separates from ${many ? "their" : "its"} ground with restyle_on_canvas, or change the ground ${many ? "they stand" : "it stands"} on.`;
}

export type PalettePair = { colours: [string, string]; ratio: number };

export type PaletteContrast = {
  body: PalettePair[];
  large: PalettePair[];
  widest: PalettePair | null;
};

export function paletteContrast(palette: readonly string[]): PaletteContrast {
  const pairs: PalettePair[] = [];
  for (let at = 0; at < palette.length; at += 1) {
    for (let with_ = at + 1; with_ < palette.length; with_ += 1) {
      const colours: [string, string] = [palette[at]!, palette[with_]!];
      pairs.push({ colours, ratio: contrastRatio(colours[0], colours[1]) });
    }
  }
  pairs.sort((a, b) => b.ratio - a.ratio);
  return {
    body: pairs.filter(({ ratio }) => ratio >= CONTRAST_BODY_MIN),
    large: pairs.filter(({ ratio }) => ratio >= CONTRAST_LARGE_MIN && ratio < CONTRAST_BODY_MIN),
    widest: pairs[0] ?? null,
  };
}
