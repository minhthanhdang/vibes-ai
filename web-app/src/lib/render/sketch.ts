import { RoughGenerator } from "roughjs/bin/generator";
import type { Drawable, Options } from "roughjs/bin/core";

export type SketchRole = "stroke" | "fill" | "hachure";

export type SketchPath = { role: SketchRole; d: string };

export type Sketch = {
  paths: SketchPath[];
  hachureWidth: number;
  overflow: number;
};

const generator = new RoughGenerator();

const CARTOONIST = 2;

export function adjustedRoughness(
  roughness: number,
  type: string,
  width: number,
  height: number,
  rounded: boolean,
): number {
  const maxSize = Math.max(width, height);
  const minSize = Math.min(width, height);
  const linear = type === "line" || type === "arrow";
  const roundable = type === "rectangle" || type === "line" || type === "diamond";
  if (
    (minSize >= 20 && maxSize >= 50) ||
    (minSize >= 15 && rounded && roundable) ||
    (linear && maxSize >= 50)
  ) {
    return roughness;
  }
  return Math.min(roughness / (maxSize < 10 ? 3 : 2), 2.5);
}

function roundedRectanglePath(width: number, radius: number, height: number): string {
  const r = radius;
  const w = width;
  const h = height;
  return `M ${r} 0 L ${w - r} 0 Q ${w} 0, ${w} ${r} L ${w} ${h - r} Q ${w} ${h}, ${w - r} ${h} L ${r} ${h} Q 0 ${h}, 0 ${h - r} L 0 ${r} Q 0 0, ${r} 0`;
}

export type SketchAsked = {
  type: string;
  seed: number;
  roughness: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  strokeWidth: number;
  fillStyle: string;
  fill: string | null;
  width: number;
  height: number;
  radius: number;
  rounded: boolean;
  points: [number, number][] | null;
  elbowed: boolean;
};

function options(asked: SketchAsked, roughness: number, continuousPath: boolean): Options {
  const solid = asked.strokeStyle === "solid";
  return {
    seed: asked.seed,
    disableMultiStroke: !solid,
    strokeWidth: solid ? asked.strokeWidth : asked.strokeWidth + 0.5,
    fillWeight: asked.strokeWidth / 2,
    hachureGap: asked.strokeWidth * 4,
    roughness,
    preserveVertices: continuousPath || asked.roughness < CARTOONIST,
    ...(asked.fill ? { fill: asked.fill, fillStyle: asked.fillStyle } : {}),
  };
}

function drawable(asked: SketchAsked, roughness: number): Drawable | null {
  const { width, height, points } = asked;

  if (asked.type === "rectangle") {
    return asked.rounded
      ? generator.path(
          roundedRectanglePath(width, asked.radius, height),
          options(asked, roughness, true),
        )
      : generator.rectangle(0, 0, width, height, options(asked, roughness, false));
  }

  if (asked.type === "ellipse") {
    return generator.ellipse(width / 2, height / 2, width, height, {
      ...options(asked, roughness, false),
      curveFitting: 1,
    });
  }

  if (!points || asked.elbowed) return null;

  const o = options(asked, roughness, false);
  if (asked.rounded) return generator.curve(points, o);
  return asked.fill ? generator.polygon(points, o) : generator.linearPath(points, o);
}

const ROLES: Record<string, SketchRole> = {
  path: "stroke",
  fillPath: "fill",
  fillSketch: "hachure",
};

function pathOf(
  ops: { op: string; data: number[] }[],
  scale: number,
  bounds: { min: number; max: number },
  width: number,
  height: number,
): string {
  const parts: string[] = [];
  const at = (data: number[], i: number) => {
    const x = data[i]! * scale;
    const y = data[i + 1]! * scale;
    bounds.min = Math.min(bounds.min, x, y);
    bounds.max = Math.max(bounds.max, x - width, y - height);
    return `${round(x)} ${round(y)}`;
  };
  for (const { op, data } of ops) {
    if (op === "move") parts.push(`M${at(data, 0)}`);
    else if (op === "lineTo") parts.push(`L${at(data, 0)}`);
    else if (op === "bcurveTo") parts.push(`C${at(data, 0)} ${at(data, 2)} ${at(data, 4)}`);
  }
  return parts.join(" ");
}

const round = (value: number) => Math.round(value * 100) / 100;

export function sketchOf(asked: SketchAsked, scale: number): Sketch | null {
  if (!(asked.roughness > 0)) return null;

  const roughness = adjustedRoughness(
    asked.roughness,
    asked.type,
    asked.width,
    asked.height,
    asked.rounded,
  );
  if (!(roughness > 0)) return null;

  const shape = drawable(asked, roughness);
  if (!shape) return null;

  const width = asked.width * scale;
  const height = asked.height * scale;
  const bounds = { min: 0, max: 0 };
  const paths: SketchPath[] = [];
  for (const set of shape.sets) {
    const role = ROLES[set.type];
    if (!role || !set.ops.length) continue;
    paths.push({ role, d: pathOf(set.ops, scale, bounds, width, height) });
  }
  if (!paths.length) return null;

  return {
    paths,
    hachureWidth: (asked.strokeWidth / 2) * scale,
    overflow: Math.max(-bounds.min, bounds.max, 0),
  };
}
