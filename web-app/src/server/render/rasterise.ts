import "server-only";
import sharp from "sharp";

import type { Rect } from "@/lib/boards/board-contents";
import { croppedPixels } from "@/lib/canvas/moodboard-crop";
import {
  clipToFrame,
  rotatedBounds,
  type ImageDraw,
  type OutlineDraw,
  type RenderDraw,
  type RenderPlan,
  type ShapeDraw,
  type TextDraw,
  textOverflow,
  type Undrawn,
} from "@/lib/render/render-plan";
import type { BoardImageVariant } from "@/lib/scene/moodboard-scene";

/// The rasterising half of `renderForModel` (§III.2): a plan in, PNG bytes out.
///
/// The arithmetic is next door in `src/lib/render/render-plan.ts` and none of it
/// is repeated here — a draw already says which rectangle, which angle and which
/// region, and this file only turns each one into pixels and lays them down in
/// the order it was handed. That split is `image-generator.ts`'s, for its
/// reason: the geometry is the part worth being sure about and it needs no
/// codec, no bucket and no fonts to check.
///
/// The bytes of a reference come in through `ReferenceBytes` rather than out of
/// GCS, so a test of the drawing pays for neither a bucket nor a signed URL.
///
/// Fidelity is not the point and the plan's header says why: this picture is for
/// a model judging an arrangement. Hachure fills are drawn solid, hand-drawn
/// strokes are drawn straight, and a font that will not load is drawn in a
/// metrically similar one — the same trade three times, and invisible to the
/// question being asked ("is the headline over the photograph too small").

export type ReferenceBytes = (
  referenceId: string,
  variant: BoardImageVariant,
) => Promise<Uint8Array | null>;

export type Raster = {
  bytes: Uint8Array;
  /// The plan's own list plus anything that failed *here* — an image whose bytes
  /// the bucket would not give up is as undrawn as a freedraw scribble, and the
  /// tool's text has to say so either way (§III.2).
  undrawn: Undrawn[];
};

/// Excalidraw's angles are radians and SVG's `rotate()` is degrees.
const degrees = (angle: number) => (angle * 180) / Math.PI;

/// Enough places to hold a sub-pixel offset and short enough to keep the markup
/// small — a page of text is one of these per line.
const round = (value: number) => Math.round(value * 100) / 100;

/// What an element the renderer cannot draw is drawn as. Grey and dashed rather
/// than a stroke of its own colour: an outline that reads as a rectangle
/// somebody drew is worse than no outline, because the list in the tool's text
/// then contradicts the picture.
const OUTLINE_STROKE = "#adb5bd";

/// Room for a stroke sitting on the edge of its own box, which excalidraw
/// centres on the path — half of it hangs outside. Arrowheads reach further
/// still, so the pad is generous rather than exact.
const strokePad = (strokeWidth: number) => Math.ceil(strokeWidth * 4) + 2;

/// Room for a line that does not fit the box it was written into, and under
/// that for the parts of a glyph that hang below the baseline and past the last
/// character — neither of which the element's own box promises to hold once the
/// text is set in a fallback face.
///
/// Capped at the picture's own size because nothing outside the picture is ever
/// composited: a line of a thousand characters would otherwise be set into a
/// canvas tens of thousands of pixels wide to have all but a page of it thrown
/// away.
function textPad(draw: TextDraw, canvas: { width: number; height: number }) {
  const glyph = Math.ceil(draw.fontSize * 0.5) + 2;
  const spill = textOverflow(draw);
  return {
    x: Math.min(canvas.width, Math.ceil(spill.x) + glyph),
    y: Math.min(canvas.height, Math.ceil(spill.y) + glyph),
  };
}

function xml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&apos;";
  });
}

/// A buffer and where its top-left corner goes on the picture, before clipping.
type Drawn = { bytes: Buffer; width: number; height: number; x: number; y: number };

/// The rectangle a draw is allowed to paint in: its page's, cut down to the
/// picture's own edges. A page render has no page rect of its own — the picture
/// *is* the page — so the whole canvas is the window there.
function clipWindow(clip: Rect | null, canvas: { width: number; height: number }) {
  const left = clip ? Math.max(0, Math.round(clip.x)) : 0;
  const top = clip ? Math.max(0, Math.round(clip.y)) : 0;
  const right = clip ? Math.min(canvas.width, Math.round(clip.x + clip.width)) : canvas.width;
  const bottom = clip ? Math.min(canvas.height, Math.round(clip.y + clip.height)) : canvas.height;
  const width = right - left;
  const height = bottom - top;
  return width > 0 && height > 0 ? { x: left, y: top, width, height } : null;
}

type Layer = { input: Buffer; left: number; top: number };

/// One drawn buffer placed inside its window, cut to fit. Null when none of it
/// falls inside — an element dragged off its page is not an error, it is an
/// element the reader cannot see, and the picture has to agree.
async function place(
  drawn: Drawn,
  clip: Rect | null,
  canvas: { width: number; height: number },
): Promise<Layer | null> {
  const window = clipWindow(clip, canvas);
  if (!window) return null;

  const cut = clipToFrame(
    { x: drawn.x - window.x, y: drawn.y - window.y, width: drawn.width, height: drawn.height },
    window,
  );
  if (!cut) return null;

  const whole =
    cut.sourceLeft === 0 &&
    cut.sourceTop === 0 &&
    cut.width === drawn.width &&
    cut.height === drawn.height;

  return {
    input: whole
      ? drawn.bytes
      : await sharp(drawn.bytes)
          .extract({
            left: cut.sourceLeft,
            top: cut.sourceTop,
            width: cut.width,
            height: cut.height,
          })
          .png()
          .toBuffer(),
    left: cut.left + window.x,
    top: cut.top + window.y,
  };
}

/// Markup drawn into a canvas of its own, which is the rotated box padded.
///
/// The rotation is the SVG's rather than a second raster pass: a stroke rotated
/// as pixels is a stroke resampled twice, and the whole reason the vectors are
/// still vectors this far down is that they need not be.
async function vector(
  box: Rect,
  angle: number,
  opacity: number,
  pad: number | { x: number; y: number },
  body: (local: Rect) => string,
): Promise<Drawn> {
  /// Padded and then turned, rather than turned and then padded: what hangs
  /// outside the box hangs outside it in the element's own frame, so a line
  /// spilling off the end of a rotated text box needs the room along the text
  /// rather than along the picture.
  const room = typeof pad === "number" ? { x: pad, y: pad } : pad;
  const frame = rotatedBounds(
    {
      x: box.x - room.x,
      y: box.y - room.y,
      width: box.width + room.x * 2,
      height: box.height + room.y * 2,
    },
    angle,
  );
  const width = Math.max(1, Math.ceil(frame.width));
  const height = Math.max(1, Math.ceil(frame.height));

  const local = { x: box.x - frame.x, y: box.y - frame.y, width: box.width, height: box.height };
  const centre = { x: local.x + local.width / 2, y: local.y + local.height / 2 };
  const rotation = angle
    ? ` transform="rotate(${round(degrees(angle))} ${round(centre.x)} ${round(centre.y)})"`
    : "";

  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<g opacity="${round(opacity)}"${rotation}>${body(local)}</g></svg>`;

  return {
    bytes: await sharp(Buffer.from(markup)).png().toBuffer(),
    width,
    height,
    x: frame.x,
    y: frame.y,
  };
}

function dashes(draw: ShapeDraw) {
  if (draw.strokeStyle === "dashed") return ` stroke-dasharray="${round(draw.strokeWidth * 4)}"`;
  if (draw.strokeStyle === "dotted") {
    return ` stroke-dasharray="${round(draw.strokeWidth)} ${round(draw.strokeWidth * 2)}" stroke-linecap="round"`;
  }
  return "";
}

/// Excalidraw's own rule for a rounded rectangle's radius, which is proportional
/// and capped — a fixed radius reads as a different shape at page size.
function radius(box: Rect) {
  return Math.min(32, Math.min(box.width, box.height) * 0.25);
}

/// A V at the end of a line, drawn from the direction of its last segment.
/// Excalidraw has half a dozen arrowhead shapes and this is all of them: which
/// end an arrow points at is part of the arrangement, and the shape of the head
/// is not.
function head(path: [number, number][], at: "start" | "end") {
  const [tip, from] =
    at === "end" ? [path[path.length - 1]!, path[path.length - 2]!] : [path[0]!, path[1]!];
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const size = Math.max(6, Math.hypot(tip[0] - from[0], tip[1] - from[1]) * 0.2);
  const wing = (turn: number) => {
    const direction = angle + Math.PI + turn;
    return `${round(tip[0] + Math.cos(direction) * size)},${round(tip[1] + Math.sin(direction) * size)}`;
  };
  return `${wing(0.5)} ${round(tip[0])},${round(tip[1])} ${wing(-0.5)}`;
}

function shapeBody(draw: ShapeDraw, local: Rect) {
  /// Whether a colour is painted at all is the plan's question rather than this
  /// one's (`paintsInside`, `render-plan.ts`): a frame and an open line reach
  /// here already transparent, and a `line` whose path closes reaches here
  /// carrying the colour excalidraw's own export fills it with.
  const fill = draw.fill === "transparent" ? "none" : draw.fill;
  const stroke = ` stroke="${xml(draw.stroke)}" stroke-width="${round(draw.strokeWidth)}"${dashes(draw)}`;

  if (draw.shape === "ellipse") {
    const cx = local.x + local.width / 2;
    const cy = local.y + local.height / 2;
    return `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(local.width / 2)}" ry="${round(local.height / 2)}" fill="${xml(fill)}"${stroke}/>`;
  }

  if (draw.shape === "rectangle" || draw.shape === "frame") {
    const rx = draw.rounded ? ` rx="${round(radius(local))}"` : "";
    return `<rect x="${round(local.x)}" y="${round(local.y)}" width="${round(local.width)}" height="${round(local.height)}" fill="${xml(fill)}"${rx}${stroke}/>`;
  }

  /// A line or an arrow with no readable path is drawn corner to corner of its
  /// own box, which is where excalidraw's two-point default sits anyway.
  const path: [number, number][] = (
    draw.points ?? [
      [0, 0],
      [local.width, local.height],
    ]
  ).map(([x, y]) => [local.x + x, local.y + y]);

  const points = path.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
  /// A polyline SVG fills its own implied closing edge, which is what a closed
  /// path is: the loop the user drew with the line tool comes back a polygon
  /// here the way it does in the export, and an open one takes no paint because
  /// the plan already left it none.
  const line = `<polyline points="${points}" fill="${xml(fill)}" stroke-linejoin="round"${stroke}/>`;
  const arrowhead = (at: "start" | "end") =>
    `<polyline points="${head(path, at)}" fill="none" stroke-linejoin="round" stroke="${xml(draw.stroke)}" stroke-width="${round(draw.strokeWidth)}"/>`;

  return (
    line +
    (draw.arrowheads.start ? arrowhead("start") : "") +
    (draw.arrowheads.end ? arrowhead("end") : "")
  );
}

/// The lines are the element's own — `text` carries the breaks and nothing here
/// re-flows them, so a fallback face sets the same words in the same places,
/// wider or narrower on the line rather than broken differently.
///
/// Wider is the ordinary case rather than the edge one, and the box does not
/// hold it: a text this codebase writes is the width of its slot and excalidraw
/// draws the overflow. `textOverflow` is what leaves room for it, and without
/// that room this cut a headline mid-word.
function textBody(draw: TextDraw, local: Rect) {
  const lines = draw.text.split("\n");
  const step = draw.fontSize * draw.lineHeight;
  const block = step * lines.length;

  const top =
    draw.verticalAlign === "middle"
      ? local.y + (local.height - block) / 2
      : draw.verticalAlign === "bottom"
        ? local.y + local.height - block
        : local.y;

  const anchor = draw.align === "center" ? "middle" : draw.align === "right" ? "end" : "start";
  const x =
    draw.align === "center"
      ? local.x + local.width / 2
      : draw.align === "right"
        ? local.x + local.width
        : local.x;

  return lines
    .map((line, index) => {
      /// The cap height centred in its own line box, which is where a reader
      /// asking "is this heading sitting on the photo" looks for it.
      const baseline = top + index * step + step / 2 + draw.fontSize * 0.35;
      return `<text x="${round(x)}" y="${round(baseline)}" font-family="${xml(draw.font.dir)}, ${xml(draw.font.fallback)}" font-size="${round(draw.fontSize)}" fill="${xml(draw.colour)}" text-anchor="${anchor}" xml:space="preserve">${xml(line)}</text>`;
    })
    .join("");
}

/// Whether this machine can set type at all.
///
/// The mirrored excalidraw fonts cannot answer for it: they are `.woff2`, which
/// is what a browser wants and what neither fontconfig nor librsvg will open, so
/// every face here is whatever the machine already has under a generic name.
/// That is the metric fallback §III.2 allows — but a function image with *no*
/// fonts installed does not fall back, it draws nothing, and text vanishing
/// silently from a picture is the failure the undrawn rule exists to prevent.
/// So it is asked once per process and text is outlined and named when the
/// answer is no.
async function probeSetsType() {
  const probe =
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">` +
    `<text x="2" y="30" font-size="30" fill="#000000">H</text></svg>`;
  const { data, info } = await sharp(Buffer.from(probe))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let at = info.channels - 1; at < data.length; at += info.channels) {
    if (data[at]! > 0) return true;
  }
  return false;
}

let setsType: Promise<boolean> | null = null;

function outlineBody(local: Rect) {
  return `<rect x="${round(local.x)}" y="${round(local.y)}" width="${round(local.width)}" height="${round(local.height)}" fill="none" stroke="${OUTLINE_STROKE}" stroke-width="1" stroke-dasharray="6 4"/>`;
}

function outline(draw: OutlineDraw | ImageDraw | TextDraw) {
  return vector(draw.box, draw.angle, draw.opacity, 2, outlineBody);
}

/// A placed photograph: the region it shows, at the size it shows it, flipped,
/// faded and turned.
///
/// `autoOrient` for `cut.ts`'s reason, and it is that reason twice over: the
/// crop region's fractions were measured against the upright frame, and so was
/// the element's aspect ratio. Drawing the stored grid would take the wrong
/// quarter of every photo shot in portrait and then squash it.
async function photograph(draw: ImageDraw, source: Uint8Array): Promise<Drawn | null> {
  const image = sharp(source, { autoOrient: true });
  const frame = (await image.metadata()).autoOrient;
  if (!frame?.width || !frame.height) return null;

  const width = Math.max(1, Math.round(draw.box.width));
  const height = Math.max(1, Math.round(draw.box.height));

  const region = draw.region ? croppedPixels(draw.region, frame) : null;
  let pipeline = region
    ? image.extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    : image;
  pipeline = pipeline.resize(width, height, { fit: "fill" }).ensureAlpha();
  if (draw.flipX) pipeline = pipeline.flop();
  if (draw.flipY) pipeline = pipeline.flip();
  if (draw.opacity < 1) {
    pipeline = pipeline.composite([
      {
        input: {
          create: {
            width,
            height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: draw.opacity },
          },
        },
        blend: "dest-in",
      },
    ]);
  }

  const placed = await pipeline.png().toBuffer();
  if (!draw.angle) return { bytes: placed, width, height, x: draw.box.x, y: draw.box.y };

  /// A second pass rather than one pipeline, because sharp rotates *before* it
  /// resizes: turning in place would rotate the source and then stretch the
  /// turned bounding box to the element's width, which is a different picture.
  const turned = await sharp(placed)
    .rotate(degrees(draw.angle), { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const size = await sharp(turned).metadata();

  /// Centred on the box rather than placed at its corner: rotation grows the
  /// bounding box, and sharp's grown one is the authority on by how much.
  return {
    bytes: turned,
    width: size.width,
    height: size.height,
    x: draw.box.x + width / 2 - size.width / 2,
    y: draw.box.y + height / 2 - size.height / 2,
  };
}

async function drawnOf(
  draw: RenderDraw,
  bytesOf: ReferenceBytes,
  typeSets: boolean,
  canvas: { width: number; height: number },
): Promise<{ drawn: Drawn | null; undrawn: Undrawn | null }> {
  if (draw.kind === "text") {
    if (!typeSets) return { drawn: await outline(draw), undrawn: { id: draw.id, type: "text" } };
    return {
      drawn: await vector(draw.box, draw.angle, draw.opacity, textPad(draw, canvas), (local) =>
        textBody(draw, local),
      ),
      undrawn: null,
    };
  }

  if (draw.kind === "shape") {
    return {
      drawn: await vector(draw.box, draw.angle, draw.opacity, strokePad(draw.strokeWidth), (local) =>
        shapeBody(draw, local),
      ),
      undrawn: null,
    };
  }

  /// An outline the plan already counted — this draws what it named, and only
  /// what it named, or the two halves disagree about one picture.
  if (draw.kind === "outline") return { drawn: await outline(draw), undrawn: null };

  const source = await bytesOf(draw.referenceId, draw.variant).catch(() => null);
  const photo = source ? await photograph(draw, source).catch(() => null) : null;
  if (photo) return { drawn: photo, undrawn: null };

  /// Bytes the bucket would not give up, or a file no codec here can read. It
  /// gets the outline and the naming a freedraw gets, for that rule's reason: a
  /// hole the size of a photograph with nothing said about it is exactly the
  /// picture a model reasons wrongly about.
  return { drawn: await outline(draw), undrawn: { id: draw.id, type: "image" } };
}

export type RasterOptions = {
  /// Asked once per process and injected only so a test can be run as a machine
  /// with no fonts on it, which is the case this cannot be checked on locally.
  fontsLoad?: () => Promise<boolean>;
};

export async function rasterise(
  plan: RenderPlan,
  bytesOf: ReferenceBytes,
  { fontsLoad }: RasterOptions = {},
): Promise<Raster> {
  const canvas = { width: plan.width, height: plan.height };
  const typeSets = await (fontsLoad ? fontsLoad() : (setsType ??= probeSetsType()));

  /// Every draw prepared at once and laid down in one pass, in array order —
  /// which is z-order (§III.2). The preparing is where the decodes are and they
  /// are independent of each other; the laying down is not, and it is one call.
  const prepared = await Promise.all(
    plan.draws.map((draw) => drawnOf(draw, bytesOf, typeSets, canvas)),
  );

  const layers: Layer[] = [];
  const undrawn = [...plan.undrawn];
  for (const [index, { drawn, undrawn: failed }] of prepared.entries()) {
    if (failed) undrawn.push(failed);
    if (!drawn) continue;
    const layer = await place(drawn, plan.draws[index]!.clip, canvas);
    if (layer) layers.push(layer);
  }

  const bytes = await sharp({
    create: { width: canvas.width, height: canvas.height, channels: 4, background: plan.background },
  })
    .composite(layers)
    .png()
    .toBuffer();

  return { bytes: new Uint8Array(bytes), undrawn };
}
