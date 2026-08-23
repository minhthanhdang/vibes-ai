import type { ReadableShape } from "@/lib/canvas-objects/object-read";
import { isPageBackground } from "@/lib/pages/page-background";
import { elementOpacity, shapeAppearance, type ShapeAppearance } from "@/lib/render/render-plan";
import { referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

/// What is on a board, read back off its stored scene.
///
/// The orchestrator is primed with a board's id, title and page size and nothing
/// else — the scenes are megabytes each and deliberately never read to prime a
/// turn (§II item 0). So the only way it could previously find out what a board
/// holds was to *rebuild* it, which pays a compositor call and rewrites the
/// arrangement in order to answer a question. This module is the read that makes
/// that unnecessary.
///
/// It is also the only place a *hand-arranged* board becomes legible to the
/// pipeline: a board the user dragged together has no assignment, no layout
/// and no placements — it has elements, and this is what elements say.
///
/// No canvas, no React, no DOM.

export type BoardItem = {
  kind: "image" | "text" | "shape";
  /// The picture, for an image element that points at one of our references. An
  /// image pasted in from another scene names bytes we never stored, so it is on
  /// the board without being *of* anything the project holds.
  referenceId: string | null;
  text: string | null;
  /// Which of the three, for a shape asked for by a reader that wanted them
  /// (§XI.1). Absent on the two kinds this list has always carried, so a caller
  /// that never asked cannot tell the difference.
  shape?: ReadableShape;
  /// The renderer's own reading of the appearance columns, so the fill a page
  /// brief says and the fill the picture beside it was drawn with are one read.
  style?: ShapeAppearance;
  /// The scene's 0-100, absent at whole — a block at 30% is a scrim, and a
  /// reader told a colour block sits there is reading a wash as ground. On
  /// every kind, because every kind can be faded: the same sentence is true of
  /// a photograph at 40%, which is the use §XI.2 puts first and the one this
  /// read carried for nobody until it was asked of all three.
  opacity?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /// Radians clockwise about the element's centre, excalidraw's own unit.
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

/// The three an agent draws and reads, by `object-read`'s own list — the fourth
/// kind is one vocabulary or it is two, and a page brief naming a shape the
/// canvas read has no handle for is a block the model cannot act on.
const READABLE_SHAPES: Record<string, ReadableShape> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
};

/// The images and the text of a scene, in the array's own order — which is
/// z-order, not reading order.
///
/// Everything else a user may have drawn is left out: a frame, an arrow or a
/// rectangle is scaffolding around the pictures rather than one of them, and a
/// list of "what is on this board" that counts the arrows is a list the model
/// will read back as pictures.
///
/// `shapes` is the one exception and it is asked for by name (§XI.5). A
/// rectangle stopped being scaffolding the moment an agent could draw one on
/// purpose: a page's arrangement is its colour blocks and its rules as much as
/// its photographs, and a page brief that leaves them out describes empty room
/// where the scrim is. It is opt-in rather than the default because the readers
/// that place, line up and seat *photographs* count what they are handed — a
/// scrim offered to a template as a block to seat is exactly the failure
/// `pageBackground` is lifted out to avoid — so each caller says whether it is
/// reading arrangement or counting pictures.
///
/// One extent is enough for a shape and two are required of everything else,
/// the read's own rule (§XI.1): a rule drawn across a page is a `line` nine
/// hundred wide and none high, while a photograph with no area is drag residue.
export function boardItems(
  elements: readonly SceneElement[],
  { shapes = false }: { shapes?: boolean } = {},
): BoardItem[] {
  const items: BoardItem[] = [];

  for (const entry of elements) {
    const element = plainObject(entry);
    if (!element) continue;
    /// A page's own ground is a rectangle and is never one of the shapes this
    /// counts (§XI.4): it is not something somebody drew on the page, it is the
    /// page. Asked here rather than at each caller because every reader of the
    /// opt-in — the page brief's blocks, the digest's `shapes`, the compose's
    /// `pageCarriesShapes` — would otherwise have to be told separately, and the
    /// last of those would stop agent 4 composing onto any page with a colour.
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

/// The order a user reads the board in, which is the order they count in:
/// "take the third one off" is about this list and not about z-order.
///
/// Rows first, then left to right within a row. Two things are the same row when
/// the lower one's midline is still inside the row above it — overlap rather than
/// a band width, so it needs no guess at how tall a row is meant to be.
///
/// The limit is deliberate and worth stating: a staggered layout (MASONRY) has
/// no true rows, and there a tall picture chains its neighbours into one long
/// row. That reads as one sweep across the board, which is the least wrong
/// answer available without knowing the template.
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

/// What the board holds, said the way the user would say it: the pictures in
/// reading order and the lines set on it.
///
/// A reference on the board twice is one picture — it is one thing the user
/// can name, and its position is the first place it appears.
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

  /// Images on the board that name nothing the project holds — a reference
  /// deleted out from under the board, or a scene pasted in from elsewhere.
  /// Counted rather than listed: there is no id to give back and no tool that
  /// would take one.
  const unnamedImages = ordered.filter(
    (item) => item.kind === "image" && !item.referenceId,
  ).length;

  return { pictures, lines, unnamedImages };
}

/// The rectangle a miniature of this board has to cover: the page, plus anything
/// that was dragged outside it.
///
/// A composed board is exactly its page — the slots are inside it by
/// construction — so this changes nothing there. A board the user arranged
/// by hand has no obligation to stay on the page, and a preview that cropped to
/// the page would quietly omit the picture they just dropped beside it.
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
