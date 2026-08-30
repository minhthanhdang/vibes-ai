import type { Rect } from "@/lib/boards/board-contents";
import { googleFontInt, googleFontOf } from "@/lib/render/font-google";
import { cropRegion, type CropRegion } from "@/lib/canvas/moodboard-crop";
import { sketchOf, type Sketch } from "@/lib/render/sketch";
import {
  boardPages,
  boardSections,
  elementBox,
  pageElements,
  type BoardPage,
} from "@/lib/pages/board-pages";
import {
  SET_CASCADIA,
  SET_COMICSHANNS,
  SET_EXCALIFONT,
  SET_LIBERATION,
  SET_LILITA,
  SET_NUNITO,
  SET_VIRGIL,
  type SetMetric,
} from "@/lib/render/font-set";
import { setWidth } from "@/lib/render/text-set";
import { BOARD_RENDER_MAX_DIMENSION, BOARD_RENDER_PADDING } from "@/lib/scene/moodboard-render";
import { boardImageVariant } from "@/lib/scene/moodboard-resolution";
import {
  referenceIdFromFileId,
  type BoardImageVariant,
  type SceneElement,
} from "@/lib/scene/moodboard-scene";

export const RENDER_MAX_DIMENSION = BOARD_RENDER_MAX_DIMENSION;

export const RENDER_BACKGROUND = "#ffffff";

const DEFAULT_STROKE = "#1e1e1e";
const DEFAULT_LINE_HEIGHT = 1.25;
const DEFAULT_FONT_SIZE = 20;

const FRAME_STROKE = "#bbb";
const FRAME_STROKE_WIDTH = 2;

const FRAME_NAME_BAND = 3 + 14 * 1.25;

const SHAPES: Record<string, RenderShape> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
  arrow: "arrow",
  frame: "frame",
  magicframe: "frame",
};

export type RenderShape = "rectangle" | "ellipse" | "line" | "arrow" | "frame";

const FONTS: Record<number, RenderFont> = {
  1: { dir: "Virgil", family: "Virgil", fallback: "cursive", set: SET_VIRGIL },
  2: { dir: "Liberation", family: "Liberation Sans", fallback: "sans-serif", set: SET_LIBERATION },
  3: { dir: "Cascadia", family: "Cascadia Code", fallback: "monospace", set: SET_CASCADIA },
  5: { dir: "Excalifont", family: "Excalifont", fallback: "cursive", set: SET_EXCALIFONT },
  6: { dir: "Nunito", family: "Nunito ExtraLight", fallback: "sans-serif", set: SET_NUNITO },
  7: { dir: "Lilita", family: "Lilita One", fallback: "sans-serif", set: SET_LILITA },
  8: { dir: "ComicShanns", family: "Comic Shanns Regular", fallback: "cursive", set: SET_COMICSHANNS },
  9: { dir: "Liberation", family: "Liberation Sans", fallback: "sans-serif", set: SET_LIBERATION },
};

export type RenderFont = {
  dir?: string;
  family: string;
  fallback: string;
  set: SetMetric;
  weight?: number;
  italic?: boolean;
};

export const CLASSIC_FONT_FAMILIES: Record<string, string> = Object.fromEntries(
  Object.values(FONTS).map((font) => [font.dir, font.family]),
);

export const DEFAULT_FONT_FAMILY = 5;

export const DEFAULT_RENDER_FONT = FONTS[DEFAULT_FONT_FAMILY]!;

export function renderFont(fontFamily: unknown): RenderFont {
  return (typeof fontFamily === "number" ? FONTS[fontFamily] : undefined) ?? DEFAULT_RENDER_FONT;
}

export function renderFontOf(element: {
  fontFamily?: unknown;
  customData?: unknown;
  [key: string]: unknown;
}): RenderFont {
  const google = googleFontOf(element.customData);
  if (google) {
    return {
      family: google.family,
      fallback: google.fallback,
      set: google.set,
      weight: google.weight,
      italic: google.italic,
    };
  }
  return renderFont(element.fontFamily);
}

export function drawnFontFamily(value: unknown): number {
  return typeof value === "number" && FONTS[value] ? value : DEFAULT_FONT_FAMILY;
}

type Placed = {
  id: string;
  box: Rect;
  angle: number;
  opacity: number;
  clip: Rect | null;
};

export type ImageDraw = Placed & {
  kind: "image";
  referenceId: string;
  region: CropRegion | null;
  variant: BoardImageVariant;
  flipX: boolean;
  flipY: boolean;
  radius: number;
};

export type TextDraw = Placed & {
  kind: "text";
  text: string;
  fontSize: number;
  font: RenderFont;
  lineHeight: number;
  colour: string;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
};

export type ShapeDraw = Placed & {
  kind: "shape";
  shape: RenderShape;
  stroke: string;
  fill: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  dash: [number, number] | null;
  radius: number;
  points: [number, number][] | null;
  curve: boolean;
  arrowheads: { start: string | null; end: string | null };
  sketch: Sketch | null;
};

export type OutlineDraw = Placed & { kind: "outline"; type: string };

export type RenderDraw = ImageDraw | TextDraw | ShapeDraw | OutlineDraw;

export type Undrawn = { id: string; type: string };

export type RenderPlan = {
  frame: Rect;
  scale: number;
  width: number;
  height: number;
  background: string;
  draws: RenderDraw[];
  undrawn: Undrawn[];
};

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function colour(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function renderCanvas(frame: { width: number; height: number }, max = RENDER_MAX_DIMENSION) {
  const longest = Math.max(frame.width, frame.height);
  const scale = longest > max && longest > 0 ? max / longest : 1;
  return {
    scale,
    width: Math.max(1, Math.trunc(frame.width * scale)),
    height: Math.max(1, Math.trunc(frame.height * scale)),
  };
}

type BoardRuns = {
  pages: BoardPage[];
  members: Map<string, SceneElement[]>;
  owned: Set<string>;
};

function boardRuns(elements: readonly SceneElement[]): BoardRuns {
  const pages = boardPages(elements);
  const sections = boardSections(elements, pages);
  const members = new Map<string, SceneElement[]>();
  const owned = new Set<string>();

  for (const page of pages) {
    const own = pageElements(elements, pages, page, sections);
    members.set(page.id, own);
    for (const element of own) owned.add(element.id);
  }

  return { pages, members, owned };
}

export function boardRenderFrame(elements: readonly SceneElement[]): Rect | null {
  return boardFrameOf(elements, boardRuns(elements));
}

function boardFrameOf(elements: readonly SceneElement[], runs: BoardRuns): Rect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const element of elements) {
    if (element.isDeleted === true) continue;
    if (runs.owned.has(element.id)) continue;
    const box = elementBox(element);
    if (!box) continue;
    left = Math.min(left, box.x);
    top = Math.min(top, SHAPES[element.type] === "frame" ? box.y - FRAME_NAME_BAND : box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }

  if (!Number.isFinite(left)) return null;

  const pad = BOARD_RENDER_PADDING;
  return {
    x: left - pad,
    y: top - pad,
    width: right - left + pad * 2,
    height: bottom - top + pad * 2,
  };
}

function place(box: Rect, element: SceneElement, frame: Rect, scale: number, clip: Rect | null) {
  return {
    id: element.id,
    box: {
      x: (box.x - frame.x) * scale,
      y: (box.y - frame.y) * scale,
      width: box.width * scale,
      height: box.height * scale,
    },
    angle: finite(element.angle) ?? 0,
    opacity: elementOpacity(element) / 100,
    clip,
  } satisfies Placed;
}

function flip(element: SceneElement) {
  const scale = Array.isArray(element.scale) ? element.scale : [];
  return { flipX: finite(scale[0]) === -1, flipY: finite(scale[1]) === -1 };
}

function points(element: SceneElement, scale: number): [number, number][] | null {
  if (!Array.isArray(element.points)) return null;

  const path: [number, number][] = [];
  for (const entry of element.points) {
    if (!Array.isArray(entry)) continue;
    const x = finite(entry[0]);
    const y = finite(entry[1]);
    if (x === null || y === null) continue;
    path.push([x * scale, y * scale]);
  }
  return path.length >= 2 ? path : null;
}

function arrowhead(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function strokeStyle(value: unknown): ShapeDraw["strokeStyle"] {
  return value === "dashed" || value === "dotted" ? value : "solid";
}

const DASH_RUN = {
  dashed: (strokeWidth: number): [number, number] => [8, 8 + strokeWidth],
  dotted: (strokeWidth: number): [number, number] => [1.5, 6 + strokeWidth],
};

const NON_SOLID_STROKE_BUMP = 0.5;

const ADAPTIVE_RADIUS = 32;
const PROPORTIONAL_RADIUS = 0.25;

function cornerRadius(element: Record<string, unknown>, width: number, height: number): number {
  const roundness = plainObject(element.roundness);
  if (!roundness) return 0;

  const shorter = Math.min(width, height);
  if (roundness.type !== 3) return shorter * PROPORTIONAL_RADIUS;

  const ceiling = finite(roundness.value) ?? ADAPTIVE_RADIUS;
  return shorter <= ceiling / PROPORTIONAL_RADIUS ? shorter * PROPORTIONAL_RADIUS : ceiling;
}

function splined(element: Record<string, unknown>): boolean {
  if (element.type === "arrow" && element.elbowed === true) return false;
  return plainObject(element.roundness) !== null;
}

export type ShapeAppearance = {
  stroke: string;
  fill: string;
  strokeWidth: number;
  strokeStyle: ShapeDraw["strokeStyle"];
  rounded: boolean;
};

const LOOP_GAP = 8;

function pathIsALoop(element: Record<string, unknown>): boolean {
  if (!Array.isArray(element.points) || element.points.length < 3) return false;
  const end = (entry: unknown) => {
    if (!Array.isArray(entry)) return null;
    const x = finite(entry[0]);
    const y = finite(entry[1]);
    return x === null || y === null ? null : { x, y };
  };
  const first = end(element.points[0]);
  const last = end(element.points[element.points.length - 1]);
  if (!first || !last) return false;
  return Math.hypot(last.x - first.x, last.y - first.y) <= LOOP_GAP;
}

export function paintsInside(element: Record<string, unknown>): boolean {
  const type = element.type;
  if (type === "rectangle" || type === "ellipse" || type === "diamond") return true;
  if (type === "line" || type === "freedraw") return pathIsALoop(element);
  return false;
}

export function shapeAppearance(element: Record<string, unknown>): ShapeAppearance {
  return {
    stroke: colour(element.strokeColor, DEFAULT_STROKE),
    fill: paintsInside(element) ? colour(element.backgroundColor, "transparent") : "transparent",
    strokeWidth: finite(element.strokeWidth) ?? 1,
    strokeStyle: strokeStyle(element.strokeStyle),
    rounded: plainObject(element.roundness) !== null,
  };
}

export function elementOpacity(element: Record<string, unknown>): number {
  return Math.min(100, Math.max(0, finite(element.opacity) ?? 100));
}

function align(value: unknown): TextDraw["align"] {
  return value === "center" || value === "right" ? value : "left";
}

export type TextAppearance = {
  colour: string;
  fontSize: number;
  fontFamily: number;
  align: TextDraw["align"];
  google?: { family: string; weight: number; italic: boolean };
};

export function textAppearance(element: Record<string, unknown>): TextAppearance {
  const google = googleFontOf(element.customData);
  return {
    colour: colour(element.strokeColor, DEFAULT_STROKE),
    fontSize: finite(element.fontSize) ?? DEFAULT_FONT_SIZE,
    fontFamily: google
      ? googleFontInt(google.family, google.weight, google.italic)
      : drawnFontFamily(element.fontFamily),
    align: align(element.textAlign),
    ...(google && {
      google: { family: google.family, weight: google.weight, italic: google.italic },
    }),
  };
}

function verticalAlign(value: unknown): TextDraw["verticalAlign"] {
  return value === "middle" || value === "bottom" ? value : "top";
}

function draw(
  element: SceneElement,
  frame: Rect,
  scale: number,
  clip: Rect | null,
): RenderDraw | null {
  const box = elementBox(element);
  if (!box) return null;
  const placed = place(box, element, frame, scale, clip);

  if (element.type === "image") {
    const referenceId = referenceIdFromFileId(element.fileId);
    if (!referenceId) return { ...placed, kind: "outline", type: element.type };
    return {
      ...placed,
      kind: "image",
      referenceId,
      region: cropRegion(element),
      variant: boardImageVariant(element, scale),
      radius: cornerRadius(element, box.width, box.height) * scale,
      ...flip(element),
    };
  }

  if (element.type === "text") {
    const text = typeof element.text === "string" ? element.text : "";
    if (!text) return null;
    const type = textAppearance(element);
    return {
      ...placed,
      kind: "text",
      text,
      fontSize: type.fontSize * scale,
      font: renderFontOf(element),
      lineHeight: finite(element.lineHeight) ?? DEFAULT_LINE_HEIGHT,
      colour: type.colour,
      align: type.align,
      verticalAlign: verticalAlign(element.verticalAlign),
    };
  }

  const shape = SHAPES[element.type];
  if (!shape) return { ...placed, kind: "outline", type: element.type };

  const framed = shape === "frame";
  const style = shapeAppearance(element);
  const sceneStroke = framed ? FRAME_STROKE_WIDTH : style.strokeWidth;
  const dashRun =
    framed || style.strokeStyle === "solid" ? null : DASH_RUN[style.strokeStyle](sceneStroke);
  const scenePath = shape === "line" || shape === "arrow" ? points(element, 1) : null;
  const path = scenePath?.map(([x, y]): [number, number] => [x * scale, y * scale]) ?? null;
  const radius = framed ? 0 : cornerRadius(element, box.width, box.height);

  return {
    ...placed,
    kind: "shape",
    shape,
    stroke: framed ? FRAME_STROKE : style.stroke,
    fill: style.fill,
    fillStyle: typeof element.fillStyle === "string" ? element.fillStyle : "solid",
    strokeWidth: Math.max(1, (sceneStroke + (dashRun ? NON_SOLID_STROKE_BUMP : 0)) * scale),
    strokeStyle: framed ? "solid" : style.strokeStyle,
    dash: dashRun ? [dashRun[0] * scale, dashRun[1] * scale] : null,
    radius: radius * scale,
    points: path,
    curve: path !== null && path.length > 2 && splined(element),
    arrowheads: { start: arrowhead(element.startArrowhead), end: arrowhead(element.endArrowhead) },
    sketch: framed
      ? null
      : sketchOf(
          {
            type: String(element.type),
            seed: finite(element.seed) ?? 1,
            roughness: finite(element.roughness) ?? 0,
            strokeStyle: style.strokeStyle,
            strokeWidth: sceneStroke,
            fillStyle: typeof element.fillStyle === "string" ? element.fillStyle : "solid",
            fill: style.fill === "transparent" ? null : style.fill,
            width: box.width,
            height: box.height,
            radius,
            rounded: style.rounded,
            points: scenePath,
            elbowed: element.elbowed === true,
          },
          scale,
        ),
  };
}

function planOf(
  frame: Rect,
  runs: { element: SceneElement; clip: Rect | null }[],
  background: unknown,
  max: number,
): RenderPlan {
  const { scale, width, height } = renderCanvas(frame, max);

  const draws: RenderDraw[] = [];
  const undrawn: Undrawn[] = [];
  for (const { element, clip } of runs) {
    const drawn = draw(element, frame, scale, clip);
    if (!drawn) continue;
    draws.push(drawn);
    if (drawn.kind === "outline") undrawn.push({ id: drawn.id, type: drawn.type });
  }

  return {
    frame,
    scale,
    width,
    height,
    background: colour(background, RENDER_BACKGROUND),
    draws,
    undrawn,
  };
}

export type RenderPlanOptions = {
  background?: unknown;
  max?: number;
};

export function pageRenderPlan(
  elements: readonly SceneElement[],
  page: BoardPage,
  { background, max = RENDER_MAX_DIMENSION }: RenderPlanOptions = {},
): RenderPlan {
  const pages = boardPages(elements);
  const own = pageElements(elements, pages, page, boardSections(elements, pages));
  const frame = { x: page.x, y: page.y, width: page.width, height: page.height };

  return planOf(
    frame,
    own.map((element) => ({ element, clip: null })),
    background,
    max,
  );
}

export function boardRenderPlan(
  elements: readonly SceneElement[],
  { background, max = RENDER_MAX_DIMENSION }: RenderPlanOptions = {},
): RenderPlan | null {
  const { pages, members, owned } = boardRuns(elements);

  const frame = boardFrameOf(elements, { pages, members, owned });
  if (!frame) return null;

  const { scale } = renderCanvas(frame, max);

  const pageClips = new Map(
    pages.map((page) => [
      page.id,
      {
        x: (page.x - frame.x) * scale,
        y: (page.y - frame.y) * scale,
        width: page.width * scale,
        height: page.height * scale,
      },
    ]),
  );

  const runs: { element: SceneElement; clip: Rect | null }[] = [];
  for (const element of elements) {
    if (element.isDeleted === true) continue;
    if (owned.has(element.id)) continue;
    runs.push({ element, clip: null });
    const own = members.get(element.id);
    if (!own) continue;
    const clip = pageClips.get(element.id) ?? null;
    for (const child of own) runs.push({ element: child, clip });
  }

  return planOf(frame, runs, background, max);
}

export function undrawnNote(undrawn: readonly Undrawn[]): string {
  if (undrawn.length === 0) return "";

  const counted = new Map<string, number>();
  for (const { type } of undrawn) counted.set(type, (counted.get(type) ?? 0) + 1);

  const named = [...counted]
    .map(([type, count]) => (count === 1 ? `1 ${type}` : `${count} ${type}`))
    .join(", ");
  return `Drawn as empty outlines because this renderer cannot draw them: ${named}.`;
}

const TEXT_ADVANCE = 0.75;

export function textOverflow(draw: TextDraw): { x: number; y: number } {
  const lines = draw.text.split("\n");
  const longest = Math.max(...lines.map((line) => line.length));
  const set = {
    width: longest * draw.fontSize * TEXT_ADVANCE,
    height: lines.length * draw.fontSize * draw.lineHeight,
  };

  return {
    x: Math.max(0, set.width - draw.box.width) / (draw.align === "center" ? 2 : 1),
    y: Math.max(0, set.height - draw.box.height) / (draw.verticalAlign === "middle" ? 2 : 1),
  };
}

export function rotatedBounds(box: Rect, angle: number): Rect {
  if (!angle) return box;

  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const width = box.width * cos + box.height * sin;
  const height = box.width * sin + box.height * cos;

  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

export function drawnBounds(draw: RenderDraw): Rect {
  return rotatedBounds(draw.kind === "text" ? inkBox(draw) : draw.box, draw.angle);
}

function inkBox(draw: TextDraw): Rect {
  const lines = draw.text.split("\n");
  const width = Math.max(...lines.map((line) => setWidth(line, draw.fontSize, draw.font.set)));
  const height = lines.length * draw.fontSize * draw.lineHeight;

  return {
    x: draw.box.x + anchored(draw.box.width - width, draw.align === "center", draw.align === "right"),
    y: draw.box.y + anchored(
      draw.box.height - height,
      draw.verticalAlign === "middle",
      draw.verticalAlign === "bottom",
    ),
    width,
    height,
  };
}

function anchored(slack: number, middle: boolean, far: boolean): number {
  return middle ? slack / 2 : far ? slack : 0;
}

export type Clipped = {
  left: number;
  top: number;
  sourceLeft: number;
  sourceTop: number;
  width: number;
  height: number;
};

export function clipToFrame(box: Rect, canvas: { width: number; height: number }): Clipped | null {
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));

  const sourceLeft = Math.max(0, -left);
  const sourceTop = Math.max(0, -top);
  const visible = {
    width: Math.min(width - sourceLeft, canvas.width - Math.max(0, left)),
    height: Math.min(height - sourceTop, canvas.height - Math.max(0, top)),
  };
  if (visible.width <= 0 || visible.height <= 0) return null;

  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    sourceLeft,
    sourceTop,
    width: visible.width,
    height: visible.height,
  };
}
