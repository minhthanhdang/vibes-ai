import { readingOrder, type Rect } from "@/lib/boards/board-contents";
import { fontNameOf, type FontName } from "@/lib/canvas-objects/object-style";
import {
  boardPages,
  itemsOnPage,
  pageHolding,
  pageItems,
  pagesInReadingOrder,
  type BoardPage,
  type PageSizeLabel,
} from "@/lib/pages/board-pages";
import { isPageBackground, pageBackgroundColour } from "@/lib/pages/page-background";
import { clampedText, pageBoxOf } from "@/lib/pages/page-blocks";
import {
  elementOpacity,
  shapeAppearance,
  textAppearance,
  type ShapeAppearance,
  type TextAppearance,
} from "@/lib/render/render-plan";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

export type ObjectBox = [number, number, number, number];

type FadedObject = { opacity?: number };

type ObjectCommon = {
  objectId: string;
  box: ObjectBox;
  boxUnit: "thousandths" | "px";
  z: number;
  angle?: number;
  pageId?: string;
  locked?: true;
  clipped?: true;
};

export type CanvasObject =
  | (ObjectCommon & FadedObject & {
      kind: "image";
      referenceId: string | null;
      rounded?: true;
    })
  | (ObjectCommon & FadedObject & {
      kind: "text";
      text: string;
      clamped?: true;
      colour: string;
      fontSize: number;
      font?: FontName | "other" | (string & {});
      weight?: number;
      italic?: true;
      align?: "center" | "right";
    })
  | (ObjectCommon & FadedObject & {
      kind: "shape";
      shape: ReadableShape;
      fill: string;
      stroke: string;
      strokeWidth: number;
      strokeStyle?: "dashed" | "dotted";
      rounded?: true;
    })
  | (ObjectCommon & {
      kind: "page";
      name: string;
      preset: PageSizeLabel;
      size: { width: number; height: number };
      background?: string;
    });

export type ReadableShape = "rectangle" | "ellipse" | "line";

const READABLE_SHAPES: Record<string, ReadableShape> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
};

type ReadItem = {
  objectId: string;
  kind: "image" | "text" | "shape";
  referenceId: string | null;
  text: string | null;
  shape: ReadableShape | null;
  style: ShapeAppearance | null;
  type: TextAppearance | null;
  opacity: number;
  rounded: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  locked: boolean;
};

function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readableKind(element: Record<string, unknown>): ReadItem["kind"] | null {
  if (element.type === "image") return "image";
  if (element.type === "text") return boundLabel(element) ? null : "text";
  return readableShape(element) ? "shape" : null;
}

function readableShape(element: Record<string, unknown>): ReadableShape | null {
  const type = element.type;
  return typeof type === "string" && Object.hasOwn(READABLE_SHAPES, type)
    ? READABLE_SHAPES[type]!
    : null;
}

function boundLabel(element: Record<string, unknown>): boolean {
  return typeof element.containerId === "string" && element.containerId.length > 0;
}

export type ReadableTarget = {
  kind: "image" | "text" | "shape";
  shape: ReadableShape | null;
};

export function readableTarget(entry: unknown): ReadableTarget | null {
  const element = plainObject(entry);
  if (!element || element.isDeleted === true) return null;
  if (isPageBackground(element)) return null;
  const kind = readableKind(element);
  if (!kind) return null;
  if (typeof element.id !== "string" || !element.id) return null;

  const width = finite(element.width);
  const height = finite(element.height);
  if (width === null || height === null || width < 0 || height < 0) return null;
  if (kind === "shape" ? !(width > 0 || height > 0) : !(width > 0 && height > 0)) return null;

  return { kind, shape: readableShape(element) };
}

function readableItems(elements: readonly unknown[]): ReadItem[] {
  const items: ReadItem[] = [];

  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element) continue;
    const target = readableTarget(element);
    if (!target) continue;
    const kind = target.kind;

    const id = element.id;
    const x = finite(element.x);
    const y = finite(element.y);
    const width = finite(element.width);
    const height = finite(element.height);
    if (typeof id !== "string" || x === null || y === null) continue;
    if (width === null || height === null) continue;

    items.push({
      objectId: id,
      kind,
      referenceId: kind === "image" ? referenceIdFromFileId(element.fileId) : null,
      text: kind === "text" && typeof element.text === "string" ? element.text : null,
      shape: target.shape,
      style: kind === "shape" ? shapeAppearance(element) : null,
      type: kind === "text" ? textAppearance(element) : null,
      opacity: elementOpacity(element),
      rounded: plainObject(element.roundness) !== null,
      x,
      y,
      width,
      height,
      angle: finite(element.angle) ?? 0,
      locked: element.locked === true,
    });
  }

  return items;
}

const UNADDRESSABLE_NAMES: Record<string, { one: string; many: string }> = {
  arrow: { one: "arrow", many: "arrows" },
  diamond: { one: "diamond", many: "diamonds" },
  freedraw: { one: "freehand drawing", many: "freehand drawings" },
  embeddable: { one: "embed", many: "embeds" },
  iframe: { one: "embed", many: "embeds" },
};

const BOUND_LABEL_NAME = { one: "label bound to a shape", many: "labels bound to shapes" };

type UnaddressableItem = Rect & { name: { one: string; many: string } };

function unaddressableItems(elements: readonly unknown[]): UnaddressableItem[] {
  const items: UnaddressableItem[] = [];

  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element || element.isDeleted === true) continue;
    if (typeof element.id !== "string" || !element.id) continue;
    if (element.type === "frame" || element.type === "magicframe") continue;
    if (readableKind(element)) continue;

    const type = typeof element.type === "string" ? element.type : "";
    const name =
      element.type === "text" && boundLabel(element)
        ? BOUND_LABEL_NAME
        : (UNADDRESSABLE_NAMES[type] ?? (type ? { one: type, many: `${type}s` } : null));
    if (!name) continue;

    const x = finite(element.x);
    const y = finite(element.y);
    const width = finite(element.width);
    const height = finite(element.height);
    if (x === null || y === null || width === null || height === null) continue;

    items.push({ x, y, width, height, name });
  }

  return items;
}

function unaddressableNote(
  items: readonly UnaddressableItem[],
  scope: "board" | "page",
): string | undefined {
  if (!items.length) return undefined;

  const counted = new Map<string, { count: number; name: UnaddressableItem["name"] }>();
  for (const item of items) {
    const seen = counted.get(item.name.one);
    if (seen) seen.count += 1;
    else counted.set(item.name.one, { count: 1, name: item.name });
  }

  const named = [...counted.values()]
    .map(({ count, name }) => (count === 1 ? `1 ${name.one}` : `${count} ${name.many}`))
    .join(", ");
  return items.length === 1
    ? `1 thing on this ${scope} is not an object you can address: ${named}`
    : `${items.length} things on this ${scope} are not objects you can address: ${named}`;
}

function degreesOf(radians: number): number | undefined {
  if (!radians) return undefined;
  const degrees = ((radians * 180) / Math.PI) % 360;
  const wrapped = Math.round((degrees < 0 ? degrees + 360 : degrees) * 10) / 10;
  return wrapped === 0 || wrapped === 360 ? undefined : wrapped;
}

function sceneBoxOf(rect: Rect): ObjectBox {
  return [
    Math.round(rect.y),
    Math.round(rect.x),
    Math.round(rect.y + rect.height),
    Math.round(rect.x + rect.width),
  ];
}

function itemObject(
  item: ReadItem,
  common: Pick<ObjectCommon, "box" | "boxUnit" | "z" | "pageId" | "clipped">,
): CanvasObject {
  const angle = degreesOf(item.angle);
  const shared: ObjectCommon & FadedObject = {
    objectId: item.objectId,
    ...common,
    ...(angle !== undefined && { angle }),
    ...(item.locked && { locked: true as const }),
    ...(item.opacity < 100 && { opacity: item.opacity }),
  };
  if (item.kind === "image") {
    return {
      kind: "image",
      referenceId: item.referenceId,
      ...(item.rounded && { rounded: true as const }),
      ...shared,
    };
  }

  if (item.kind === "text") {
    const type = item.type!;
    return {
      kind: "text",
      ...clampedText(item.text ?? ""),
      colour: type.colour,
      fontSize: type.fontSize,
      ...typeFace(type),
      ...(type.align !== "left" && { align: type.align }),
      ...shared,
    };
  }

  const style = item.style!;
  return {
    kind: "shape",
    shape: item.shape!,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    ...(style.strokeStyle !== "solid" && { strokeStyle: style.strokeStyle }),
    ...(style.rounded && { rounded: true as const }),
    ...shared,
  };
}

function typeFace(
  type: TextAppearance,
): { font?: FontName | "other" | (string & {}); weight?: number; italic?: true } {
  if (type.google) {
    return {
      font: type.google.family,
      weight: type.google.weight,
      ...(type.google.italic && { italic: true as const }),
    };
  }
  const name = fontNameOf(type.fontFamily);
  if (name === "hand") return {};
  return { font: name ?? "other" };
}

export type CanvasRead = {
  objects: CanvasObject[];
  unaddressable?: string;
};

export function canvasRead(
  elements: unknown,
  { pageId }: { pageId?: string } = {},
): CanvasRead | null {
  if (!Array.isArray(elements)) return pageId ? null : { objects: [] };

  const pages = boardPages(elements);
  const wanted = pageId ? (pages.find((page) => page.id === pageId) ?? null) : null;
  if (pageId && !wanted) return null;

  const items = readableItems(elements);
  const lockedPages = new Set(
    elements
      .map(plainObject)
      .filter((element) => element?.locked === true && typeof element?.id === "string")
      .map((element) => element!.id as string),
  );
  const pageZ = new Map(pages.map((page, z) => [page.id, z]));

  const objects: CanvasObject[] = [];
  for (const page of wanted ? [wanted] : pagesInReadingOrder(pages)) {
    objects.push(
      pageObject(page, pageZ.get(page.id)!, lockedPages.has(page.id), {
        background: pageBackgroundColour(elements as readonly SceneElement[], page),
      }),
    );
    for (const member of pageItems(itemsOnPage(items, pages, page), page)) {
      objects.push(
        itemObject(member, {
          box: pageBoxOf(member, page),
          boxUnit: "thousandths",
          z: member.z,
          pageId: page.id,
          ...(member.clipped && { clipped: true as const }),
        }),
      );
    }
  }

  if (!wanted) {
    const loose = items.filter((item) => pageHolding(pages, item) === null);
    const looseZ = new Map(loose.map((item, z) => [item.objectId, z]));
    for (const item of readingOrder(loose)) {
      objects.push(
        itemObject(item, {
          box: sceneBoxOf(item),
          boxUnit: "px",
          z: looseZ.get(item.objectId)!,
        }),
      );
    }
  }

  const unnamed = unaddressableItems(elements);
  const unaddressable = unaddressableNote(
    wanted ? unnamed.filter((item) => pageHolding(pages, item)?.id === wanted.id) : unnamed,
    wanted ? "page" : "board",
  );

  return { objects, ...(unaddressable && { unaddressable }) };
}

export function canvasObjects(
  elements: unknown,
  options: { pageId?: string } = {},
): CanvasObject[] | null {
  return canvasRead(elements, options)?.objects ?? null;
}

function pageObject(
  page: BoardPage,
  z: number,
  locked: boolean,
  { background }: { background: string | null },
): CanvasObject {
  return {
    objectId: page.id,
    kind: "page",
    box: sceneBoxOf(page),
    boxUnit: "px",
    z,
    name: page.name,
    preset: page.preset,
    size: { width: page.width, height: page.height },
    ...(background && { background }),
    ...(locked && { locked: true as const }),
  };
}
