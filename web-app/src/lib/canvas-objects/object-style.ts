import { normalizeHexColor } from "@/lib/analysis/analysis";
import { LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import type { ReadableShape } from "@/lib/canvas-objects/object-read";

/// The style dialect's vocabulary (canvas.md §XI.2): the words an agent says
/// about how a thing looks, and what each one is in the scene.
///
/// One module because there are two doors onto it — `put_on_canvas` sets style
/// as a thing lands and `restyle_on_canvas` sets it afterwards — and a field
/// that means one thing on the way in and another on the way back is the fork
/// §XI.2's whole premise is that this does not have. The read is the third
/// side of it and stays where it is: `object-read` calls `render-plan`'s own
/// `shapeAppearance`, so what the model is told, what the picture was drawn
/// with, and what these writes set are one set of fields.
///
/// Every value is checked against the kind it was asked of and against its own
/// range, and a field that does not apply or does not read is refused with the
/// reason — never dropped, and never quietly corrected. A fill silently
/// ignored on a line is the same failure as a scribble missing from the read:
/// the model believes it did something it did not do.
///
/// No canvas, no React, no DOM: what goes in is a kind and asked fields, what
/// comes out is scene columns or refusals.

/// Excalidraw's own default ink, the colour a text element with no
/// `strokeColor` is drawn in — `render-plan`'s `DEFAULT_STROKE` said at the
/// write door so a shape put lands carrying the colour the read would have
/// reported for it anyway.
export const DEFAULT_INK = "#1e1e1e";

/// Flat and hard-edged, against excalidraw's own hachure and roughness 1. This
/// pair is the whole difference between a design tool and a whiteboard: the
/// sketchy defaults draw a box with gaps in its outline and pencil shading
/// inside it, which is right for a diagram in a meeting and wrong for every
/// colour field a page is built out of. The user who wants the sketched one
/// still has the toolbar (§XI.1). The palette's chips have been written this
/// way since long before the agents could draw (`moodboard-palette.ts`).
export const SHAPE_FILL_STYLE = "solid";
export const SHAPE_ROUGHNESS = 0;

/// One scene unit, excalidraw's own thin. A rule the model asked for and did
/// not size gets the line the toolbar's first stroke width draws.
export const SHAPE_STROKE_WIDTH = 1;

/// The ceiling on a size the model *says*, as against the one `object-put`
/// derives from a box — which keeps `LAYOUT_TEXT_MAX_FONT` 96 exactly where it
/// is, because agent 4 composes through that path and requirement 4 is that its
/// pages do not move (§XI.2).
///
/// It is a typo guard rather than a matter of taste: excalidraw has no ceiling
/// of its own, and the number that has to be refused is the one that writes an
/// element the scene cannot draw. 512 is a quarter of the largest page preset's
/// 2048 edge — larger than any headline a page can carry, and small enough that
/// a dropped decimal point is caught at the door instead of on the canvas.
export const CANVAS_TEXT_MAX_FONT = 512;

/// The same guard on a stroke: excalidraw's own three widths are 1, 2 and 4, a
/// border worth calling a border is single figures, and 100 units is a band
/// across a page. Past that the number is a mistake, not a border.
export const CANVAS_STROKE_MAX = 100;

/// The five families worth naming, onto excalidraw's `fontFamily` integers.
/// The names are what a designer says; the integers are what the scene stores
/// and what `renderFont` in `render-plan.ts` already maps onto the mirrored
/// font directories. That mapping is not repeated here — this is the vocabulary
/// half alone, and `object-style.test.mts` asserts the two agree, so a family
/// renamed in the mirror cannot leave this table pointing at a directory the
/// rasteriser has no files for.
export const FONT_FAMILIES = {
  /// Excalifont, excalidraw's own and today's silent default.
  hand: 5,
  /// Liberation Sans. 2 is the picker's Helvetica and 9 is the same files;
  /// 2 is what the toolbar writes, so it is what this writes.
  sans: 2,
  mono: 3,
  rounded: 6,
  display: 7,
} as const satisfies Record<string, number>;

export type FontName = keyof typeof FONT_FAMILIES;

export const FONT_NAMES = Object.keys(FONT_FAMILIES) as FontName[];

export type TextAlign = "left" | "center" | "right";

const ALIGNS: TextAlign[] = ["left", "center", "right"];

const STROKE_STYLES = ["solid", "dashed", "dotted"] as const;

/// What may be asked, all of it optional and none of it trusted: these arrive
/// as model arguments, so every field is read rather than taken.
export type StyleAsked = {
  fill?: unknown;
  stroke?: unknown;
  strokeWidth?: unknown;
  strokeStyle?: unknown;
  rounded?: unknown;
  colour?: unknown;
  font?: unknown;
  align?: unknown;
  fontSize?: unknown;
  opacity?: unknown;
};

export const STYLE_FIELDS: (keyof StyleAsked)[] = [
  "fill",
  "stroke",
  "strokeWidth",
  "strokeStyle",
  "rounded",
  "colour",
  "font",
  "align",
  "fontSize",
  "opacity",
];

/// Which kind the fields are being asked of. A page takes none of them: its
/// ground is `set_page_background` (§XI.4), because a frame's own fill is not
/// drawn by either renderer.
export type StyleTarget = "shape" | "text" | "image" | "page";

export type StyleReading = {
  /// The scene columns to write, ready to spread onto an element skeleton or a
  /// patch. Empty when nothing readable was asked.
  writes: Record<string, unknown>;
  /// The same columns kept apart by the field that asked for them, which the
  /// put has no use for and the restyle cannot do without: a change asking for
  /// a colour the object already wears has to drop that field and keep the
  /// others, and it has to say back which fields it set by the names the model
  /// used rather than by the scene's column names.
  applied: { field: keyof StyleAsked; writes: Record<string, unknown> }[];
  /// Every field that does not apply or does not read, each with why. Ordered
  /// by `STYLE_FIELDS`, so two calls asking the same wrong thing say it the
  /// same way round.
  refusals: string[];
};

/// Which fields belong to which kind, §XI.2's table as one lookup. `opacity`
/// reaching an image is the deliberate one: a photograph at 40% is a scrim with
/// no element added to the page, and it is what a model reaches for before it
/// reaches for a rectangle.
const APPLIES: Record<keyof StyleAsked, StyleTarget[]> = {
  fill: ["shape"],
  stroke: ["shape"],
  strokeWidth: ["shape"],
  strokeStyle: ["shape"],
  rounded: ["shape"],
  colour: ["text"],
  font: ["text"],
  align: ["text"],
  fontSize: ["text"],
  opacity: ["shape", "text", "image"],
};

/// What to reach for instead, said in the refusal rather than left to the model
/// to work out — a refusal that names no next move is a round spent learning
/// the table.
const INSTEAD: Record<keyof StyleAsked, string> = {
  fill: "fill is a shape's",
  stroke: "stroke is a shape's",
  strokeWidth: "strokeWidth is a shape's",
  strokeStyle: "strokeStyle is a shape's",
  rounded: "rounded is a shape's",
  colour: "colour is a text block's",
  font: "font is a text block's",
  align: "align is a text block's",
  fontSize: "fontSize is a text block's",
  opacity: "opacity is a shape's, a text block's or an image's",
};

/// What the refusal calls the thing it was asked of, so the sentence reads as
/// one a person would say rather than as a type name with an article in front.
const NOUN: Record<StyleTarget, string> = {
  shape: "a shape",
  text: "a text block",
  image: "an image",
  page: "a page",
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/// A hex as the palette reads one — `#rrggbb`, `#fff` and a bare `ffcc00` are
/// all a colour a model turns up with — or excalidraw's own word for no paint
/// at all, which is a fact about a shape rather than a colour and is the
/// difference between a border and a colour field.
function paint(value: unknown, transparent: boolean): string | null {
  if (transparent && typeof value === "string" && value.trim().toLowerCase() === "transparent") {
    return "transparent";
  }
  return normalizeHexColor(value);
}

export function styleReading(
  target: StyleTarget,
  asked: StyleAsked,
  shape?: ReadableShape,
): StyleReading {
  const writes: Record<string, unknown> = {};
  const applied: StyleReading["applied"] = [];
  const refusals: string[] = [];

  for (const field of STYLE_FIELDS) {
    const value = asked[field];
    if (value === undefined) continue;
    if (!APPLIES[field].includes(target)) {
      refusals.push(`${INSTEAD[field]}, and this is ${NOUN[target]}`);
      continue;
    }
    /// One field's columns recorded under the name the model said, and merged
    /// in the same breath so no reader of `writes` has to know `applied` is
    /// there.
    const wrote = (columns: Record<string, unknown>) => {
      applied.push({ field, writes: columns });
      Object.assign(writes, columns);
    };

    switch (field) {
      case "fill": {
        /// A line is a stroke and has no inside — excalidraw stores the fill
        /// and draws nothing with it, which is a field the model believes it
        /// set. Refused toward the one that does show.
        if (shape === "line") {
          refusals.push("a line has no inside to fill — set stroke instead");
          break;
        }
        const colour = paint(value, true);
        if (!colour) refusals.push("fill is a hex colour, or transparent for a shape with nothing behind it");
        else wrote({ backgroundColor: colour });
        break;
      }
      case "stroke": {
        const colour = paint(value, true);
        if (!colour) refusals.push("stroke is a hex colour, or transparent for a shape with no outline");
        else wrote({ strokeColor: colour });
        break;
      }
      case "strokeWidth": {
        const width = finite(value);
        if (width === null || !(width > 0) || width > CANVAS_STROKE_MAX) {
          refusals.push(`strokeWidth is scene units, over 0 and up to ${CANVAS_STROKE_MAX}`);
        } else wrote({ strokeWidth: width });
        break;
      }
      case "strokeStyle": {
        const style = STROKE_STYLES.find((known) => known === value);
        if (!style) refusals.push(`strokeStyle is one of ${STROKE_STYLES.join(", ")}`);
        else wrote({ strokeStyle: style });
        break;
      }
      case "rounded": {
        if (typeof value !== "boolean") {
          refusals.push("rounded is true for rounded corners or false for square ones");
          break;
        }
        /// Excalidraw's two roundness models: a linear element's radius is a
        /// proportion of its own segments, everything else takes the adaptive
        /// radius the toolbar's rounded button writes.
        wrote({ roundness: value ? { type: shape === "line" ? 2 : 3 } : null });
        break;
      }
      case "colour": {
        /// Type takes no `transparent`: a line set in nothing is a line nobody
        /// can read, and the model asking for it means the page's own ground,
        /// not invisible words.
        const colour = paint(value, false);
        if (!colour) refusals.push("colour is a hex colour — type set in transparent is type nobody can read");
        else wrote({ strokeColor: colour });
        break;
      }
      case "font": {
        const name = FONT_NAMES.find((known) => known === value);
        if (!name) refusals.push(`font is one of ${FONT_NAMES.join(", ")}`);
        else wrote({ fontFamily: FONT_FAMILIES[name] });
        break;
      }
      case "align": {
        const align = ALIGNS.find((known) => known === value);
        if (!align) refusals.push(`align is one of ${ALIGNS.join(", ")}`);
        else wrote({ textAlign: align });
        break;
      }
      case "fontSize": {
        const size = finite(value);
        if (size === null || size < LAYOUT_TEXT_MIN_FONT || size > CANVAS_TEXT_MAX_FONT) {
          refusals.push(
            `fontSize is scene units, ${LAYOUT_TEXT_MIN_FONT} through ${CANVAS_TEXT_MAX_FONT} — asked for outside that it is refused rather than quietly cut`,
          );
        } else wrote({ fontSize: size });
        break;
      }
      case "opacity": {
        const opacity = finite(value);
        if (opacity === null || opacity < 0 || opacity > 100) {
          refusals.push("opacity is 0 through 100, where 100 is solid");
        } else wrote({ opacity });
        break;
      }
    }
  }

  return { writes, applied, refusals };
}

/// What a shape lands carrying before anything is asked of it. Split from the
/// reading because these are defaults rather than answers: they are written on
/// every shape put and overwritten by whatever the call said.
///
/// The stroke is the one with a rule behind it. A shape asked for with a fill
/// and no stroke is a colour field, and a colour field with excalidraw's dark
/// outline round it is a box — so a fill with nothing said about the outline
/// takes none, the same reading the palette's chips are written with. A shape
/// asked for with neither lands as the empty outlined rectangle the toolbar
/// draws, which is what "put a shape there" with nothing else said means.
export function shapeDefaults(asked: StyleAsked): Record<string, unknown> {
  const filled = asked.fill !== undefined && asked.stroke === undefined;
  return {
    backgroundColor: "transparent",
    strokeColor: filled ? "transparent" : DEFAULT_INK,
    fillStyle: SHAPE_FILL_STYLE,
    roughness: SHAPE_ROUGHNESS,
    strokeWidth: SHAPE_STROKE_WIDTH,
    strokeStyle: "solid",
    /// Square by default and never absent: `undefined` here would leave the
    /// editor free to apply its own current radius to a shape the model asked
    /// for flat.
    roundness: null,
  };
}
