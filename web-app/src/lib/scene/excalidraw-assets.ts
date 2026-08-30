export const EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

export const CDN_ONLY_FONT_FAMILIES = ["Xiaolai"];

const FONT_URI = /\.\/fonts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.woff2/g;

export function fontUrisInBundle(source: string): string[] {
  return [...new Set(source.match(FONT_URI) ?? [])].sort();
}

export function fontFamilyOfUri(uri: string): string {
  return uri.split("/")[2] ?? "";
}

export function isCdnOnlyFontUri(uri: string): boolean {
  return CDN_ONLY_FONT_FAMILIES.includes(fontFamilyOfUri(uri));
}

export function mirroredAssetPath(uri: string): string {
  return uri.replace(/^\.?\/+/, "");
}

export function mirroredAssetUrl(uri: string): string {
  return `${EXCALIDRAW_ASSET_PATH}${mirroredAssetPath(uri)}`;
}
