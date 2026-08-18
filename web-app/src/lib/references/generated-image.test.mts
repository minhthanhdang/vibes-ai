import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GENERATED_TITLE_LIMIT,
  generatedImageTitle,
  pngPixelSize,
} from "./generated-image";

/// A PNG as far as anything here reads one: the signature, the IHDR length and
/// name, and the two dimensions.
function png(width: number, height: number, over: Partial<{ name: string; signature: number[] }> = {}) {
  const header = Buffer.alloc(24);
  Buffer.from(over.signature ?? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write(over.name ?? "IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return new Uint8Array(header);
}

test("the size comes off the IHDR header", () => {
  assert.deepEqual(pngPixelSize(png(1376, 768)), { width: 1376, height: 768 });
  assert.deepEqual(pngPixelSize(png(1024, 1024)), { width: 1024, height: 1024 });
});

/// The top bit of a four-byte width is a sign bit to a shift, and a picture
/// three billion pixels wide would come back negative without the unsigned read.
test("a width past 2^31 is read unsigned", () => {
  assert.deepEqual(pngPixelSize(png(0x80000001, 4)), { width: 0x80000001, height: 4 });
});

/// Bytes that are not a PNG's are answered with no size rather than with a
/// number read off whatever they are — a row with no width is a row the rest of
/// the product already knows how to hold.
test("anything that is not a PNG has no size", () => {
  assert.equal(pngPixelSize(new Uint8Array(0)), null);
  assert.equal(pngPixelSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), null);
  assert.equal(pngPixelSize(png(10, 10, { signature: [0, 1, 2, 3, 4, 5, 6, 7] })), null);
  assert.equal(pngPixelSize(png(10, 10, { name: "iTXt" })), null);
  assert.equal(pngPixelSize(png(0, 800)), null);
});

test("the title is the opening clause of the description", () => {
  assert.equal(
    generatedImageTitle("A warm grey paper texture, lit flat, no grain, filling the frame"),
    "A warm grey paper texture",
  );
  assert.equal(generatedImageTitle("Dusk gradient over water. Shot on 35mm."), "Dusk gradient over water.");
});

test("a description with no clause break is cut to the ceiling", () => {
  const said = "a".repeat(GENERATED_TITLE_LIMIT + 20);
  const title = generatedImageTitle(said);
  assert.equal(title.length, GENERATED_TITLE_LIMIT);
  assert.match(title, /…$/);
});

test("a description with nothing in it falls back", () => {
  assert.equal(generatedImageTitle("   \n  "), "Generated picture");
  assert.equal(generatedImageTitle("", [], "Made picture"), "Made picture");
});

/// Two descriptions only have to open alike to arrive here as one name, which
/// "the same thing but bluer" does every time it is asked for.
test("a name the project already uses is numbered rather than repeated", () => {
  const first = generatedImageTitle("A warm grey paper texture, lit flat");
  assert.equal(first, "A warm grey paper texture");
  assert.equal(
    generatedImageTitle("A warm grey paper texture, but bluer", [first]),
    "A warm grey paper texture (2)",
  );
  assert.equal(
    generatedImageTitle("A warm grey paper texture, bluer still", [
      first,
      "A warm grey paper texture (2)",
    ]),
    "A warm grey paper texture (3)",
  );
});

/// The names it is kept clear of are whatever the gallery holds — a photograph
/// the user uploaded under that name counts, because the collision the user
/// sees is between two tiles rather than between two tools.
test("a name nothing else uses is left exactly as it was", () => {
  assert.equal(
    generatedImageTitle("A dusk gradient over water", ["Hall interior", "A warm grey paper"]),
    "A dusk gradient over water",
  );
  /// Whitespace either side of a stored title is not a different name.
  assert.equal(
    generatedImageTitle("A dusk gradient over water", ["  A dusk gradient over water  "]),
    "A dusk gradient over water (2)",
  );
});

/// The suffix is what has to survive: a numbered name cut back to the same
/// sixty characters as the one it collides with is the collision again.
test("the description gives way to the number, not the other way round", () => {
  const said = "a".repeat(GENERATED_TITLE_LIMIT + 20);
  const first = generatedImageTitle(said);
  const second = generatedImageTitle(said, [first]);
  assert.equal(first.length, GENERATED_TITLE_LIMIT);
  assert.equal(second.length, GENERATED_TITLE_LIMIT);
  assert.notEqual(second, first);
  assert.match(second, /… \(2\)$/);
});

/// The fallback is a name like any other, so a second blank description does not
/// file a second "Generated picture".
test("even the fallback is kept clear of itself", () => {
  assert.equal(generatedImageTitle("  ", ["Generated picture"]), "Generated picture (2)");
});
