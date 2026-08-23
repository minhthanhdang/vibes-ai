/// How wide each face draws, class by class — the measurement `text-set.ts`
/// breaks lines on.
///
/// A leaf on purpose, importing nothing. `render-plan.ts` reads these tables at
/// module scope to build its font lookup, and it sits downstream of
/// `text-set.ts` through `board-contents` — so leaving them where they were
/// read as a constant before it was initialised the first time anything
/// imported the two in that order. A file with no imports of its own cannot be
/// half-built when somebody asks it for a number.
///
/// The numbers are read out of the mirrored `.woff2` by `npm run fonts:set`,
/// which reports any row here that has drifted from the face it claims to
/// measure. Why they are per-face at all, and what the single Helvetica table
/// before them cost, is in `text-set.ts`.
///
/// No canvas, no React, no DOM.

/// The glyphs that set well under half an em, and the ones that set well over.
/// Helvetica: `i` and `l` are .222, `f`, `t` and a full stop .278; `m` is .833,
/// `M` .833, `W` .944. The classes are the face-independent half — which glyphs
/// group together is a fact about the alphabet, and what the group is worth is
/// a fact about the face.
const NARROW = /[iljt.,:;'`!|()[\]/\\-]/;
const WIDE = /[mwMW@%]/;

/// What one face's classes are worth, as shares of the type size.
///
/// Six numbers rather than a glyph table because the error that matters is a
/// line's, not a letter's: a wrap breaks on a running total, and over the corpus
/// in `fonts:set` these classes hold every face inside an eighth of the real
/// set width, where the single Helvetica table was out by a fifth on the face
/// everything defaults to and by a third on the monospace.
export type SetMetric = {
  space: number;
  narrow: number;
  wide: number;
  upper: number;
  digit: number;
  other: number;
};

/// Excalidraw's own default face, and so this file's: a text element written
/// with no `fontFamily` — which is every line `put_on_canvas` lays down with no
/// `font` asked — is drawn in Excalifont, not in the Helvetica the estimate used
/// to assume (`DEFAULT_RENDER_FONT`, `render-plan.ts`).
export const SET_EXCALIFONT: SetMetric = {
  space: 0.4,
  narrow: 0.36,
  wide: 0.727,
  upper: 0.678,
  digit: 0.606,
  other: 0.543,
};

/// Helvetica's own, which is what Liberation is drawn to and what families 2
/// and 9 both are — the row the single table was, measured rather than quoted
/// from a specimen, which moves nothing by more than a hundredth of an em.
export const SET_LIBERATION: SetMetric = {
  space: 0.278,
  narrow: 0.272,
  wide: 0.833,
  upper: 0.66,
  digit: 0.556,
  other: 0.511,
};

/// A monospace has one advance and the classes collapse onto it, which is the
/// only face here the six numbers describe exactly.
export const SET_CASCADIA: SetMetric = {
  space: 0.586,
  narrow: 0.586,
  wide: 0.586,
  upper: 0.586,
  digit: 0.586,
  other: 0.586,
};

export const SET_COMICSHANNS: SetMetric = {
  space: 0.55,
  narrow: 0.55,
  wide: 0.55,
  upper: 0.55,
  digit: 0.55,
  other: 0.55,
};

export const SET_NUNITO: SetMetric = {
  space: 0.261,
  narrow: 0.284,
  wide: 0.917,
  upper: 0.639,
  digit: 0.6,
  other: 0.523,
};

/// A display face, and the one that sets *narrower* than the estimate — its
/// word spacing is a fifth of an em where Helvetica's is over a quarter.
export const SET_LILITA: SetMetric = {
  space: 0.188,
  narrow: 0.349,
  wide: 0.85,
  upper: 0.583,
  digit: 0.543,
  other: 0.501,
};

export const SET_VIRGIL: SetMetric = {
  space: 0.5,
  narrow: 0.351,
  wide: 0.689,
  upper: 0.656,
  digit: 0.616,
  other: 0.524,
};

/// Which face a caller that has no element to ask about sets in — the same
/// default the renderer takes, so a width measured with nothing said and a
/// width measured off the scene are the same width.
export const DEFAULT_SET = SET_EXCALIFONT;

/// How wide one character sets in a face, as a share of the type size.
export function advance(char: string, metric: SetMetric): number {
  if (char === " ") return metric.space;
  if (NARROW.test(char)) return metric.narrow;
  if (WIDE.test(char)) return metric.wide;
  if (char >= "A" && char <= "Z") return metric.upper;
  if (char >= "0" && char <= "9") return metric.digit;
  return metric.other;
}
