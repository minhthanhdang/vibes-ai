import "server-only";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

import type { Rect } from "@/lib/boards/board-contents";
import { croppedPixels } from "@/lib/canvas/moodboard-crop";
import {
  clipToFrame,
  rotatedBounds,
  type ImageDraw,
  type OutlineDraw,
  type RenderDraw,
  type RenderPlan,
  type ShapeDraw,
  type TextDraw,
  textOverflow,
  type Undrawn,
} from "@/lib/render/render-plan";
import type { BoardImageVariant } from "@/lib/scene/moodboard-scene";
import { classicFontFile } from "@/server/render/fonts";
import { googleFontFile } from "@/server/render/google-fonts";

export type ReferenceBytes = (
  referenceId: string,
  variant: BoardImageVariant,
) => Promise<Uint8Array | null>;

export type Raster = {
  bytes: Uint8Array;
  undrawn: Undrawn[];
};

const degrees = (angle: number) => (angle * 180) / Math.PI;

const round = (value: number) => Math.round(value * 100) / 100;

const OUTLINE_STROKE = "#adb5bd";

const strokePad = (strokeWidth: number) => Math.ceil(strokeWidth * 4) + 2;

const shapePad = (draw: ShapeDraw) =>
  strokePad(draw.strokeWidth) + Math.ceil(draw.sketch?.overflow ?? 0);

function textPad(draw: TextDraw, canvas: { width: number; height: number }) {
  const glyph = Math.ceil(draw.fontSize * 0.5) + 2;
  const spill = textOverflow(draw);
  return {
    x: Math.min(canvas.width, Math.ceil(spill.x) + glyph),
    y: Math.min(canvas.height, Math.ceil(spill.y) + glyph),
  };
}

function xml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&apos;";
  });
}

type Drawn = { bytes: Buffer; width: number; height: number; x: number; y: number };

function clipWindow(clip: Rect | null, canvas: { width: number; height: number }) {
  const left = clip ? Math.max(0, Math.round(clip.x)) : 0;
  const top = clip ? Math.max(0, Math.round(clip.y)) : 0;
  const right = clip ? Math.min(canvas.width, Math.round(clip.x + clip.width)) : canvas.width;
  const bottom = clip ? Math.min(canvas.height, Math.round(clip.y + clip.height)) : canvas.height;
  const width = right - left;
  const height = bottom - top;
  return width > 0 && height > 0 ? { x: left, y: top, width, height } : null;
}

type Layer = { input: Buffer; left: number; top: number };

async function place(
  drawn: Drawn,
  clip: Rect | null,
  canvas: { width: number; height: number },
): Promise<Layer | null> {
  const window = clipWindow(clip, canvas);
  if (!window) return null;

  const cut = clipToFrame(
    { x: drawn.x - window.x, y: drawn.y - window.y, width: drawn.width, height: drawn.height },
    window,
  );
  if (!cut) return null;

  const whole =
    cut.sourceLeft === 0 &&
    cut.sourceTop === 0 &&
    cut.width === drawn.width &&
    cut.height === drawn.height;

  return {
    input: whole
      ? drawn.bytes
      : await sharp(drawn.bytes)
          .extract({
            left: cut.sourceLeft,
            top: cut.sourceTop,
            width: cut.width,
            height: cut.height,
          })
          .png()
          .toBuffer(),
    left: cut.left + window.x,
    top: cut.top + window.y,
  };
}

function vectorMarkup(
  box: Rect,
  angle: number,
  opacity: number,
  pad: number | { x: number; y: number },
  body: (local: Rect) => string,
): { markup: string; width: number; height: number; x: number; y: number } {
  const room = typeof pad === "number" ? { x: pad, y: pad } : pad;
  const frame = rotatedBounds(
    {
      x: box.x - room.x,
      y: box.y - room.y,
      width: box.width + room.x * 2,
      height: box.height + room.y * 2,
    },
    angle,
  );
  const width = Math.max(1, Math.ceil(frame.width));
  const height = Math.max(1, Math.ceil(frame.height));

  const local = { x: box.x - frame.x, y: box.y - frame.y, width: box.width, height: box.height };
  const centre = { x: local.x + local.width / 2, y: local.y + local.height / 2 };
  const rotation = angle
    ? ` transform="rotate(${round(degrees(angle))} ${round(centre.x)} ${round(centre.y)})"`
    : "";

  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<g opacity="${round(opacity)}"${rotation}>${body(local)}</g></svg>`;

  return { markup, width, height, x: frame.x, y: frame.y };
}

async function vector(
  box: Rect,
  angle: number,
  opacity: number,
  pad: number | { x: number; y: number },
  body: (local: Rect) => string,
): Promise<Drawn> {
  const { markup, ...placed } = vectorMarkup(box, angle, opacity, pad, body);
  return { bytes: await sharp(Buffer.from(markup)).png().toBuffer(), ...placed };
}

function vectorType(
  draw: TextDraw,
  canvas: { width: number; height: number },
  fontFile: string,
): Drawn {
  const { markup, ...placed } = vectorMarkup(
    draw.box,
    draw.angle,
    draw.opacity,
    textPad(draw, canvas),
    (local) => textBody(draw, local),
  );
  const rendered = new Resvg(markup, {
    font: { loadSystemFonts: false, fontFiles: [fontFile], defaultFontFamily: draw.font.family },
  }).render();
  return { bytes: rendered.asPng(), ...placed };
}

function strokeAttributes(draw: ShapeDraw, dashed = true) {
  const dash =
    dashed && draw.dash ? ` stroke-dasharray="${round(draw.dash[0])} ${round(draw.dash[1])}"` : "";
  return ` stroke="${xml(draw.stroke)}" stroke-width="${round(draw.strokeWidth)}" stroke-linecap="round"${dash}`;
}

function spline(path: [number, number][]) {
  const at = (index: number) => path[Math.min(Math.max(index, 0), path.length - 1)]!;
  const control = (a: number, toward: number, away: number) => round(a + (toward - away) / 6);

  const curves: string[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const [ax, ay] = at(i);
    const [bx, by] = at(i + 1);
    const [px, py] = at(i - 1);
    const [qx, qy] = at(i + 2);
    curves.push(
      `C ${control(ax, bx, px)},${control(ay, by, py)}` +
        ` ${control(bx, ax, qx)},${control(by, ay, qy)}` +
        ` ${round(bx)},${round(by)}`,
    );
  }
  return `M ${round(at(0)[0])},${round(at(0)[1])} ${curves.join(" ")}`;
}

function head(path: [number, number][], at: "start" | "end") {
  const [tip, from] =
    at === "end" ? [path[path.length - 1]!, path[path.length - 2]!] : [path[0]!, path[1]!];
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const size = Math.max(6, Math.hypot(tip[0] - from[0], tip[1] - from[1]) * 0.2);
  const wing = (turn: number) => {
    const direction = angle + Math.PI + turn;
    return `${round(tip[0] + Math.cos(direction) * size)},${round(tip[1] + Math.sin(direction) * size)}`;
  };
  return `${wing(0.5)} ${round(tip[0])},${round(tip[1])} ${wing(-0.5)}`;
}

function sketchBody(draw: ShapeDraw, sketch: NonNullable<ShapeDraw["sketch"]>, local: Rect) {
  const stroke = strokeAttributes(draw);
  const move = ` transform="translate(${round(local.x)} ${round(local.y)})"`;
  const fill = draw.fill === "transparent" ? "none" : draw.fill;

  return sketch.paths
    .map((path) => {
      if (path.role === "fill") {
        return `<path d="${path.d}" fill="${xml(fill)}" fill-rule="evenodd" stroke="none"${move}/>`;
      }
      if (path.role === "hachure") {
        return `<path d="${path.d}" fill="none" stroke="${xml(fill)}" stroke-width="${round(sketch.hachureWidth)}" stroke-linecap="round"${move}/>`;
      }
      return `<path d="${path.d}" fill="none" stroke-linejoin="round"${stroke}${move}/>`;
    })
    .join("");
}

function shapeBody(draw: ShapeDraw, local: Rect) {
  const fill = draw.fill === "transparent" ? "none" : draw.fill;
  const stroke = strokeAttributes(draw);

  if (draw.sketch) return sketchBody(draw, draw.sketch, local) + arrowheads(draw, local);

  if (draw.shape === "ellipse") {
    const cx = local.x + local.width / 2;
    const cy = local.y + local.height / 2;
    return `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(local.width / 2)}" ry="${round(local.height / 2)}" fill="${xml(fill)}"${stroke}/>`;
  }

  if (draw.shape === "rectangle" || draw.shape === "frame") {
    const rx = draw.radius > 0 ? ` rx="${round(draw.radius)}"` : "";
    return `<rect x="${round(local.x)}" y="${round(local.y)}" width="${round(local.width)}" height="${round(local.height)}" fill="${xml(fill)}"${rx}${stroke}/>`;
  }

  const path = shaft(draw, local);
  const points = path.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
  const rule = fill === "none" ? "" : ` fill-rule="evenodd"`;
  const body = draw.curve
    ? `<path d="${spline(path)}" fill="${xml(fill)}"${rule} stroke-linejoin="round"${stroke}/>`
    : `<polyline points="${points}" fill="${xml(fill)}"${rule} stroke-linejoin="round"${stroke}/>`;
  return body + arrowheads(draw, local);
}

function shaft(draw: ShapeDraw, local: Rect): [number, number][] {
  return (
    draw.points ?? [
      [0, 0],
      [local.width, local.height],
    ]
  ).map(([x, y]) => [local.x + x, local.y + y]);
}

function arrowheads(draw: ShapeDraw, local: Rect) {
  if (!draw.arrowheads.start && !draw.arrowheads.end) return "";
  const path = shaft(draw, local);
  const arrowhead = (at: "start" | "end") =>
    `<polyline points="${head(path, at)}" fill="none" stroke-linejoin="round"${strokeAttributes(draw, false)}/>`;
  return (
    (draw.arrowheads.start ? arrowhead("start") : "") +
    (draw.arrowheads.end ? arrowhead("end") : "")
  );
}

function textBody(draw: TextDraw, local: Rect) {
  const lines = draw.text.split("\n");
  const step = draw.fontSize * draw.lineHeight;
  const block = step * lines.length;

  const top =
    draw.verticalAlign === "middle"
      ? local.y + (local.height - block) / 2
      : draw.verticalAlign === "bottom"
        ? local.y + local.height - block
        : local.y;

  const anchor = draw.align === "center" ? "middle" : draw.align === "right" ? "end" : "start";
  const x =
    draw.align === "center"
      ? local.x + local.width / 2
      : draw.align === "right"
        ? local.x + local.width
        : local.x;

  const face =
    ` font-family="${xml(draw.font.family)}, ${xml(draw.font.fallback)}"` +
    (draw.font.weight !== undefined ? ` font-weight="${draw.font.weight}"` : "") +
    (draw.font.italic ? ` font-style="italic"` : "");

  return lines
    .map((line, index) => {
      const baseline = top + index * step + step / 2 + draw.fontSize * 0.35;
      return `<text x="${round(x)}" y="${round(baseline)}"${face} font-size="${round(draw.fontSize)}" fill="${xml(draw.colour)}" text-anchor="${anchor}" xml:space="preserve">${xml(line)}</text>`;
    })
    .join("");
}

export type RasterFonts = {
  classic: (dir: string) => string | null;
  google: (font: { family: string; weight: number; italic: boolean }) => Promise<string | null>;
};

async function typeFontFile(draw: TextDraw, fonts: RasterFonts): Promise<string | null> {
  if (draw.font.dir) return fonts.classic(draw.font.dir);
  return fonts.google({
    family: draw.font.family,
    weight: draw.font.weight ?? 400,
    italic: draw.font.italic ?? false,
  });
}

function outlineBody(local: Rect) {
  return `<rect x="${round(local.x)}" y="${round(local.y)}" width="${round(local.width)}" height="${round(local.height)}" fill="none" stroke="${OUTLINE_STROKE}" stroke-width="1" stroke-dasharray="6 4"/>`;
}

function outline(draw: OutlineDraw | ImageDraw | TextDraw) {
  return vector(draw.box, draw.angle, draw.opacity, 2, outlineBody);
}

async function photograph(draw: ImageDraw, source: Uint8Array): Promise<Drawn | null> {
  const image = sharp(source, { autoOrient: true });
  const frame = (await image.metadata()).autoOrient;
  if (!frame?.width || !frame.height) return null;

  const width = Math.max(1, Math.round(draw.box.width));
  const height = Math.max(1, Math.round(draw.box.height));

  const region = draw.region ? croppedPixels(draw.region, frame) : null;
  let pipeline = region
    ? image.extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    : image;
  pipeline = pipeline.resize(width, height, { fit: "fill" }).ensureAlpha();
  if (draw.flipX) pipeline = pipeline.flop();
  if (draw.flipY) pipeline = pipeline.flip();

  const radius = Math.min(draw.radius, Math.min(width, height) / 2);
  if (radius > 0 || draw.opacity < 1) {
    const mask =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" rx="${round(radius)}" fill="#000000" fill-opacity="${round(draw.opacity)}"/></svg>`;
    pipeline = pipeline.composite([{ input: Buffer.from(mask), blend: "dest-in" }]);
  }

  const placed = await pipeline.png().toBuffer();
  if (!draw.angle) return { bytes: placed, width, height, x: draw.box.x, y: draw.box.y };

  const turned = await sharp(placed)
    .rotate(degrees(draw.angle), { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const size = await sharp(turned).metadata();

  return {
    bytes: turned,
    width: size.width,
    height: size.height,
    x: draw.box.x + width / 2 - size.width / 2,
    y: draw.box.y + height / 2 - size.height / 2,
  };
}

async function drawnOf(
  draw: RenderDraw,
  bytesOf: ReferenceBytes,
  fonts: RasterFonts,
  canvas: { width: number; height: number },
): Promise<{ drawn: Drawn | null; undrawn: Undrawn | null }> {
  if (draw.kind === "text") {
    const fontFile = await typeFontFile(draw, fonts).catch(() => null);
    if (!fontFile) return { drawn: await outline(draw), undrawn: { id: draw.id, type: "text" } };
    try {
      return { drawn: vectorType(draw, canvas, fontFile), undrawn: null };
    } catch {
      return { drawn: await outline(draw), undrawn: { id: draw.id, type: "text" } };
    }
  }

  if (draw.kind === "shape") {
    return {
      drawn: await vector(draw.box, draw.angle, draw.opacity, shapePad(draw), (local) =>
        shapeBody(draw, local),
      ),
      undrawn: null,
    };
  }

  if (draw.kind === "outline") return { drawn: await outline(draw), undrawn: null };

  const source = await bytesOf(draw.referenceId, draw.variant).catch(() => null);
  const photo = source ? await photograph(draw, source).catch(() => null) : null;
  if (photo) return { drawn: photo, undrawn: null };

  return { drawn: await outline(draw), undrawn: { id: draw.id, type: "image" } };
}

export type RasterOptions = {
  fonts?: Partial<RasterFonts>;
};

export async function rasterise(
  plan: RenderPlan,
  bytesOf: ReferenceBytes,
  { fonts }: RasterOptions = {},
): Promise<Raster> {
  const canvas = { width: plan.width, height: plan.height };
  const fontSources: RasterFonts = {
    classic: fonts?.classic ?? classicFontFile,
    google: fonts?.google ?? googleFontFile,
  };

  const prepared = await Promise.all(
    plan.draws.map((draw) => drawnOf(draw, bytesOf, fontSources, canvas)),
  );

  const layers: Layer[] = [];
  const undrawn = [...plan.undrawn];
  for (const [index, { drawn, undrawn: failed }] of prepared.entries()) {
    if (failed) undrawn.push(failed);
    if (!drawn) continue;
    const layer = await place(drawn, plan.draws[index]!.clip, canvas);
    if (layer) layers.push(layer);
  }

  const bytes = await sharp({
    create: { width: canvas.width, height: canvas.height, channels: 4, background: plan.background },
  })
    .composite(layers)
    .png()
    .toBuffer();

  return { bytes: new Uint8Array(bytes), undrawn };
}
