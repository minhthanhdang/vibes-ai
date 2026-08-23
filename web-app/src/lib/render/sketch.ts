import { RoughGenerator } from "roughjs/bin/generator";
import type { Drawable, Options } from "roughjs/bin/core";

/// The sketched stroke, which is what excalidraw draws every shape with unless
/// somebody turned it off (§XI.2).
///
/// `DEFAULT_ELEMENT_PROPS.roughness` is `ROUGHNESS.artist` — 1 — so the box a
/// user draws with the toolbar has a wobbling outline drawn twice over, and
/// this renderer drew it as an exact rectangle. It is the same shape of gap as
/// the spline (§XI.2): latent on the database because the style dialect writes
/// `SHAPE_ROUGHNESS` 0 on everything the agents put down, and not latent in the
/// product because the toolbar's own default is the other number.
///
/// The geometry is roughjs's own rather than a second implementation of it, and
/// deliberately so: excalidraw hands the same generator the same `element.seed`
/// (`ShapeCache`, `scene/Shape.ts`), so asking it here gives the *same* wobble
/// rather than a plausible one. A sketch drawn from a different random walk
/// would be a picture of a shape nobody has, which is the failure this whole
/// stage of the renderer is about.
///
/// Scene units in, output pixels out. roughjs's displacements are absolute —
/// `maxRandomnessOffset` is 2 *units*, not 2% of anything — so a sketch
/// generated on an already-scaled box wobbles by the same pixels at every zoom,
/// which is a board-wide picture drawn as if each shape were a metre across.
/// That is the rule iterations 41 and 42 landed the dash and the corner radius
/// on, and this is the third thing it decides.

export type SketchRole = "stroke" | "fill" | "hachure";

export type SketchPath = { role: SketchRole; d: string };

export type Sketch = {
  paths: SketchPath[];
  /// What a hachure line is stroked at, in output pixels — roughjs draws a
  /// non-solid fill as lines rather than as paint, and at a weight of its own.
  hachureWidth: number;
  /// How far the wobble reaches outside the element's own box, in output
  /// pixels. The rasteriser draws each element into a canvas of its box padded,
  /// and a sketch is the one thing here that leaves the box by an amount the
  /// stroke width does not predict.
  overflow: number;
};

/// One generator for the process, the way excalidraw keeps one on `ShapeCache`.
/// It holds no state between calls — every random walk is seeded from the
/// element — so sharing it is free.
const generator = new RoughGenerator();

/// Excalidraw's `ROUGHNESS.cartoonist`, the value above which it stops asking
/// roughjs to keep the path's own corners.
const CARTOONIST = 2;

/// Excalidraw's `adjustRoughness` (`scene/Shape.ts`): a small shape is drawn
/// less roughly than it says, because the same two-unit wobble that reads as a
/// hand on a page-wide panel is an illegible scribble on a 12-unit chip.
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
  /// The middle test is excalidraw's `canChangeRoundness`, which a `line` is in
  /// and an `ellipse` is not — the one place its roundness field matters to a
  /// picture even though it never draws a corner.
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

/// The rounded rectangle excalidraw hands roughjs, quadratic corners and all.
/// Not an SVG `rx`: a `rect`'s corner is an elliptical arc and this is a
/// quadratic through the same two points, which are different curves by a
/// fraction of a pixel — but the sketch is generated *from* the path, so the
/// wobble has to start from excalidraw's own or it is a different walk.
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
  /// The colour the inside is painted, or null for a shape excalidraw paints
  /// none of — `paintsInside` in `render-plan.ts` is the one reader of that
  /// question and this takes its answer rather than asking again.
  fill: string | null;
  width: number;
  height: number;
  /// The corner radius in scene units, already through `cornerRadius`, or 0.
  radius: number;
  rounded: boolean;
  /// The element's own path, in scene units from its box's origin — null for a
  /// shape drawn as its rectangle.
  points: [number, number][] | null;
  elbowed: boolean;
};

/// What excalidraw's `generateRoughOptions` puts on every shape.
///
/// `fillWeight` and `hachureGap` are set explicitly for the reason its own
/// comment gives: roughjs derives both from the stroke width when they are
/// absent, so the half unit added back for a dashed stroke would otherwise
/// thicken the shading inside the box as well as the line around it.
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

/// Excalidraw's `_generateElementShape`, for the four types this renderer draws
/// as themselves. A `frame` never reaches here — it is drawn in `FRAME_STYLE`
/// whatever the element carries (§XI.4) — and neither does anything the plan
/// already sends down the `outline` branch.
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
    /// `curveFitting: 1` is excalidraw's, and it is what makes the sketched
    /// ellipse pass through its own extremes rather than cut the corners off
    /// its box.
    return generator.ellipse(width / 2, height / 2, width, height, {
      ...options(asked, roughness, false),
      curveFitting: 1,
    });
  }

  /// An elbowed arrow is excalidraw's third linear branch and this renderer
  /// draws none of it (§XI.2). Sketching the dogleg it draws instead would put
  /// a hand-drawn wobble on a path that is already the wrong path.
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

/// roughjs's ops, scaled into output pixels and written as an SVG `d`.
///
/// Its own `opsToPath` is not used because it rounds to a fixed number of
/// decimals in the space it was generated in, and everything here is generated
/// in scene units and drawn somewhere else.
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
