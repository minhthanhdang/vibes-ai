import type { ReadableShape } from "@/lib/canvas-objects/object-read";
import { isPageBackground } from "@/lib/pages/page-background";
import { elementOpacity, shapeAppearance, type ShapeAppearance } from "@/lib/render/render-plan";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

export type BoardItem = {
  kind: "image" | "text" | "shape";
  referenceId: string | null;
  text: string | null;
  shape?: ReadableShape;
  style?: ShapeAppearance;
  opacity?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
};

export type Rect = { x: number; y: number; width: number; height: number };

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const READABLE_SHAPES: Record<string, ReadableShape> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
};

export function boardItems(
  elements: readonly SceneElement[],
  { shapes = false }: { shapes?: boolean } = {},
): BoardItem[] {
  const items: BoardItem[] = [];

  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element) continue;
    if (isPageBackground(element)) continue;
    const drawn = shapes ? READABLE_SHAPES[element.type as string] : undefined;
    if (element.type !== "image" && element.type !== "text" && !drawn) continue;

    const x = finite(element.x);
    const y = finite(element.y);
    const width = finite(element.width);
    const height = finite(element.height);
    if (x === null || y === null || width === null || height === null) continue;
    if (width < 0 || height < 0) continue;
    if (drawn ? !(width > 0 || height > 0) : !(width > 0 && height > 0)) continue;

    const angle = finite(element.angle);
    const opacity = elementOpacity(element);
    items.push({
      kind: drawn ? "shape" : (element.type as "image" | "text"),
      referenceId: element.type === "image" ? referenceIdFromFileId(element.fileId) : null,
      text: element.type === "text" && typeof element.text === "string" ? element.text : null,
      ...(drawn && { shape: drawn, style: shapeAppearance(element) }),
      ...(opacity < 100 && { opacity }),
      x,
      y,
      width,
      height,
      ...(angle ? { angle } : {}),
    });
  }

  return items;
}

export function readingOrder<T extends Rect>(items: readonly T[]): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: T[][] = [];
  let bottom = -Infinity;
  for (const item of sorted) {
    const middle = item.y + item.height / 2;
    if (rows.length && middle < bottom) {
      rows[rows.length - 1].push(item);
      bottom = Math.max(bottom, item.y + item.height);
    } else {
      rows.push([item]);
      bottom = item.y + item.height;
    }
  }

  return rows.flatMap((row) => [...row].sort((a, b) => a.x - b.x));
}

export function boardContents(elements: readonly SceneElement[]) {
  const ordered = readingOrder(boardItems(elements));

  const pictures: string[] = [];
  const seen = new Set<string>();
  for (const item of ordered) {
    if (item.kind !== "image" || !item.referenceId) continue;
    if (seen.has(item.referenceId)) continue;
    seen.add(item.referenceId);
    pictures.push(item.referenceId);
  }

  const lines = ordered
    .filter((item) => item.kind === "text")
    .map((item) => (item.text ?? "").trim())
    .filter(Boolean);

  const unnamedImages = ordered.filter(
    (item) => item.kind === "image" && !item.referenceId,
  ).length;

  return { pictures, lines, unnamedImages };
}

export function sceneBounds(items: readonly Rect[], page: { width: number; height: number }): Rect {
  let left = 0;
  let top = 0;
  let right = page.width;
  let bottom = page.height;

  for (const item of items) {
    left = Math.min(left, item.x);
    top = Math.min(top, item.y);
    right = Math.max(right, item.x + item.width);
    bottom = Math.max(bottom, item.y + item.height);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}
