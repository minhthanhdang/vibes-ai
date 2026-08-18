/// The two things the executor has to work out about a picture the image model
/// just drew, both of them off the bytes and the words it was asked for: how big
/// it came out, and what to call it in a gallery of filenames.

/// PNG's own eight-byte preamble, which the first chunk of every PNG follows.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// Where the IHDR chunk's two dimensions sit: the signature, a four-byte chunk
/// length, the four-character chunk name, then width and height as big-endian
/// 32-bit integers. A PNG whose first chunk is not IHDR is not a PNG — the
/// format requires it first — so nothing here scans for the chunk.
const IHDR_NAME_AT = 12;
const WIDTH_AT = 16;
const HEIGHT_AT = 20;
const HEADER_BYTES = 24;

/// The pixel size a generated picture is filed at, read out of its own header.
///
/// A reference with no width and height is a reference the layouts cannot place
/// — every fit in this product is a fit of a rectangle — and the only other way
/// to know is a canvas, which the server does not have. Twenty-four bytes of
/// header is the whole cost, so this is done here rather than left to the
/// browser's later `attachDerived`, which would land after the board was built.
///
/// Null rather than a guess when the bytes are not a PNG's: the row then carries
/// no size at all, which the rest of the system already handles (an import from
/// a hotlink-protected origin lands the same way).
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

/// The same ceiling a composed board's title has, and for the same reason: it is
/// read in a tile caption beside a thumbnail.
export const GENERATED_TITLE_LIMIT = 60;

/// A gallery needs a name and the model was handed a paragraph. The first clause
/// of a description is what the user asked for — "a warm grey paper texture, lit
/// flat, no grain" — and everything after it is how to draw it, so the title is
/// the opening rather than the first sixty characters of the whole thing.
export function generatedImageTitle(description: string, fallback = "Generated picture") {
  const said = description.replace(/\s+/g, " ").trim();
  const opening = said.split(/(?<=[.!?])\s|[,;:—]/)[0]?.trim() ?? "";
  const title = opening || said;
  if (!title) return fallback;
  return title.length > GENERATED_TITLE_LIMIT
    ? `${title.slice(0, GENERATED_TITLE_LIMIT - 1).trimEnd()}…`
    : title;
}
