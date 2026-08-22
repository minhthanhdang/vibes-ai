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
/// A newline in the words is a break somebody meant, so each hard-broken run is
/// wrapped on its own and the break survives — excalidraw's own wrap does the
/// same, and a stanza flattened into a paragraph is the one edit here nobody
/// asked for. `putObjects` normalises its whitespace before this sees it, so
/// the put's breaks are all made here either way.
export function wrapToWidth(text: string, width: number, fontSize: number): string[] {
  return text
    .split("\n")
    .flatMap((paragraph) => wrapRun(paragraph, width, fontSize));
}

function wrapRun(text: string, width: number, fontSize: number): string[] {
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

/// Whether the box is what breaks the lines.
///
/// Excalidraw wraps a text element to its own width only when the block is
/// pinned (`autoResize: false`); a block left to size itself grows sideways
/// around the breaks somebody typed. Every text this app writes is pinned — the
/// compose, the dropped line and the put all say so out loud — so this is what
/// separates a block whose width is a decision from one whose width is a
/// measurement of the string it already carries. A door that re-breaks the
/// second one is re-breaking it to a width nobody chose.
export function setsToItsBox(element: {
  autoResize?: unknown;
  width?: unknown;
  [key: string]: unknown;
}): boolean {
  return (
    element.autoResize === false &&
    typeof element.width === "number" &&
    Number.isFinite(element.width) &&
    element.width > 0
  );
}

/// What was typed, which is what a re-wrap starts from: `originalText` when the
/// element carries one, and otherwise the drawn string — an element written
/// before this file existed has to re-wrap from its words rather than from
/// where somebody else's width happened to break them.
///
/// Spaces collapse and newlines do not. A break somebody typed is a break they
/// meant and `wrapToWidth` keeps it; the soft breaks a width put in are the
/// ones being taken out, and they are only ever in `text`.
export function typedWords(element: {
  originalText?: unknown;
  text?: unknown;
  [key: string]: unknown;
}): string {
  const typed = typeof element.originalText === "string" ? element.originalText : "";
  const drawn = typeof element.text === "string" ? element.text : "";
  return (typed || drawn).replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

/// How many lines the block is drawn on now, which is what it is still drawn on
/// after a size change it did not re-break for.
export function drawnLines(element: { text?: unknown; [key: string]: unknown }): number {
  const drawn = typeof element.text === "string" ? element.text : "";
  return Math.max(1, drawn.split("\n").filter((line) => line.trim()).length);
}

/// How tall a block of `lines` stands at a type size. `TEXT_LINE_HEIGHT` is the
/// multiple every text door in this codebase already keeps between a line's
/// type and its box, and this is the one place it is multiplied out.
export function blockHeight(lines: number, fontSize: number): number {
  return Math.round(Math.max(1, lines) * fontSize * TEXT_LINE_HEIGHT);
}

/// The words as they are stored on a text element: the breaks in `text`, and
/// the height the block came to.
///
/// One answer, because three doors settle it and they have to settle it the
/// same way — `put_on_canvas` writes a new block, `restyle_on_canvas` changes
/// the size a stored one is set at, `reword_on_board` changes the words a
/// stored one carries, and a page whose paragraph reads as four lines to the
/// picture and one line to the read is worse than any of them. The put writes
/// the pin itself; the other two ask `setsToItsBox` first, because neither of
/// them owns a block that sizes itself.
export function setBlock(
  words: string,
  width: number,
  fontSize: number,
): { text: string; lines: number; height: number } {
  const lines = wrapToWidth(words, width, fontSize);
  return {
    text: lines.join("\n"),
    lines: lines.length,
    height: blockHeight(lines.length, fontSize),
  };
}
