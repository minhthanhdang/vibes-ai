/// How a string *sets*: how wide it draws at a type size, and where it breaks
/// when it is handed a width to sit inside.
///
/// No font is open on this side — the mirrored faces are `.woff2`, which
/// neither fontconfig nor librsvg will read (`render-plan.ts`, `textOverflow`)
/// — so this is arithmetic over character classes rather than a measurement.
/// The numbers are Helvetica's own advance widths averaged per class, which is
/// what Liberation is drawn to and what families 2 and 9 both are; a hand face
/// sets a little wider and a monospace a little narrower, and neither moves a
/// line by a word.
///
/// It is a second number about the same thing as `TEXT_ADVANCE` and
/// deliberately not that one. `TEXT_ADVANCE` is 0.75 flat because it decides
/// how much transparent room a picture leaves around a line that already
/// overflows: over by a third costs nothing, under by one character cuts a word
/// in half. This decides where a line *breaks*, where the error runs the other
/// way — over by a hair breaks a headline that would have fitted, which is a
/// page the designer then spends a round undoing. So one over-estimates on
/// purpose and this one is calibrated, and they are not interchangeable.
///
/// No canvas, no React, no DOM.

import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";

/// The glyphs that set well under half an em, and the ones that set well over.
/// Helvetica: `i` and `l` are .222, `f`, `t` and a full stop .278; `m` is .833,
/// `M` .833, `W` .944.
const NARROW = /[iljt.,:;'`!|()[\]/\\-]/;
const WIDE = /[mwMW@%]/;

/// How wide one character sets, as a share of the type size. The classes are
/// Helvetica's means: lowercase .49, uppercase .68, digits .556, space .278.
function advance(char: string): number {
  if (char === " ") return 0.28;
  if (NARROW.test(char)) return 0.3;
  if (WIDE.test(char)) return 0.86;
  if (char >= "A" && char <= "Z") return 0.68;
  if (char >= "0" && char <= "9") return 0.56;
  return 0.5;
}

/// How wide a line of type draws, in the same units its font size is in.
export function setWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const char of text) em += advance(char);
  return em * fontSize;
}

/// The same words broken to fit a width — one line per array entry, greedy from
/// the left, the way every text engine breaks a paragraph and the way
/// excalidraw will break this one the moment somebody double-clicks it.
///
/// A word wider than the whole box is left whole on its own line rather than
/// cut: a URL or a long name broken mid-word reads as a page to be fixed, and
/// the caller is told the block did not fit either way.
///
/// The text is taken as one paragraph — `putObjects` normalises its whitespace
/// before this sees it — so the only breaks in the answer are the ones made
/// here.
export function wrapToWidth(text: string, width: number, fontSize: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (!(width > 0) || !(fontSize > 0)) return [words.join(" ")];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const joined = line ? `${line} ${word}` : word;
    if (line && setWidth(joined, fontSize) > width) {
      lines.push(line);
      line = word;
      continue;
    }
    line = joined;
  }
  if (line) lines.push(line);
  return lines;
}

/// The words as they are stored on a text element: the breaks in `text`, and
/// the height the block came to.
///
/// One answer, because three doors settle it and they have to settle it the
/// same way — `put_on_canvas` writes a new block, `restyle_on_canvas` changes
/// the size a stored one is set at, and a page whose paragraph reads as four
/// lines to the picture and one line to the read is worse than either.
/// `TEXT_LINE_HEIGHT` is the multiple both text doors already keep between a
/// line's type and its box.
export function setBlock(
  words: string,
  width: number,
  fontSize: number,
): { text: string; lines: number; height: number } {
  const lines = wrapToWidth(words, width, fontSize);
  return {
    text: lines.join("\n"),
    lines: lines.length,
    height: Math.round(Math.max(1, lines.length) * fontSize * TEXT_LINE_HEIGHT),
  };
}
