import type { Rect } from "@/lib/boards/board-contents";
import { cropRegion, type CropRegion } from "@/lib/canvas/moodboard-crop";
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
///
/// `set` rides here rather than in a second table keyed by the same integers:
/// how wide a face draws and which directory it is mirrored under are two facts
/// about one font, and a family added to one lookup and forgotten in the other
/// is a line measured in a face it is not drawn in — which is exactly the
/// defect the single Helvetica table was (`text-set.ts`).
const FONTS: Record<number, RenderFont> = {
  1: { dir: "Virgil", fallback: "cursive", set: SET_VIRGIL },
  2: { dir: "Liberation", fallback: "sans-serif", set: SET_LIBERATION },
  3: { dir: "Cascadia", fallback: "monospace", set: SET_CASCADIA },
  5: { dir: "Excalifont", fallback: "cursive", set: SET_EXCALIFONT },
  6: { dir: "Nunito", fallback: "sans-serif", set: SET_NUNITO },
  7: { dir: "Lilita", fallback: "sans-serif", set: SET_LILITA },
  8: { dir: "ComicShanns", fallback: "cursive", set: SET_COMICSHANNS },
  9: { dir: "Liberation", fallback: "sans-serif", set: SET_LIBERATION },
};

export type RenderFont = { dir: string; fallback: string; set: SetMetric };

/// Excalidraw's own default family, the one an element carrying no readable
/// `fontFamily` is drawn in — as the integer the scene stores, because the
/// object read has to say which family and not which directory (§XI.2).
export const DEFAULT_FONT_FAMILY = 5;

export const DEFAULT_RENDER_FONT = FONTS[DEFAULT_FONT_FAMILY]!;

export function renderFont(fontFamily: unknown): RenderFont {
  return (typeof fontFamily === "number" ? FONTS[fontFamily] : undefined) ?? DEFAULT_RENDER_FONT;
}

/// Which family a text element is *drawn* in, which is the one the read has to
/// name: a family the mirror has no files for falls back in the picture, so it
/// has to fall back in the words too or the model is told a face nothing set.
export function drawnFontFamily(value: unknown): number {
  return typeof value === "number" && FONTS[value] ? value : DEFAULT_FONT_FAMILY;
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

/// Excalidraw's own `LINE_CONFIRM_THRESHOLD`, in scene units: two ends this
/// close are the same point to the hand that drew them, and the path is closed.
const LOOP_GAP = 8;

/// Whether the ends of a linear element's path meet — excalidraw's
/// `isPathALoop`, which wants three points as well as the gap, because a
/// two-point line whose ends coincide is a dot rather than a shape.
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

/// Whether excalidraw paints the inside of this element, which every reading of
/// a fill on this codebase had been answering by assuming it does.
///
/// A rectangle, an ellipse and a diamond always do. A `line` does only when its
/// path closes: excalidraw hands roughjs a fill for a linear element exactly
/// when `isPathALoop` holds, so a rule drawn across a page stores whatever
/// `backgroundColor` the toolbar was carrying and paints none of it — and the
/// toolbar puts its current colour on *every* new element, so an open line with
/// a fill on it is one click away rather than hypothetical. An `arrow` never
/// takes one. A frame never takes one either, which is the whole reason a
/// page's ground is a rectangle of its own (§XI.4).
///
/// Asked here because `shapeAppearance` is the one reader of these columns: the
/// picture, the object read and the page brief's blocks all take a shape's fill
/// from it, so a colour nobody paints has to stop being a fill in one place or
/// it goes on being one in three.
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

/// The scene's own 0-100, clamped. A fraction is what a compositor takes and
/// what `Placed` carries; 0-100 is what excalidraw stores and what a model is
/// told, so the conversion happens in exactly one direction and in one place.
export function elementOpacity(element: Record<string, unknown>): number {
  return Math.min(100, Math.max(0, finite(element.opacity) ?? 100));
}

function align(value: unknown): TextDraw["align"] {
  return value === "center" || value === "right" ? value : "left";
}

/// How a line of type is set, in the scene's own units and with the defaults
/// above applied — the four columns `restyle_on_canvas` writes on a text block.
///
/// Exported for `shapeAppearance`'s reason and it is the same reason twice: the
/// object read describes what a restyle can change (canvas.md §XI.2), and a
/// second reader of `strokeColor` and `fontFamily` is how a headline the picture
/// draws in white gets listed as excalidraw's near-black. `fontFamily` is the
/// integer the scene stores and the *drawn* one — an unreadable family is
/// Excalifont in the picture, so it has to be Excalifont in the words — and the
/// name a model says for it stays in `object-style.ts`, which is the vocabulary
/// half (§XI.2).
export type TextAppearance = {
  colour: string;
  fontSize: number;
  fontFamily: number;
  align: TextDraw["align"];
};

export function textAppearance(element: Record<string, unknown>): TextAppearance {
  return {
    colour: colour(element.strokeColor, DEFAULT_STROKE),
    fontSize: finite(element.fontSize) ?? DEFAULT_FONT_SIZE,
    fontFamily: drawnFontFamily(element.fontFamily),
    align: align(element.textAlign),
  };
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
    const type = textAppearance(element);
    return {
      ...placed,
      kind: "text",
      text,
      fontSize: type.fontSize * scale,
      font: renderFont(type.fontFamily),
      lineHeight: finite(element.lineHeight) ?? DEFAULT_LINE_HEIGHT,
      colour: type.colour,
      align: type.align,
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
/// measured rather than guessed at 0.75 an em (`inkBox`). Every ink, covered,
/// band and margin figure taken before it was inflated by whatever each page's
/// paragraphs over-stated.
///
/// A third, and larger again, because the second one only fixed the direction
/// the box was too *small* in. A text element's box is room a design reserved
/// and the type inside it fills as much of that room as the words happen to
/// need — so the box is also, and much more often, too big. `inkBox` measures
/// the type both ways.
export function drawnBounds(draw: RenderDraw): Rect {
  return rotatedBounds(draw.kind === "text" ? inkBox(draw) : draw.box, draw.angle);
}

/// The rectangle a set line's glyphs fill, which is a different question from
/// how much room to leave for it (`textOverflow`) and from the box it was given.
///
/// The box and the ink were the same rectangle for as long as nothing in this
/// codebase could measure a string. `setWidth` (`text-set.ts`) can, and the two
/// pull apart in both directions:
///
/// - **past the box**, where a headline set wider than the box it was handed is
///   ink in the picture and white space in the numbers. Guessed at a flat 0.75
///   an em until it was measured: over the 540 text draws on the development
///   database the pad over-states a set line by a median 25%, and it says 132
///   of them hang over their own box when only 20 do.
/// - **inside the box**, which is the larger half and the one the pad could
///   never have found. `put_on_canvas` writes the box the design asked for and
///   sets the words into it, so `&` in a 720-wide slot is a 720-wide rectangle
///   of ink to every reading here and a 38-wide ampersand in the picture. Over
///   the 579 text draws here the box is a median **1.7x** the ink it holds, 208
///   of them over twice, and one 19x.
///
/// The anchor decides where the ink sits in the room: edge-aligned text runs
/// from its edge, centred text sits in the middle and spills both ways. Same
/// three cases each axis, which is why one rectangle answers both directions —
/// a box wider than its type and a type wider than its box are the same
/// arithmetic with the sign flipped.
///
/// That lands on more than a log. `bandOccupancy` is what `get_page` tells the
/// model about where its work sits, and `contrastRead` samples the ground under
/// a line's centre — which an over-wide box moves, for every line that is not
/// centred.
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

/// Where the slack between a box and its type goes, on one axis: none of it
/// before the near edge, half of it before the middle, all of it before the far
/// one. Negative slack is the overflow case and takes the same three answers,
/// which is the whole reason this is one function rather than two.
function anchored(slack: number, middle: boolean, far: boolean): number {
  return middle ? slack / 2 : far ? slack : 0;
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
