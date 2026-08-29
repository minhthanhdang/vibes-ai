/// The Google Fonts half of the type vocabulary, the parts that are pure: what
/// a face variant is, how it rides on an element, which excalidraw integer it
/// becomes, and the sentences a refusal says.
///
/// Four readers and none may disagree: the server library (`google-fonts.ts`)
/// resolves a name into a variant and hashes it, the style door
/// (`object-style.ts`) writes the variant onto the element, the render plan
/// reads it back into a face and a metric, and the browser registers the same
/// integer under the same family so the editor draws what the server drew.
///
/// No canvas, no React, no DOM, no network.

import { DEFAULT_SET, type SetMetric } from "@/lib/render/font-set";

/// How a Google face rides on a text element: `customData.font`, which
/// excalidraw's restore and copy paths carry through untouched. The element's
/// `fontFamily` integer is `googleFontInt` of the same three fields — the
/// integer is a hash and this is what makes it reversible.
///
/// `set` is the face's measured widths (`font-measure.ts`), stored beside the
/// name so every wrap and ink decision downstream stays synchronous — the
/// resolve that placed the text paid for the measurement once. `fallback` is
/// the generic the markup asks for if the face's file cannot be found.
export type GoogleFontRef = {
  family: string;
  weight: number;
  italic: boolean;
  set: SetMetric;
  fallback: string;
};

/// Excalidraw's own family integers — everything the package reserves today,
/// which the hash below must never land on.
export const RESERVED_FONT_INTS = new Set([1, 2, 3, 5, 6, 7, 8, 9, 100, 1000]);

/// The hash range: far above every reserved integer, and inside a signed 32-bit
/// int so nothing downstream that truncates a `number` bends it.
export const GOOGLE_FONT_INT_MIN = 10_000;
const GOOGLE_FONT_INT_SPAN = 2 ** 31 - GOOGLE_FONT_INT_MIN;

/// One variant's excalidraw integer: FNV-1a over `family|weight|italic`,
/// folded into `[10_000, 2^31)`. Deterministic so the same variant lands on the
/// same integer on every server and in every browser, with no registry to keep.
export function googleFontInt(family: string, weight: number, italic: boolean): number {
  const key = `${family}|${weight}|${italic}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return GOOGLE_FONT_INT_MIN + (hash % GOOGLE_FONT_INT_SPAN);
}

/// The one key both sides of the injected lookup compute (`object-style.ts`'s
/// door and the executor that pre-resolves for it): a variant *as asked*, before
/// the library has said what the family's canonical casing or defaults are.
export function fontVariantKey(family: string, weight?: number, italic?: boolean): string {
  return `${family.trim().toLowerCase()}|${weight ?? ""}|${italic ?? ""}`;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function setMetricOf(value: unknown): SetMetric | null {
  const record = value as Record<string, unknown> | null;
  if (typeof record !== "object" || record === null) return null;
  const read = (key: keyof SetMetric) => finite(record[key]);
  const space = read("space");
  const narrow = read("narrow");
  const wide = read("wide");
  const upper = read("upper");
  const digit = read("digit");
  const other = read("other");
  if (
    space === null ||
    narrow === null ||
    wide === null ||
    upper === null ||
    digit === null ||
    other === null
  ) {
    return null;
  }
  return { space, narrow, wide, upper, digit, other };
}

/// The variant an element carries, or null for one that carries none — which is
/// every classic-face element and every scene written before this vocabulary.
///
/// Lenient about the measured widths on purpose: a ref whose `set` has been
/// stripped by some hand-edit still names a real face, and drawing that face
/// with a generic width estimate is a far better picture than silently falling
/// back to Excalifont. The door always writes the full shape.
export function googleFontOf(customData: unknown): GoogleFontRef | null {
  const font = (customData as { font?: unknown } | null)?.font as
    | Record<string, unknown>
    | null
    | undefined;
  if (typeof font !== "object" || font === null) return null;
  const family = typeof font.family === "string" ? font.family.trim() : "";
  const weight = finite(font.weight);
  if (!family || weight === null || typeof font.italic !== "boolean") return null;
  return {
    family,
    weight,
    italic: font.italic,
    set: setMetricOf(font.set) ?? DEFAULT_SET,
    fallback: typeof font.fallback === "string" && font.fallback ? font.fallback : "sans-serif",
  };
}

/// One family as the metadata endpoint describes it, reduced to what the
/// library needs: the canonical name, the variant keys Google's own `fonts`
/// object uses (`"400"`, `"700i"`), and enough to pick a fallback and to know
/// whether it sets Latin at all.
export type GoogleFamily = {
  family: string;
  variants: string[];
  category: string;
  latin: boolean;
};

/// The `fonts.google.com/metadata/fonts` payload reduced to the lookup the
/// library keeps. Pure so the parse is testable on a fixture without a network.
export function googleFamiliesOf(metadata: unknown): Map<string, GoogleFamily> {
  const list = (metadata as { familyMetadataList?: unknown } | null)?.familyMetadataList;
  const families = new Map<string, GoogleFamily>();
  if (!Array.isArray(list)) return families;
  for (const entry of list) {
    const row = entry as {
      family?: unknown;
      fonts?: unknown;
      category?: unknown;
      subsets?: unknown;
    } | null;
    if (typeof row?.family !== "string" || !row.family) continue;
    const fonts = row.fonts as Record<string, unknown> | null;
    const variants = typeof fonts === "object" && fonts !== null ? Object.keys(fonts) : [];
    if (!variants.length) continue;
    families.set(row.family.toLowerCase(), {
      family: row.family,
      variants,
      category: typeof row.category === "string" ? row.category : "",
      latin: Array.isArray(row.subsets) && row.subsets.includes("latin"),
    });
  }
  return families;
}

/// The generic the markup falls back to if a face's file goes missing, from
/// Google's own classification.
export function fallbackOfCategory(category: string): string {
  if (category === "Serif") return "serif";
  if (category === "Monospace") return "monospace";
  if (category === "Handwriting") return "cursive";
  return "sans-serif";
}

const weightOfVariant = (variant: string) => Number.parseInt(variant, 10);

/// Which variant a family really has for an asked weight and slope — exact
/// match on the metadata's own keys. Null when the family does not cut it.
export function variantOf(
  family: GoogleFamily,
  weight: number,
  italic: boolean,
): { weight: number; italic: boolean } | null {
  const key = `${weight}${italic ? "i" : ""}`;
  return family.variants.includes(key) ? { weight, italic } : null;
}

/// The weight a bare family name lands on: 400 when the family cuts it, and the
/// nearest cut weight when it does not — a face that only comes in 300 and 700
/// is still a face "font: X" should set, not a refusal.
export function defaultWeightOf(family: GoogleFamily, italic: boolean): number | null {
  const weights = family.variants
    .filter((variant) => variant.endsWith("i") === italic)
    .map(weightOfVariant)
    .filter((weight) => Number.isFinite(weight));
  if (!weights.length) return null;
  return weights.reduce((best, weight) =>
    Math.abs(weight - 400) < Math.abs(best - 400) ? weight : best,
  );
}

/// The family's cuts, said the way the refusal lists them: `roman 400, 700;
/// italic 400, 700` — or the halves it actually has.
export function variantsSentence(family: GoogleFamily): string {
  const weights = (italic: boolean) =>
    family.variants
      .filter((variant) => variant.endsWith("i") === italic)
      .map(weightOfVariant)
      .filter((weight) => Number.isFinite(weight))
      .sort((a, b) => a - b)
      .join(", ");
  const roman = weights(false);
  const italic = weights(true);
  const halves = [
    ...(roman ? [`roman ${roman}`] : []),
    ...(italic ? [`italic ${italic}`] : []),
  ];
  return halves.join("; ") || "no cuts at all";
}

/// The closest family name to a misspelt one, for the refusal's "did you
/// mean" — or null when nothing is close enough to be worth saying.
export function nearestFamilyName(
  asked: string,
  families: Iterable<GoogleFamily>,
): string | null {
  const wanted = asked.trim().toLowerCase();
  if (!wanted) return null;
  let best: { family: string; distance: number } | null = null;
  const worthSaying = Math.max(2, Math.floor(wanted.length / 3));
  for (const candidate of families) {
    const distance = editDistance(wanted, candidate.family.toLowerCase(), worthSaying);
    if (distance === null) continue;
    if (!best || distance < best.distance) best = { family: candidate.family, distance };
    if (best.distance === 1) break;
  }
  return best && best.distance <= worthSaying ? best.family : null;
}

/// Levenshtein with a ceiling — null past it, so 1900 candidate names cost a
/// row of small integers each rather than a full matrix.
function editDistance(a: string, b: string, cap: number): number | null {
  if (Math.abs(a.length - b.length) > cap) return null;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + cost);
      row.push(value);
      if (value < least) least = value;
    }
    if (least > cap) return null;
    previous = row;
  }
  return previous[b.length]!;
}
