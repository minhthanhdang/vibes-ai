import type { Rect } from "@/lib/boards/board-contents";
import { cropRegion, type CropRegion } from "@/lib/canvas/moodboard-crop";
import {
  boardPages,
  boardSections,
  elementBox,
  pageElements,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { BOARD_RENDER_MAX_DIMENSION, BOARD_RENDER_PADDING } from "@/lib/scene/moodboard-render";
import { boardImageVariant } from "@/lib/scene/moodboard-resolution";
import {
  referenceIdFromFileId,
  type BoardImageVariant,
  type SceneElement,
} from "@/lib/scene/moodboard-scene";

/// What a picture of a page or a board is *of*, before anything has been
/// rasterised: the rectangle being drawn, how many output pixels a scene unit
/// becomes, and one entry per thing to put on it in the order it goes down.
///
/// This is the half of `renderForModel` (§III.2) that is arithmetic. The picture
/// exists so a model can judge an arrangement it cannot otherwise see, so the
/// geometry is the part worth being sure about — and the geometry needs no
/// bucket, no codec and no fonts to check. Splitting it out is the same split
/// `image-generator.ts` makes between the model loop and the filing: everything
/// that can be a function of the scene array is one.
///
/// It is deliberately *not* a renderer. Nothing here decodes an image, measures
/// a glyph or emits SVG; a draw says which reference, which region of it, at
/// which box and which angle, and the rasteriser beside it does the rest.
///
/// No canvas, no React, no DOM.

/// Inherited from the board render (§III.2's budget): the model tiles whatever
/// it is sent, so the cap is ours rather than its, and a second number would be
/// a second answer to a question already settled.
export const RENDER_MAX_DIMENSION = BOARD_RENDER_MAX_DIMENSION;

/// What the picture is painted on before anything is drawn. Excalidraw's own
/// default canvas colour, so a page with nothing behind it reads as paper rather
/// than as a hole.
export const RENDER_BACKGROUND = "#ffffff";

/// Excalidraw's defaults for the fields a hand-written or ancient element can be
/// missing. Reading one as zero would draw an invisible stroke and read it back
/// as "there is nothing there", which is the one answer this picture must not
/// invent.
const DEFAULT_STROKE = "#1e1e1e";
const DEFAULT_LINE_HEIGHT = 1.25;
const DEFAULT_FONT_SIZE = 20;

/// A frame is the one element excalidraw draws in a style of its own, ignoring
/// the stroke fields on the row: `FRAME_STYLE` in the package's constants is a
/// pale grey two units wide, whatever the element says. Every page this app
/// writes carries `strokeColor: "#1e1e1e"` and `strokeWidth: 2` in its row and
/// the user has never seen either — so reading them here drew a near-black
/// border around a page the user sees a pale one around, which is a heavy
/// rectangle the model is asked to judge and nobody put there. Found by
/// `npm run render:check` on every real board in the database (§III.2.1).
const FRAME_STROKE = "#bbb";
const FRAME_STROKE_WIDTH = 2;

/// The element types drawn as themselves. Everything else is drawn as its
/// outline and named — see `RenderPlan.undrawn`.
const SHAPES: Record<string, RenderShape> = {
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
  arrow: "arrow",
  frame: "frame",
  magicframe: "frame",
};

export type RenderShape = "rectangle" | "ellipse" | "line" | "arrow" | "frame";

/// Excalidraw's `fontFamily` is a number and the mirror
/// (`mirror-excalidraw-assets.mts`) puts each family's files under
/// `public/excalidraw-assets/fonts/<dir>`, so this is the only join between the
/// two. `fallback` is what the overlay asks for when that directory has no file
/// the rasteriser can load: a metrically similar generic rather than a failed
/// render, because the model is reading "there is a headline here, this big,
/// over that photograph" and not proofing kerning (§III.2).
///
/// 2 is Helvetica and 9 is Liberation Sans, and excalidraw draws both with the
/// Liberation files — which is why the mirror carries a family the picker never
/// names.
const FONTS: Record<number, RenderFont> = {
  1: { dir: "Virgil", fallback: "cursive" },
  2: { dir: "Liberation", fallback: "sans-serif" },
  3: { dir: "Cascadia", fallback: "monospace" },
  5: { dir: "Excalifont", fallback: "cursive" },
  6: { dir: "Nunito", fallback: "sans-serif" },
  7: { dir: "Lilita", fallback: "sans-serif" },
  8: { dir: "ComicShanns", fallback: "cursive" },
  9: { dir: "Liberation", fallback: "sans-serif" },
};

export type RenderFont = { dir: string; fallback: string };

/// Excalidraw's own default family, which is what an element carrying no
/// readable one was drawn with.
export const DEFAULT_RENDER_FONT = FONTS[5]!;

export function renderFont(fontFamily: unknown): RenderFont {
  return (typeof fontFamily === "number" ? FONTS[fontFamily] : undefined) ?? DEFAULT_RENDER_FONT;
}

/// Every draw carries these. `box` is output pixels from the picture's top-left,
/// `angle` is excalidraw's own radians clockwise about the box's centre, and
/// `opacity` is a fraction because that is what both SVG and a compositor take —
/// the scene stores 0–100.
type Placed = {
  id: string;
  box: Rect;
  angle: number;
  opacity: number;
  /// The page rectangle this element is a member of, in output pixels — the
  /// border excalidraw clips its children at. Null on a page render, where the
  /// picture *is* the page and its own edges do the clipping.
  clip: Rect | null;
};

export type ImageDraw = Placed & {
  kind: "image";
  referenceId: string;
  /// Which region of the source is shown, as fractions of it — null when the
  /// whole of it is. Fractions rather than pixels because the copy being drawn
  /// from is chosen below and a region read off one copy is meaningless against
  /// another (`moodboard-crop.ts`).
  region: CropRegion | null;
  /// Which copy the placement needs, asked of *this* output rather than of a
  /// display: a 1600px picture of a whole board draws a photograph at a few
  /// hundred pixels, and a thumbnail is exactly enough for it.
  variant: BoardImageVariant;
  flipX: boolean;
  flipY: boolean;
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
  rounded: boolean;
  /// A line's or an arrow's own path, in output pixels from `box`'s origin —
  /// null for anything drawn as its rectangle. Without it a bent arrow is drawn
  /// as the box it happens to occupy, which points somewhere else.
  points: [number, number][] | null;
  arrowheads: { start: string | null; end: string | null };
};

/// Something drawn as its bounding rectangle because nothing here can draw it as
/// itself. Paired with an entry in `undrawn`, and the two are one decision:
/// a shape silently missing is a model reasoning about a page with something on
/// it nobody mentioned (§III.2).
export type OutlineDraw = Placed & { kind: "outline"; type: string };

export type RenderDraw = ImageDraw | TextDraw | ShapeDraw | OutlineDraw;

export type Undrawn = { id: string; type: string };

export type RenderPlan = {
  /// The scene rectangle the picture covers.
  frame: Rect;
  /// Output pixels per scene unit, never above 1 — the cap is a ceiling and
  /// upscaling a small page adds pixels and no information.
  scale: number;
  width: number;
  height: number;
  background: string;
  /// Back to front. Array order is z-order, and a page's members are lifted out
  /// of it into a run of their own directly after their page, exactly as the
  /// scene reader resolves them.
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

/// How large the picture of this rectangle is, and what one scene unit becomes.
export function renderCanvas(frame: { width: number; height: number }, max = RENDER_MAX_DIMENSION) {
  const longest = Math.max(frame.width, frame.height);
  const scale = longest > max && longest > 0 ? max / longest : 1;
  return {
    scale,
    width: Math.max(1, Math.round(frame.width * scale)),
    height: Math.max(1, Math.round(frame.height * scale)),
  };
}

/// The rectangle a picture of a whole board covers: everything on it, padded.
///
/// Null for a board with nothing on it. That is not a small case handled
/// defensively — it is the answer, and the board render already takes it
/// (`boardRenderNeeded`): a blank picture is worse than no picture, because a
/// reader cannot tell the two apart.
export function boardRenderFrame(elements: readonly SceneElement[]): Rect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const element of elements) {
    if (element.isDeleted === true) continue;
    const box = elementBox(element);
    if (!box) continue;
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
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
  const opacity = finite(element.opacity);
  return {
    id: element.id,
    box: {
      x: (box.x - frame.x) * scale,
      y: (box.y - frame.y) * scale,
      width: box.width * scale,
      height: box.height * scale,
    },
    angle: finite(element.angle) ?? 0,
    opacity: Math.min(1, Math.max(0, (opacity ?? 100) / 100)),
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

function align(value: unknown): TextDraw["align"] {
  return value === "center" || value === "right" ? value : "left";
}

function verticalAlign(value: unknown): TextDraw["verticalAlign"] {
  return value === "middle" || value === "bottom" ? value : "top";
}

/// One element's draw, or null for one with no rectangle to draw it in.
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
    /// An image naming bytes the project never stored — a scene pasted in from
    /// excalidraw.com — has nothing to composite from, so it gets the outline
    /// every undrawable element gets rather than a hole the size of a
    /// photograph.
    if (!referenceId) return { ...placed, kind: "outline", type: element.type };
    return {
      ...placed,
      kind: "image",
      referenceId,
      region: cropRegion(element),
      variant: boardImageVariant(element, scale),
      ...flip(element),
    };
  }

  if (element.type === "text") {
    const text = typeof element.text === "string" ? element.text : "";
    if (!text) return null;
    return {
      ...placed,
      kind: "text",
      text,
      fontSize: (finite(element.fontSize) ?? DEFAULT_FONT_SIZE) * scale,
      font: renderFont(element.fontFamily),
      lineHeight: finite(element.lineHeight) ?? DEFAULT_LINE_HEIGHT,
      colour: colour(element.strokeColor, DEFAULT_STROKE),
      align: align(element.textAlign),
      verticalAlign: verticalAlign(element.verticalAlign),
    };
  }

  const shape = SHAPES[element.type];
  if (!shape) return { ...placed, kind: "outline", type: element.type };

  /// The frame's own style, not the row's (see `FRAME_STROKE`). The corners are
  /// the one part not followed: excalidraw rounds every frame by a fixed eight
  /// units and this squares them, which is under a pixel once a page is scaled
  /// to fit. What it does not draw at all is the frame's *name*, which the
  /// export writes in grey above the top-left corner — outside the rectangle, so
  /// a page render has nowhere to put it, and the page's name reaches the model
  /// in words on the same answer (§V.4).
  const framed = shape === "frame";

  return {
    ...placed,
    kind: "shape",
    shape,
    stroke: framed ? FRAME_STROKE : colour(element.strokeColor, DEFAULT_STROKE),
    fill: colour(element.backgroundColor, "transparent"),
    fillStyle: typeof element.fillStyle === "string" ? element.fillStyle : "solid",
    /// Never below a pixel: a hairline at a board-wide downscale is a stroke the
    /// model is told is not there.
    strokeWidth: Math.max(
      1,
      (framed ? FRAME_STROKE_WIDTH : (finite(element.strokeWidth) ?? 1)) * scale,
    ),
    strokeStyle: framed ? "solid" : strokeStyle(element.strokeStyle),
    rounded: framed ? false : plainObject(element.roundness) !== null,
    points: shape === "line" || shape === "arrow" ? points(element, scale) : null,
    arrowheads: { start: arrowhead(element.startArrowhead), end: arrowhead(element.endArrowhead) },
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
  /// The scene's own `viewBackgroundColor`. The board is drawn on whatever the
  /// user is looking at it on; a picture on white of a board on charcoal is a
  /// different arrangement.
  background?: unknown;
  max?: number;
};

/// A picture of one page: the page rectangle is the frame, and everything on it
/// is clipped to it by the picture's own edges. A block running off the edge is
/// drawn cut off, because that is what `clipped` means and the model is being
/// asked whether it looks wrong (§III.2).
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

/// A picture of the whole board, pages and loose elements alike.
///
/// Null when there is nothing on it — see `boardRenderFrame`. The caller says so
/// in words; it does not send a blank picture.
export function boardRenderPlan(
  elements: readonly SceneElement[],
  { background, max = RENDER_MAX_DIMENSION }: RenderPlanOptions = {},
): RenderPlan | null {
  const frame = boardRenderFrame(elements);
  if (!frame) return null;

  const { scale } = renderCanvas(frame, max);
  const pages = boardPages(elements);
  const sections = boardSections(elements, pages);

  /// Each page's members lifted out of the array into a run behind their page,
  /// which is the order excalidraw itself keeps them in ("children elements come
  /// right before the parent frame"). Membership is geometric rather than
  /// `frameId`, so the run holds exactly what a page *read* of the same scene
  /// describes — a picture and a description that disagree about what is on a
  /// page is the one thing §III.3's invariant is for.
  const members = new Map<string, SceneElement[]>();
  const owned = new Set<string>();
  for (const page of pages) {
    const own = pageElements(elements, pages, page, sections);
    members.set(page.id, own);
    for (const element of own) owned.add(element.id);
  }

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

/// The sentence a vision tool puts in its text for the shapes it could not draw.
/// Empty when there are none, so a caller appends it unconditionally.
export function undrawnNote(undrawn: readonly Undrawn[]): string {
  if (undrawn.length === 0) return "";

  const counted = new Map<string, number>();
  for (const { type } of undrawn) counted.set(type, (counted.get(type) ?? 0) + 1);

  const named = [...counted]
    .map(([type, count]) => (count === 1 ? `1 ${type}` : `${count} ${type}`))
    .join(", ");
  return `Drawn as empty outlines because this renderer cannot draw them: ${named}.`;
}

/// Where a rotated element's bounding box lands, which is what a compositor is
/// handed: rotating a rectangle produces a larger one, and placing it at the
/// element's own origin would put it up and to the left of where it belongs.
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

export type Clipped = {
  /// Where the visible part goes on the picture.
  left: number;
  top: number;
  /// Which part of the drawn buffer that is.
  sourceLeft: number;
  sourceTop: number;
  width: number;
  height: number;
};

/// The visible part of a box drawn at whole pixels, or null when none of it is.
///
/// A compositor places a buffer at a positive offset and nothing else — there is
/// no negative `left` — so an element hanging over the top or the left edge has
/// to be *cut* before it is placed rather than positioned outside the frame.
/// This is the arithmetic of that cut, and it is where clipping actually happens.
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
