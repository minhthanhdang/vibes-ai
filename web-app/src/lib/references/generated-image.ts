/// What the executor has to work out about a picture the image model just drew,
/// off the bytes and the words it was asked for: how big it came out, and what
/// to call it in a gallery of filenames — and, afterwards, how the words it was
/// asked for are read back off the row.

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

/// The text cut to the room it has, marked as cut. The base is what gives way,
/// never the suffix — a name that no longer says which of them it is is the
/// thing this whole function exists to avoid, which is `croppedReferenceTitle`'s
/// rule and a copied board's.
const fitted = (text: string, room: number) =>
  text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text;

/// A gallery needs a name and the model was handed a paragraph. The first clause
/// of a description is what the user asked for — "a warm grey paper texture, lit
/// flat, no grain" — and everything after it is how to draw it, so the title is
/// the opening rather than the first sixty characters of the whole thing.
///
/// `taken` is what the project already calls its pictures, and a name that
/// collides with one of them is numbered rather than repeated. Two descriptions
/// only have to *begin* alike to arrive here identical — "a warm grey paper
/// texture, but bluer" opens on the same clause as the picture it is asking to
/// improve on — so this is the common case rather than the redrawn-verbatim
/// one. An uploaded photograph may share its neighbour's name and nothing here
/// touches it: the user typed that one, and this is a name the product made up,
/// which makes it the product's job to keep it distinguishable.
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
  /// One more attempt than there are names to collide with, which is one more
  /// than can be exhausted: every suffix makes a different string.
  for (let n = 1; n <= already.size + 1; n += 1) {
    const suffix = n === 1 ? "" : ` (${n})`;
    candidate = `${fitted(base, GENERATED_TITLE_LIMIT - suffix.length)}${suffix}`;
    if (!already.has(candidate)) return candidate;
  }
  return candidate;
}

/// What a picture was drawn from, as a panel says it — or nothing, which is
/// every reference nobody drew.
///
/// Trimmed rather than passed through: a blank column is a row with no prompt
/// on it and not a prompt that says nothing, so a surface reading it must not
/// open a quotation mark on it. It is read wherever a picture's properties are
/// shown, because the description is true of the row the moment the tool files
/// it and the analysis it stands above may be minutes behind.
export function drawnFromSaid(reference: { generationPrompt?: string | null } | null | undefined) {
  return reference?.generationPrompt?.trim() || null;
}
