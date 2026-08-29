import { FONT_FAMILY } from "@excalidraw/excalidraw";

import { googleFontInt, googleFontOf, type GoogleFontRef } from "@/lib/render/font-google";

/// The browser's half of the Google Fonts vocabulary: the editor and every
/// client export draw text through excalidraw, which resolves a `fontFamily`
/// integer to a CSS family via its **mutable** `FONT_FAMILY` table and
/// `document.fonts`. This module walks a scene for the variants its elements
/// ride (`customData.font`), registers each one under a composite family name
/// of its own, and points the element's integer at it — no excalidraw fork,
/// no font-registration API the package does not have.
///
/// Per variant, not per family, because excalidraw's canvas font string
/// carries no weight or style: `${fontSize}px ${familyName}` and nothing else.
/// So "Playfair Display 700 italic" has to be a *family name* to the canvas,
/// registered at weight and style normal — the composite name is the variant.
///
/// The name is a single CSS custom-ident (`GF-Playfair-Display-700i`) rather
/// than the human name with numbers in it: the canvas `font` shorthand parses
/// by CSS rules and an unquoted family starting with a digit-bearing token
/// fails silently, keeping whatever font the context had.
///
/// Faces load from Google's own CDN, one stylesheet fetch per variant and one
/// font fetch per subset actually used — `FontFace` with a `unicodeRange`
/// fetches lazily, and only the Latin subset is forced, so first use of a
/// family costs one small round trip and an unused script costs nothing.
///
/// Accepted caveats, decided with the design: the new faces do not appear in
/// excalidraw's own picker UI (the classic five still do; the agent's tools
/// are unaffected), and vertical centring inside a text element uses
/// excalidraw's fallback metrics for them.

export function excalidrawFontName(family: string, weight: number, italic: boolean): string {
  return `GF-${family.replace(/\s+/g, "-")}-${weight}${italic ? "i" : ""}`;
}

const registered = new Map<string, Promise<void>>();

const FACE_BLOCK = /@font-face\s*\{[^}]*\}/g;
const URL_IN_BLOCK = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/;
const RANGE_IN_BLOCK = /unicode-range:\s*([^;}]+)[;}]/;

/// Whether a subset is the Latin one — the block covering U+0000-00FF, which
/// is every line this product's doors write. It is the one subset loaded
/// eagerly, so an export drawn right after this resolves has real glyphs
/// rather than a fallback face the lazy fetch has not replaced yet.
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
    /// Weight and style stay `normal` on purpose — see the header: the
    /// variant *is* the family, and the canvas asks for nothing else.
    const face = new FontFace(name, `url(${url})`, {
      ...(range && { unicodeRange: range }),
      display: "swap",
    });
    document.fonts.add(face);
    if (!range || isLatinRange(range)) eager.push(face.load());
  }
  await Promise.all(eager);
}

/// Registers and loads every Google variant the given elements ride. Resolves
/// `true` when a face this page had not seen before finished loading — the
/// caller's cue to nudge the editor into a redraw, since excalidraw only
/// watches its own fonts. Failures are per variant and silent beyond the
/// console: the element still draws in its fallback, exactly as it would
/// offline, and nothing else on the board is touched.
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
        /// Not memoised as failed: the next scene update tries again.
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
