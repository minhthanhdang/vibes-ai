/// Which of excalidraw's font files this app serves from its own origin, and
/// where. With nothing set, excalidraw resolves every `@font-face` against
/// `https://esm.sh/@excalidraw/excalidraw@<version>/dist/prod/` — so a board's
/// text depends on a third-party CDN being reachable, and when it is not the
/// text silently falls back to a system font. Silently is the problem: the
/// board still renders, and the export the deck is built from looks nothing
/// like what the director arranged.
///
/// No filesystem and no excalidraw import: the mirror script, the canvas and
/// the test all have to agree on the same rules, and the test reads the real
/// bundle to check the rules still describe it.

/// Excalidraw tries `window.EXCALIDRAW_ASSET_PATH` first and its CDN second
/// (`ExcalidrawFontFace.createUrls` pushes both), so a partial mirror is safe:
/// a family we do not serve 404s here and then loads from esm.sh as before.
export const EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

/// Families left to the CDN. Xiaolai is the CJK fallback and is 12 MB of the
/// package's 13 MB of fonts — a quarter of the repo per install, to serve a
/// script this product's UI does not otherwise support. It keeps working
/// online; what the mirror buys is that the fonts a board actually draws with
/// are ours.
export const CDN_ONLY_FONT_FAMILIES = ["Xiaolai"];

/// The `uri` field of excalidraw's font descriptors, as it appears in the
/// bundle: `./fonts/<Family>/<file>.woff2`.
const FONT_URI = /\.\/fonts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.woff2/g;

/// Every font file the bundle can ask for. Read off the shipped chunks rather
/// than listed here, so a version bump that adds a family is a test failure
/// instead of a family that quietly starts loading from the CDN again.
export function fontUrisInBundle(source: string): string[] {
  return [...new Set(source.match(FONT_URI) ?? [])].sort();
}

export function fontFamilyOfUri(uri: string): string {
  return uri.split("/")[2] ?? "";
}

export function isCdnOnlyFontUri(uri: string): boolean {
  return CDN_ONLY_FONT_FAMILIES.includes(fontFamilyOfUri(uri));
}

/// Where a mirrored uri lands under the asset path. This is excalidraw's own
/// resolution, not ours: it strips the leading `./` and resolves the rest
/// against the asset path with `new URL`, so the mirror has to reproduce the
/// package's directory layout exactly for a file to be found.
export function mirroredAssetPath(uri: string): string {
  return uri.replace(/^\.?\/+/, "");
}

export function mirroredAssetUrl(uri: string): string {
  return `${EXCALIDRAW_ASSET_PATH}${mirroredAssetPath(uri)}`;
}
