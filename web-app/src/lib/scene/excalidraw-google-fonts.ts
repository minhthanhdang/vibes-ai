import { FONT_FAMILY } from "@excalidraw/excalidraw";

import { googleFontInt, googleFontOf, type GoogleFontRef } from "@/lib/render/font-google";

export function excalidrawFontName(family: string, weight: number, italic: boolean): string {
  return `GF-${family.replace(/\s+/g, "-")}-${weight}${italic ? "i" : ""}`;
}

const registered = new Map<string, Promise<void>>();

const FACE_BLOCK = /@font-face\s*\{[^}]*\}/g;
const URL_IN_BLOCK = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/;
const RANGE_IN_BLOCK = /unicode-range:\s*([^;}]+)[;}]/;

function isLatinRange(range: string): boolean {
  return /u\+0000-00ff/i.test(range);
}

async function registerVariant(ref: GoogleFontRef): Promise<void> {
  const name = excalidrawFontName(ref.family, ref.weight, ref.italic);
  (FONT_FAMILY as unknown as Record<string, number>)[name] = googleFontInt(
    ref.family,
    ref.weight,
    ref.italic,
  );

  const query = `family=${encodeURIComponent(ref.family).replace(/%20/g, "+")}:ital,wght@${ref.italic ? 1 : 0},${ref.weight}&display=swap`;
  const response = await fetch(`https://fonts.googleapis.com/css2?${query}`);
  if (!response.ok) throw new Error(`css2 answered ${response.status}`);
  const css = await response.text();

  const eager: Promise<unknown>[] = [];
  for (const block of css.match(FACE_BLOCK) ?? []) {
    const url = URL_IN_BLOCK.exec(block)?.[1];
    if (!url) continue;
    const range = RANGE_IN_BLOCK.exec(block)?.[1]?.trim();
    const face = new FontFace(name, `url(${url})`, {
      ...(range && { unicodeRange: range }),
      display: "swap",
    });
    document.fonts.add(face);
    if (!range || isLatinRange(range)) eager.push(face.load());
  }
  await Promise.all(eager);
}

export async function ensureGoogleFontsFor(elements: unknown): Promise<boolean> {
  if (typeof document === "undefined" || !Array.isArray(elements)) return false;

  const loads: Promise<void>[] = [];
  let fresh = false;
  for (const element of elements) {
    const row = element as { type?: unknown; customData?: unknown } | null;
    if (row?.type !== "text") continue;
    const ref = googleFontOf(row.customData);
    if (!ref) continue;
    const key = `${ref.family}|${ref.weight}|${ref.italic}`;
    let pending = registered.get(key);
    if (!pending) {
      fresh = true;
      pending = registerVariant(ref).catch((cause: unknown) => {
        registered.delete(key);
        console.warn(`google font ${key} did not load`, cause);
      });
      registered.set(key, pending);
    }
    loads.push(pending);
  }
  await Promise.all(loads);
  return fresh;
}
