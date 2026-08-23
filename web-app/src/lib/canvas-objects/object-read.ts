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

/// The scene as objects a model can grab (canvas.md §XI, the canvas toolset).
///
/// `inspect_board` answers what a board *holds*; this answers *where everything
/// is and by what handle* — the read every direct edit is made against. The
/// handle is the element id (for a page, its frame id), never the reference id,
/// which stops naming one thing the moment a photo is placed twice.
///
/// Boxes come in the trained `[ymin, xmin, ymax, xmax]` dialect. An object on a
/// page is measured in thousandths of that page — the format every other surface
/// speaks — and a page, or an object loose on the canvas, has no page to be a
/// share of, so those cross in scene pixels. Each object says which with
/// `boxUnit`, because a number a model has to guess the unit of is a number it
/// will guess wrong.
///
/// Page membership is §V.3's, geometric and never `frameId`: centre inside the
/// page rect, topmost page wins (`pageHolding`). `z` is stacking among the
/// object's own company — a page's members against that page's members, loose
/// objects against loose objects, pages against pages — 0 at the back, the same
/// count the page brief's blocks carry, so the two reads can never disagree
/// about what is in front.
///
/// No canvas, no React, no DOM: what goes in is elements, what comes out is
/// handles and boxes.

/// `[ymin, xmin, ymax, xmax]`, y-first — thousandths of the holding page or
/// scene pixels, per the object's `boxUnit`.
export type ObjectBox = [number, number, number, number];

/// 0-100, absent at 100. On all three kinds that take it, because all three
/// doors set it: a photograph at 40% is a scrim with nothing added to the page
/// (§XI.2), a rectangle at 30% is a wash rather than a colour block, and a line
/// of type at 30% is grey. It was on the shape alone for four stages, so the one
/// use §XI.2 puts first — the fade on a picture — was a field the model could
/// write and no read could see.
type FadedObject = { opacity?: number };

type ObjectCommon = {
  /// The element's own id — what every canvas edit takes. For a page, the
  /// frame element's id, the same string `pageId` means everywhere else.
  objectId: string;
  box: ObjectBox;
  /// Which dialect `box` is in: `thousandths` of the holding page for an object
  /// on one, `px` of the scene for pages and for objects loose on the canvas.
  boxUnit: "thousandths" | "px";
  /// Stacking order among the object's own company, 0 at the back.
  z: number;
  /// Degrees clockwise, said the way a person says it — the scene stores
  /// radians. Absent when the object stands straight.
  angle?: number;
  /// The page holding this object, by §V.3's rule. Absent for a page itself and
  /// for an object loose on the canvas.
  pageId?: string;
  /// Present or absent, never false — locked means "not by accident", and a
  /// transform of a locked object is refused.
  locked?: true;
  /// The object runs over its page's edge and is drawn cut off there; its box
  /// is the part the page shows.
  clipped?: true;
};

export type CanvasObject =
  | (ObjectCommon & FadedObject & {
      kind: "image";
      /// Null for an image naming nothing the project holds — on the canvas
      /// taking up that room, but not *of* anything a tool can look up.
      referenceId: string | null;
    })
  | (ObjectCommon & FadedObject & {
      kind: "text";
      text: string;
      clamped?: true;
      /// The type it is set in — the four fields `restyle_on_canvas` writes on a
      /// block, said back so a design can tell whether two headings share a
      /// family before it repaints one of them (§XI.2). The picture shows all
      /// four and the list showed none, which is invariant 13 on the kind this
      /// product writes most of.
      colour: string;
      /// Scene units, the same dialect `fontSize` is asked in.
      fontSize: number;
      /// Absent for a block in excalidraw's own hand family, which is what a
      /// line placed with no `font` lands in — so the field is a choice
      /// somebody made rather than a default on every line. `"other"` for one
      /// of excalidraw's older faces, which this dialect has no word for and no
      /// door here writes: a block reported absent would read as the hand it is
      /// not.
      font?: FontName | "other";
      /// Absent for type set left, excalidraw's own.
      align?: "center" | "right";
    })
  | (ObjectCommon & FadedObject & {
      kind: "shape";
      shape: ReadableShape;
      /// A hex, or `"transparent"` for an outline with nothing behind it —
      /// which is the difference between a colour field and a border.
      fill: string;
      stroke: string;
      /// Scene units, the same dialect a `px` box is in.
      strokeWidth: number;
      /// Absent when the stroke is solid, so the field is a fact rather than a
      /// default on every line.
      strokeStyle?: "dashed" | "dotted";
      rounded?: true;
    })
  | (ObjectCommon & {
      kind: "page";
      name: string;
      preset: PageSizeLabel;
      size: { width: number; height: number };
      /// The colour the page is painted, absent for a page standing on nothing
      /// (§XI.4). It is here rather than in the object list because that is
      /// where a model looks for it and because a field cannot be grabbed,
      /// moved or sent behind a photograph by accident.
      background?: string;
    });

/// The three shapes an agent reads and writes (§XI.1). `rectangle` and
/// `ellipse` are what a designer builds with — colour fields, scrims, borders —
/// and `line` is a rule. `arrow` is diagram vocabulary whose bindings are a
/// state model with no design payoff, `diamond` covers nothing the other two do
/// not, and `freedraw` is a point array a model can neither author nor afford
/// to read; all three are named in `unaddressable` instead.
export type ReadableShape = "rectangle" | "ellipse" | "line";

const READABLE_SHAPES: Record<string, ReadableShape> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
};

/// An image, text or shape element with everything the read needs, still in
/// scene pixels. Extends `Rect`, so the page modules' own membership and
/// stacking rules run on it unchanged.
type ReadItem = {
  objectId: string;
  kind: "image" | "text" | "shape";
  referenceId: string | null;
  text: string | null;
  /// Which of the three, for a shape; null for the kinds that are not one.
  shape: ReadableShape | null;
  /// Read by the renderer's own reader, so the fill the model is told about is
  /// the fill the picture beside it was drawn with.
  style: ShapeAppearance | null;
  /// The same, for a line of type: what the picture set it in.
  type: TextAppearance | null;
  /// The scene's 0-100.
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /// Radians, as the scene stores them; 0 when unreadable.
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

/// Which kind an element is read as, or null for one this list has no handle
/// for. Frames are read separately as pages, or not at all.
///
/// Shapes are here because the picture already had them: `SHAPES` in
/// `render-plan.ts` draws a rectangle at full fidelity while this list dropped
/// it, so a model was shown a colour block and handed a list without one, and
/// its first move was a headline into the empty space the list claimed
/// (§XI, the style dialect).
///
/// A text element with a `containerId` is a bound label — a palette's hex is
/// one — and it is dropped because a handle a transform will only ever refuse
/// is a loop the model cannot get out of (`object-transform.ts`, the label
/// refusal). It is named in `unaddressable` rather than lost.
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

/// What an element has a handle as, or null for one this list has no handle
/// for — the read's own answer to "is this addressable", exported because
/// `restyle_on_canvas` has to ask exactly the same question. A tool that could
/// write something this read never surfaces is a tool writing a board the model
/// is not looking at.
export type ReadableTarget = {
  kind: "image" | "text" | "shape";
  /// Which of the three, for a shape; null for the kinds that are not one.
  shape: ReadableShape | null;
};

export function readableTarget(entry: unknown): ReadableTarget | null {
  const element = plainObject(entry);
  if (!element || element.isDeleted === true) return null;
  /// A page's own ground is not a thing on the page (§XI.4). It is a rectangle,
  /// so without this it would be the fourth kind's most conspicuous member — and
  /// an object list carrying it invites exactly the two moves it must never
  /// take: a page's colour dragged off its page, and a photograph sent behind it.
  /// It reads as `background` on the page object instead.
  if (isPageBackground(element)) return null;
  const kind = readableKind(element);
  if (!kind) return null;
  if (typeof element.id !== "string" || !element.id) return null;

  const width = finite(element.width);
  const height = finite(element.height);
  if (width === null || height === null || width < 0 || height < 0) return null;
  /// A rule drawn straight across a page is a `line` one scene unit high and
  /// nine hundred wide, so a shape needs one extent rather than two. A
  /// photograph or a line of type with no area is drag residue.
  if (kind === "shape" ? !(width > 0 || height > 0) : !(width > 0 && height > 0)) return null;

  return { kind, shape: readableShape(element) };
}

/// The elements the read surfaces: live images, text and shapes with a readable
/// box.
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

/// What the renderer draws that this list has no handle for, by the name a
/// person would use for it.
///
/// Invariant 13: what the model can see, the model can read. An element drawn
/// in the picture and silent in the words is the one disagreement neither side
/// can detect — so the ones that stay out of the object list are counted and
/// said instead (§XI.1).
const UNADDRESSABLE_NAMES: Record<string, { one: string; many: string }> = {
  arrow: { one: "arrow", many: "arrows" },
  diamond: { one: "diamond", many: "diamonds" },
  freedraw: { one: "freehand drawing", many: "freehand drawings" },
  embeddable: { one: "embed", many: "embeds" },
  iframe: { one: "embed", many: "embeds" },
};

const BOUND_LABEL_NAME = { one: "label bound to a shape", many: "labels bound to shapes" };

type UnaddressableItem = Rect & { name: { one: string; many: string } };

/// Frames are the one live element counted nowhere here: a page is an object in
/// its own right and a section is arrangement the board read already describes
/// (`inspect_board`'s boxes), so naming either as unaddressable would be telling
/// the model twice about something it can already see and address.
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

/// The remainder sentence, or undefined when everything drawn has a handle —
/// so a caller spreads it and says nothing when there is nothing to say.
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

/// Radians to degrees, wrapped to [0, 360) and rounded to a tenth — under any
/// rotation a person can see, and a number a model can say back. Undefined for
/// an object standing straight, so the field is absent rather than a zero on
/// every line.
function degreesOf(radians: number): number | undefined {
  if (!radians) return undefined;
  const degrees = ((radians * 180) / Math.PI) % 360;
  const wrapped = Math.round((degrees < 0 ? degrees + 360 : degrees) * 10) / 10;
  return wrapped === 0 || wrapped === 360 ? undefined : wrapped;
}

/// A box in scene pixels, y-first like every other box here, rounded — a
/// fractional pixel is drag residue, not a position.
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
  if (item.kind === "image") return { kind: "image", referenceId: item.referenceId, ...shared };

  if (item.kind === "text") {
    const type = item.type!;
    return {
      kind: "text",
      ...clampedText(item.text ?? ""),
      colour: type.colour,
      fontSize: type.fontSize,
      ...typeFace(type.fontFamily),
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

/// The family said in the dialect the model writes back in, and nothing said at
/// all for the hand family every line lands in unasked (§XI.2). A face outside
/// the five is `"other"` rather than absent: absent means hand here, and there
/// is no word for excalidraw's older ones that `restyle_on_canvas` would take.
function typeFace(fontFamily: number): { font?: FontName | "other" } {
  const name = fontNameOf(fontFamily);
  if (name === "hand") return {};
  return { font: name ?? "other" };
}

export type CanvasRead = {
  objects: CanvasObject[];
  /// One sentence naming what the picture holds and this list cannot, absent
  /// when there is none — invariant 13's half of the answer.
  unaddressable?: string;
};

/// Every object on the board — or on one page of it — with its handle, box,
/// angle, z and page, and the remainder naming what has no handle.
///
/// The list reads the way a person reads the board: each page in reading order,
/// the page itself first and then its members in the page's reading order, then
/// everything loose on the canvas in the board's reading order. `z` carries the
/// stacking that a reading-ordered list drops.
///
/// `pageId` narrows the read to that page and its members — the remainder with
/// it, since a page-scoped answer that counted the board's arrows would be
/// describing a page the model cannot see. Null when it names no page on this
/// board: a caller has to be able to tell an empty page from a page that does
/// not exist.
export function canvasRead(
  elements: unknown,
  { pageId }: { pageId?: string } = {},
): CanvasRead | null {
  if (!Array.isArray(elements)) return pageId ? null : { objects: [] };

  const pages = boardPages(elements);
  const wanted = pageId ? (pages.find((page) => page.id === pageId) ?? null) : null;
  if (pageId && !wanted) return null;

  const items = readableItems(elements);
  /// `boardPages` keeps no locked mark — a page read has never needed one — so
  /// it is read off the frame elements here, where a locked page is a page a
  /// transform must refuse to move.
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

/// The object list alone, for the callers that have no remainder to report —
/// `objectShape`'s lookup and every test that predates the fourth kind.
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
