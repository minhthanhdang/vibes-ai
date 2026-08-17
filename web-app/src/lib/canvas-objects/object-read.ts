import { readingOrder, type Rect } from "@/lib/boards/board-contents";
import {
  boardPages,
  itemsOnPage,
  pageHolding,
  pageItems,
  pagesInReadingOrder,
  type BoardPage,
  type PageSizeLabel,
} from "@/lib/pages/board-pages";
import { clampedText, pageBoxOf } from "@/lib/pages/page-blocks";
import { referenceIdFromFileId } from "@/lib/scene/moodboard-scene";

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
  | (ObjectCommon & {
      kind: "image";
      /// Null for an image naming nothing the project holds — on the canvas
      /// taking up that room, but not *of* anything a tool can look up.
      referenceId: string | null;
    })
  | (ObjectCommon & { kind: "text"; text: string; clamped?: true })
  | (ObjectCommon & {
      kind: "page";
      name: string;
      preset: PageSizeLabel;
      size: { width: number; height: number };
    });

/// An image or text element with everything the read needs, still in scene
/// pixels. Extends `Rect`, so the page modules' own membership and stacking
/// rules run on it unchanged.
type ReadItem = {
  objectId: string;
  kind: "image" | "text";
  referenceId: string | null;
  text: string | null;
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

/// The elements the read surfaces: live images and text with a readable box.
/// Frames are read separately as pages or not at all — an arrow, a rectangle or
/// a palette chip is scaffolding, and a list of grabbable objects that includes
/// them is a list the model will move them by.
function readableItems(elements: readonly unknown[]): ReadItem[] {
  const items: ReadItem[] = [];

  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element || element.isDeleted === true) continue;
    if (element.type !== "image" && element.type !== "text") continue;

    const id = element.id;
    if (typeof id !== "string" || !id) continue;
    const x = finite(element.x);
    const y = finite(element.y);
    const width = finite(element.width);
    const height = finite(element.height);
    if (x === null || y === null || width === null || height === null) continue;
    if (!(width > 0) || !(height > 0)) continue;

    items.push({
      objectId: id,
      kind: element.type,
      referenceId: element.type === "image" ? referenceIdFromFileId(element.fileId) : null,
      text: element.type === "text" && typeof element.text === "string" ? element.text : null,
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
  const shared: ObjectCommon = {
    objectId: item.objectId,
    ...common,
    ...(angle !== undefined && { angle }),
    ...(item.locked && { locked: true as const }),
  };
  return item.kind === "image"
    ? { kind: "image", referenceId: item.referenceId, ...shared }
    : { kind: "text", ...clampedText(item.text ?? ""), ...shared };
}

/// Every object on the board — or on one page of it — with its handle, box,
/// angle, z and page.
///
/// The list reads the way a person reads the board: each page in reading order,
/// the page itself first and then its members in the page's reading order, then
/// everything loose on the canvas in the board's reading order. `z` carries the
/// stacking that a reading-ordered list drops.
///
/// `pageId` narrows the read to that page and its members. Null when it names
/// no page on this board — a caller has to be able to tell an empty page from a
/// page that does not exist.
export function canvasObjects(
  elements: unknown,
  { pageId }: { pageId?: string } = {},
): CanvasObject[] | null {
  if (!Array.isArray(elements)) return pageId ? null : [];

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
    objects.push(pageObject(page, pageZ.get(page.id)!, lockedPages.has(page.id)));
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

  return objects;
}

function pageObject(page: BoardPage, z: number, locked: boolean): CanvasObject {
  return {
    objectId: page.id,
    kind: "page",
    box: sceneBoxOf(page),
    boxUnit: "px",
    z,
    name: page.name,
    preset: page.preset,
    size: { width: page.width, height: page.height },
    ...(locked && { locked: true as const }),
  };
}
