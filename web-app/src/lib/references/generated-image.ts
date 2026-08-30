const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const IHDR_NAME_AT = 12;
const WIDTH_AT = 16;
const HEIGHT_AT = 20;
const HEADER_BYTES = 24;

export function pngPixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < HEADER_BYTES) return null;
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null;

  const name = String.fromCharCode(...bytes.slice(IHDR_NAME_AT, IHDR_NAME_AT + 4));
  if (name !== "IHDR") return null;

  const read = (at: number) =>
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
  const width = read(WIDTH_AT);
  const height = read(HEIGHT_AT);
  return width > 0 && height > 0 ? { width, height } : null;
}

export const GENERATED_TITLE_LIMIT = 60;

const fitted = (text: string, room: number) =>
  text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text;

export function generatedImageTitle(
  description: string,
  taken: readonly string[] = [],
  fallback = "Generated picture",
) {
  const said = description.replace(/\s+/g, " ").trim();
  const opening = said.split(/(?<=[.!?])\s|[,;:—]/)[0]?.trim() ?? "";
  const base = opening || said || fallback;

  const already = new Set(taken.map((title) => title.trim()));
  let candidate = "";
  for (let n = 1; n <= already.size + 1; n += 1) {
    const suffix = n === 1 ? "" : ` (${n})`;
    candidate = `${fitted(base, GENERATED_TITLE_LIMIT - suffix.length)}${suffix}`;
    if (!already.has(candidate)) return candidate;
  }
  return candidate;
}

export function drawnFromSaid(reference: { generationPrompt?: string | null } | null | undefined) {
  return reference?.generationPrompt?.trim() || null;
}
