import type { Rect } from "@/lib/boards/board-contents";
import { cropRegion, type CropRegion } from "@/lib/canvas/moodboard-crop";
import {
  boardPages,
  boardSections,
  elementBox,
  pageElements,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { setWidth } from "@/lib/render/text-set";
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

/// What a shape looks like, in the scene's own units, with the defaults above
/// applied — the fields excalidraw carries on every rectangle, ellipse and line.
///
/// Exported because the geometry read describes the same five fields to the
/// model (canvas.md §XI.1) and two readers of one row is how a colour block the
/// picture draws in dashed grey gets listed as a solid black one. The renderer
/// is the reader that has been checked against excalidraw's own export
/// (§III.2.1), so it is the one that stays.
export type ShapeAppearance = {
  stroke: string;
  fill: string;
  strokeWidth: number;
  strokeStyle: ShapeDraw["strokeStyle"];
  rounded: boolean;
};

export function shapeAppearance(element: Record<string, unknown>): ShapeAppearance {
  return {
    stroke: colour(element.strokeColor, DEFAULT_STROKE),
    fill: colour(element.backgroundColor, "transparent"),
    strokeWidth: finite(element.strokeWidth) ?? 1,
    strokeStyle: strokeStyle(element.strokeStyle),
    rounded: plainObject(element.roundness) !== null,
  };
}

/// The scene's own 0-100, clamped. A fraction is what a compositor takes and
/// what `Placed` carries; 0-100 is what excalidraw stores and what a model is
/// told, so the conversion happens in exactly one direction and in one place.
export function elementOpacity(element: Record<string, unknown>): number {
  return Math.min(100, Math.max(0, finite(element.opacity) ?? 100));
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
  const style = shapeAppearance(element);

  return {
    ...placed,
    kind: "shape",
    shape,
    stroke: framed ? FRAME_STROKE : style.stroke,
    fill: style.fill,
    fillStyle: typeof element.fillStyle === "string" ? element.fillStyle : "solid",
    /// Never below a pixel: a hairline at a board-wide downscale is a stroke the
    /// model is told is not there.
    strokeWidth: Math.max(1, (framed ? FRAME_STROKE_WIDTH : style.strokeWidth) * scale),
    strokeStyle: framed ? "solid" : style.strokeStyle,
    rounded: framed ? false : style.rounded,
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

/// How wide a character sets, as a share of the type size.
///
/// A guess, and deliberately a generous one. No font is open on this side — the
/// mirrored faces are `.woff2`, which neither fontconfig nor librsvg will read —
/// so the only thing this number decides is how much room a line that does not
/// fit its own box is given. Over by a third leaves transparent pixels nobody
/// sees; under by one character cuts a word in half.
const TEXT_ADVANCE = 0.75;

/// How far past its own box a set line reaches, per side and per axis.
///
/// A text element's box is not a promise about where its words are. Every text
/// on this canvas is written at the width of the slot it sits in rather than
/// around its own string — `board-line.ts` says why, and `object-put.ts` takes
/// the type size from the box's height and the box's width from whoever asked —
/// and excalidraw draws a line too long for its element straight over the edge
/// rather than wrapping it or cutting it. A picture that cut it would show a
/// headline mid-word, which reads as a page to be fixed rather than as a box to
/// be widened, and a design has spent rounds on exactly that.
///
/// Measured on every page in the development database the day this was written:
/// 51 of 77 text elements on 39 pages set wider than their own box, the worst by
/// 43% of it a side. It is the ordinary case, not the edge one.
///
/// This is the rasteriser's room and nothing else now. It was `drawnBounds`'s
/// answer too until the day the flat ratio was measured against `setWidth`, and
/// the two are not the same question — `setOverflow` below carries the reading
/// that separated them.
export function textOverflow(draw: TextDraw): { x: number; y: number } {
  const lines = draw.text.split("\n");
  const longest = Math.max(...lines.map((line) => line.length));
  const set = {
    width: longest * draw.fontSize * TEXT_ADVANCE,
    height: lines.length * draw.fontSize * draw.lineHeight,
  };

  /// Centred text spills half of it either side; text on a left or a right edge
  /// spills all of it one way, and either way this is the room one side needs.
  return {
    x: Math.max(0, set.width - draw.box.width) / (draw.align === "center" ? 2 : 1),
    y: Math.max(0, set.height - draw.box.height) / (draw.verticalAlign === "middle" ? 2 : 1),
  };
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

/// Where a draw lands on the picture: the rectangle it actually sets in, turned.
///
/// Bands, margins and ink all ask this one question, and the element's own box
/// is the wrong answer for text, which sets past it (`textOverflow`). A
/// headline half again as wide as its box is ink in the picture and white space
/// in the numbers, and a page tool that says both in one answer would be
/// contradicting itself — the disagreement §III.3 spends the whole render stage
/// keeping out of a tool's text. Rotation is folded in for the same reason: the
/// band a turned title reaches into is the band it is in, whatever its own box
/// says.
///
/// Measured over every page in the development database: 19 of the 38 with
/// anything on them read differently from their box read, and one of them
/// differently in kind — a page whose headline the box read put 10% clear of
/// the top edge is a page whose headline reaches it, which is the difference
/// between a margin somebody chose and no margin at all. The rest move by a
/// point or three of ink and of band, so the §VIII baselines taken before this
/// still compare.
///
/// A second correction, and a larger one: the spill under a set line is now
/// measured rather than guessed at 0.75 an em (`setOverflow`). Every ink,
/// covered, band and margin figure taken before it was inflated by whatever
/// each page's paragraphs over-stated.
export function drawnBounds(draw: RenderDraw): Rect {
  return rotatedBounds(draw.kind === "text" ? setBox(draw) : draw.box, draw.angle);
}

/// How far past its box a set line *lands*, which is a different question from
/// how much room to leave for it (`textOverflow`).
///
/// Both were the same number for as long as nothing in this codebase could
/// measure a string. `setWidth` (`text-set.ts`) can, and the two numbers pull
/// opposite ways on purpose: a buffer over by a third costs transparent pixels
/// nobody sees, and a *bounding box* over by a third is the reading. Measured
/// over the 540 text draws on the development database, the flat 0.75 over-
/// states a set line by a median 25% and by 80% at the worst, and it says 132
/// of them hang over their own box when only 20 do — the other 112 are
/// paragraphs the put door already broke to the width they were given, reported
/// as spilling half a box to one side.
///
/// That lands on more than a log. `bandOccupancy` is what `get_page` tells the
/// model about where its work sits, and `contrastRead` samples the ground under
/// a line's centre — which an over-wide box moves, for every line that is not
/// centred.
function setOverflow(draw: TextDraw): { x: number; y: number } {
  const lines = draw.text.split("\n");
  const set = {
    width: Math.max(...lines.map((line) => setWidth(line, draw.fontSize))),
    height: lines.length * draw.fontSize * draw.lineHeight,
  };

  return {
    x: Math.max(0, set.width - draw.box.width) / (draw.align === "center" ? 2 : 1),
    y: Math.max(0, set.height - draw.box.height) / (draw.verticalAlign === "middle" ? 2 : 1),
  };
}

/// Which side of its box a set line hangs over. `setOverflow` gives the room
/// one side needs; the anchor decides whose side that is, and it is the anchor
/// the rasteriser sets the line against — edge-aligned text runs away from its
/// edge, centred text spills both ways.
function setBox(draw: TextDraw): Rect {
  const spill = setOverflow(draw);
  const left = draw.align === "left" ? 0 : spill.x;
  const right = draw.align === "right" ? 0 : spill.x;
  const top = draw.verticalAlign === "top" ? 0 : spill.y;
  const bottom = draw.verticalAlign === "bottom" ? 0 : spill.y;

  return {
    x: draw.box.x - left,
    y: draw.box.y - top,
    width: draw.box.width + left + right,
    height: draw.box.height + top + bottom,
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
