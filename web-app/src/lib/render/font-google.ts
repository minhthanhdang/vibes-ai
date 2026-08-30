import { DEFAULT_SET, type SetMetric } from "@/lib/render/font-set";

export type GoogleFontRef = {
  family: string;
  weight: number;
  italic: boolean;
  set: SetMetric;
  fallback: string;
};

export const RESERVED_FONT_INTS = new Set([1, 2, 3, 5, 6, 7, 8, 9, 100, 1000]);

export const GOOGLE_FONT_INT_MIN = 10_000;
const GOOGLE_FONT_INT_SPAN = 2 ** 31 - GOOGLE_FONT_INT_MIN;

export function googleFontInt(family: string, weight: number, italic: boolean): number {
  const key = `${family}|${weight}|${italic}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return GOOGLE_FONT_INT_MIN + (hash % GOOGLE_FONT_INT_SPAN);
}

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

export type GoogleFamily = {
  family: string;
  variants: string[];
  category: string;
  latin: boolean;
};

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

export function fallbackOfCategory(category: string): string {
  if (category === "Serif") return "serif";
  if (category === "Monospace") return "monospace";
  if (category === "Handwriting") return "cursive";
  return "sans-serif";
}

const weightOfVariant = (variant: string) => Number.parseInt(variant, 10);

export function variantOf(
  family: GoogleFamily,
  weight: number,
  italic: boolean,
): { weight: number; italic: boolean } | null {
  const key = `${weight}${italic ? "i" : ""}`;
  return family.variants.includes(key) ? { weight, italic } : null;
}

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
