import { normalizeHexColor } from "@/lib/analysis/analysis";
import { LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import {
  fontVariantKey,
  googleFontOf,
  type GoogleFontRef,
} from "@/lib/render/font-google";
import type { ReadableShape } from "@/lib/canvas-objects/object-read";

export const DEFAULT_INK = "#1e1e1e";

export const SHAPE_FILL_STYLE = "solid";
export const SHAPE_ROUGHNESS = 0;

export const SHAPE_STROKE_WIDTH = 1;

export const CANVAS_TEXT_MAX_FONT = 512;

export const CANVAS_STROKE_MAX = 100;

export const FONT_FAMILIES = {
  hand: 5,
  sans: 2,
  mono: 3,
  rounded: 6,
  display: 7,
} as const satisfies Record<string, number>;

export type FontName = keyof typeof FONT_FAMILIES;

export const FONT_NAMES = Object.keys(FONT_FAMILIES) as FontName[];

const FONT_NAMES_BY_FAMILY: Record<number, FontName> = {
  ...Object.fromEntries(FONT_NAMES.map((name) => [FONT_FAMILIES[name], name])),
  9: "sans",
};

export function fontNameOf(family: number): FontName | null {
  return FONT_NAMES_BY_FAMILY[family] ?? null;
}

export type TextAlign = "left" | "center" | "right";

const ALIGNS: TextAlign[] = ["left", "center", "right"];

const STROKE_STYLES = ["solid", "dashed", "dotted"] as const;

export type StyleAsked = {
  fill?: unknown;
  stroke?: unknown;
  strokeWidth?: unknown;
  strokeStyle?: unknown;
  rounded?: unknown;
  colour?: unknown;
  font?: unknown;
  weight?: unknown;
  italic?: unknown;
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
  "weight",
  "italic",
  "align",
  "fontSize",
  "opacity",
];

export type StyleTarget = "shape" | "text" | "image" | "page";

export type StyleReading = {
  writes: Record<string, unknown>;
  applied: { field: keyof StyleAsked; writes: Record<string, unknown> }[];
  refusals: string[];
};

const APPLIES: Record<keyof StyleAsked, StyleTarget[]> = {
  fill: ["shape"],
  stroke: ["shape"],
  strokeWidth: ["shape"],
  strokeStyle: ["shape"],
  rounded: ["shape", "image"],
  colour: ["text"],
  font: ["text"],
  weight: ["text"],
  italic: ["text"],
  align: ["text"],
  fontSize: ["text"],
  opacity: ["shape", "text", "image"],
};

const INSTEAD: Record<keyof StyleAsked, string> = {
  fill: "fill is a shape's",
  stroke: "stroke is a shape's",
  strokeWidth: "strokeWidth is a shape's",
  strokeStyle: "strokeStyle is a shape's",
  rounded: "rounded is a shape's or a picture's",
  colour: "colour is a text block's",
  font: "font is a text block's",
  weight: "weight is a text block's",
  italic: "italic is a text block's",
  align: "align is a text block's",
  fontSize: "fontSize is a text block's",
  opacity: "opacity is a shape's, a text block's or an image's",
};

export const PAGE_GROUND_INSTEAD =
  "a page's only appearance is its ground, which is set with set_page_background";

const NOUN: Record<StyleTarget, string> = {
  shape: "a shape",
  text: "a text block",
  image: "an image",
  page: "a page",
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type ResolvedFontVariant = { int: number; font: GoogleFontRef };

export type FontResolution = ResolvedFontVariant | { refusal: string };

export type StyleFonts = {
  resolved?: ReadonlyMap<string, FontResolution>;
  element?: { fontFamily?: unknown; customData?: unknown; [key: string]: unknown };
};

export function fontVariantAsked(
  asked: StyleAsked,
  element?: StyleFonts["element"],
): { family: string; weight?: number; italic?: boolean } | null {
  const weight = weightAsked(asked.weight);
  const italic = typeof asked.italic === "boolean" ? asked.italic : undefined;

  if (typeof asked.font === "string" && asked.font.trim()) {
    if (FONT_NAMES.some((name) => name === asked.font)) return null;
    return { family: asked.font, weight, italic };
  }
  if (asked.font !== undefined) return null;
  if (weight === undefined && italic === undefined) return null;

  const riding = googleFontOf(element?.customData);
  if (!riding) return null;
  return {
    family: riding.family,
    weight: weight ?? riding.weight,
    italic: italic ?? riding.italic,
  };
}

function weightAsked(value: unknown): number | undefined {
  const weight = finite(value);
  return weight !== null && weight >= 100 && weight <= 1000 ? weight : undefined;
}

function customDataWith(
  element: StyleFonts["element"],
  font: GoogleFontRef | null,
): Record<string, unknown> {
  const existing = element?.customData;
  const carried =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  delete carried.font;
  return font ? { ...carried, font } : carried;
}

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
  fonts?: StyleFonts,
): StyleReading {
  const writes: Record<string, unknown> = {};
  const applied: StyleReading["applied"] = [];
  const refusals: string[] = [];

  let faceRead = false;

  for (const field of STYLE_FIELDS) {
    const value = asked[field];
    if (value === undefined) continue;
    if (!APPLIES[field].includes(target)) {
      refusals.push(
        target === "page"
          ? `${INSTEAD[field]}, and this is a page — ${PAGE_GROUND_INSTEAD}`
          : `${INSTEAD[field]}, and this is ${NOUN[target]}`,
      );
      continue;
    }
    const wrote = (columns: Record<string, unknown>) => {
      applied.push({ field, writes: columns });
      Object.assign(writes, columns);
    };
    const wroteAs = (as: keyof StyleAsked, columns: Record<string, unknown>) => {
      applied.push({ field: as, writes: columns });
      Object.assign(writes, columns);
    };

    switch (field) {
      case "fill": {
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
        wrote({ roundness: value ? { type: shape === "line" ? 2 : 3 } : null });
        break;
      }
      case "colour": {
        const colour = paint(value, false);
        if (!colour) refusals.push("colour is a hex colour — type set in transparent is type nobody can read");
        else wrote({ strokeColor: colour });
        break;
      }
      case "font":
      case "weight":
      case "italic": {
        if (faceRead) break;
        faceRead = true;
        faceReading(asked, fonts, wroteAs, refusals);
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

const SINGLE_CUT =
  "comes in one cut — no weights, no italics; for those, name a Google Fonts family in font";

function faceReading(
  asked: StyleAsked,
  fonts: StyleFonts | undefined,
  wroteAs: (as: keyof StyleAsked, columns: Record<string, unknown>) => void,
  refusals: string[],
) {
  const weight = weightAsked(asked.weight);
  const italic = typeof asked.italic === "boolean" ? asked.italic : undefined;
  const weightBad = asked.weight !== undefined && weight === undefined;
  const italicBad = asked.italic !== undefined && italic === undefined;
  if (weightBad) refusals.push("weight is a number, 100 through 1000 — the cuts Google Fonts families come in");
  if (italicBad) refusals.push("italic is true or false");

  const name = FONT_NAMES.find((known) => known === asked.font);
  if (name) {
    const shedding = googleFontOf(fonts?.element?.customData)
      ? { customData: customDataWith(fonts?.element, null) }
      : {};
    wroteAs("font", { fontFamily: FONT_FAMILIES[name], ...shedding });
    if (asked.weight !== undefined && !weightBad) refusals.push(`weight — ${name} ${SINGLE_CUT}`);
    if (asked.italic !== undefined && !italicBad) refusals.push(`italic — ${name} ${SINGLE_CUT}`);
    return;
  }

  if (asked.font !== undefined && (typeof asked.font !== "string" || !asked.font.trim())) {
    refusals.push(
      `font is one of ${FONT_NAMES.join(", ")}, or any Google Fonts family said by its name`,
    );
    return;
  }

  const variant = fontVariantAsked(asked, fonts?.element);
  if (!variant) {
    if (asked.weight !== undefined && !weightBad) {
      refusals.push(`weight — this face ${SINGLE_CUT}`);
    }
    if (asked.italic !== undefined && !italicBad) {
      refusals.push(`italic — this face ${SINGLE_CUT}`);
    }
    return;
  }

  const resolution = fonts?.resolved?.get(
    fontVariantKey(variant.family, variant.weight, variant.italic),
  );
  if (!resolution) {
    refusals.push(
      `the font library could not be consulted for ${variant.family} — the classic names (${FONT_NAMES.join(", ")}) still stand`,
    );
    return;
  }
  if ("refusal" in resolution) {
    refusals.push(resolution.refusal);
    return;
  }

  const columns = {
    fontFamily: resolution.int,
    customData: customDataWith(fonts?.element, resolution.font),
  };
  if (asked.font !== undefined) wroteAs("font", columns);
  if (asked.weight !== undefined && !weightBad) wroteAs("weight", columns);
  if (asked.italic !== undefined && !italicBad) wroteAs("italic", columns);
}

export function shapeDefaults(asked: StyleAsked): Record<string, unknown> {
  const filled = asked.fill !== undefined && asked.stroke === undefined;
  return {
    backgroundColor: "transparent",
    strokeColor: filled ? "transparent" : DEFAULT_INK,
    fillStyle: SHAPE_FILL_STYLE,
    roughness: SHAPE_ROUGHNESS,
    strokeWidth: SHAPE_STROKE_WIDTH,
    strokeStyle: "solid",
    roundness: null,
  };
}
