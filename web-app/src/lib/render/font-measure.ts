/// Reading a plain-sfnt face (a TTF): what its family is called, which glyphs
/// it really carries, and how wide its classes set.
///
/// Three readers share it and none of them may disagree: the mirror script
/// checks the classic faces it decompresses are the faces `render-plan.ts`
/// claims they are, the Google Fonts service (`google-fonts.ts`) measures a
/// downloaded face into the `SetMetric` every wrap decision runs on, and the
/// rasteriser's specimen tests assert a rendered line matches the measurement.
///
/// Plain sfnt only, deliberately. The container this codebase downloads and
/// mirrors is `.woff2`, and everything here runs *after* `wawoff2.decompress`
/// has undone both the brotli and the table transforms — so `hmtx` is always a
/// four-byte stride and `glyf` is real outlines, and none of WOFF2's
/// index-coded directory reading (`scripts/font-set.mts`) is repeated.
///
/// No canvas, no React, no DOM, no filesystem: bytes in, facts out.

import { classOf, type SetMetric } from "@/lib/render/font-set";

function u16(font: Uint8Array, at: number): number {
  return (font[at]! << 8) | font[at + 1]!;
}

function u32(font: Uint8Array, at: number): number {
  return ((font[at]! << 24) | (font[at + 1]! << 16) | (font[at + 2]! << 8) | font[at + 3]!) >>> 0;
}

function i16(font: Uint8Array, at: number): number {
  const value = u16(font, at);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function tag(font: Uint8Array, at: number): string {
  return String.fromCharCode(font[at]!, font[at + 1]!, font[at + 2]!, font[at + 3]!);
}

/// The table directory of one face. TrueType outlines are 0x00010000 and CFF is
/// `OTTO`; either way the directory reads the same.
export function sfntTables(font: Uint8Array): Map<string, Uint8Array> {
  const version = u32(font, 0);
  if (version !== 0x00010000 && tag(font, 0) !== "OTTO" && tag(font, 0) !== "true") {
    throw new Error("not a plain sfnt — decompress the container first");
  }
  const count = u16(font, 4);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const offset = u32(font, record + 8);
    const length = u32(font, record + 12);
    tables.set(tag(font, record), font.subarray(offset, Math.min(offset + length, font.length)));
  }
  return tables;
}

/// Unicode to glyph index, formats 4 and 12 — the two a web font ships. Zero
/// for a character the face has no glyph for, which format 4 says three ways
/// (a missing segment, a zero through the range array, or the 0xffff sentinel).
export function glyphIndex(cmap: Uint8Array, code: number): number {
  const subtables = u16(cmap, 2);
  let chosen: { at: number; format: number } | null = null;
  for (let i = 0; i < subtables; i++) {
    const at = u32(cmap, 4 + i * 8 + 4);
    const format = u16(cmap, at);
    const rank = format === 12 ? 3 : format === 4 ? 2 : 1;
    const held = chosen ? (chosen.format === 12 ? 3 : chosen.format === 4 ? 2 : 1) : 0;
    if (rank > held) chosen = { at, format };
  }
  if (!chosen) return 0;
  const { at, format } = chosen;

  if (format === 12) {
    const groups = u32(cmap, at + 12);
    for (let i = 0; i < groups; i++) {
      const group = at + 16 + i * 12;
      const start = u32(cmap, group);
      const end = u32(cmap, group + 4);
      if (start <= code && code <= end) return u32(cmap, group + 8) + (code - start);
    }
    return 0;
  }
  if (format !== 4) return 0;

  const segments = u16(cmap, at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  for (let s = 0; s < segments; s++) {
    const end = u16(cmap, ends + s * 2);
    const start = u16(cmap, starts + s * 2);
    if (!(start <= code && code <= end) || start === 0xffff) continue;
    const delta = i16(cmap, deltas + s * 2);
    const range = u16(cmap, ranges + s * 2);
    if (range === 0) return (code + delta) & 0xffff;
    const index = ranges + s * 2 + range + (code - start) * 2;
    if (index + 1 >= cmap.length) return 0;
    const glyph = u16(cmap, index);
    return glyph ? (glyph + delta) & 0xffff : 0;
  }
  return 0;
}

/// Whether this face really sets Latin text — `A` and `z` both map to a glyph
/// that exists. Both ends of the alphabet, because the unicode-range subsets a
/// web font is split into lie one way each: a symbols subset maps `A` to a
/// spare glyph and carries no lowercase, and a coverage check that asked only
/// one letter shipped four Excalifont subsets that draw nothing (the mirror's
/// probe, 2026-08-29). A face chosen by family that cannot draw the line makes
/// resvg fall back per glyph to *any* loaded face, which is the silent
/// wrong-face picture this whole file exists to prevent.
export function setsLatin(font: Uint8Array): boolean {
  const cmap = sfntTables(font).get("cmap");
  if (!cmap) return false;
  return glyphIndex(cmap, 0x41) !== 0 && glyphIndex(cmap, 0x7a) !== 0;
}

/// The family this face answers to — nameID 16 (typographic family) over
/// nameID 1, which is the preference fontdb resolves `font-family` with. The
/// two differ on real files: excalidraw's Nunito is "Nunito ExtraLight" by 16
/// and "Nunito ExtraLight Medium" by 1, and only the first matches.
export function familyName(font: Uint8Array): string | null {
  const name = sfntTables(font).get("name");
  if (!name) return null;
  const count = u16(name, 2);
  const strings = u16(name, 4);
  let family: string | null = null;
  let typographic: string | null = null;
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    const platform = u16(name, record);
    const nameId = u16(name, record + 6);
    if (nameId !== 1 && nameId !== 16) continue;
    const length = u16(name, record + 8);
    const offset = strings + u16(name, record + 10);
    let value = "";
    if (platform === 1) {
      for (let j = 0; j < length; j++) value += String.fromCharCode(name[offset + j]!);
    } else {
      for (let j = 0; j + 1 < length; j += 2) value += String.fromCharCode(u16(name, offset + j));
    }
    if (!value) continue;
    if (nameId === 16) typographic ??= value;
    else family ??= value;
  }
  return typographic ?? family;
}

/// The same alphabet the drift-check script samples (`scripts/font-set.mts`),
/// and for its reason: `other` is the lowercase bucket that symbols fall into,
/// and letting `$` and `~` vote in it would move the number that decides where
/// English prose breaks.
const SAMPLED = " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;'!()[]/-";

/// How wide this face's classes set, as shares of the em — the `SetMetric`
/// every wrap and every ink measurement runs on (`text-set.ts`).
export function measureSet(font: Uint8Array): SetMetric {
  const tables = sfntTables(font);
  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const cmap = tables.get("cmap");
  if (!head || !hhea || !hmtx || !cmap) throw new Error("the face is missing a metrics table");

  const em = u16(head, 18);
  const metrics = u16(hhea, 34);
  /// Plain hmtx: advance and bearing interleaved, and every glyph past
  /// `numberOfHMetrics` repeats the last advance.
  const advanceOf = (glyph: number) => u16(hmtx, Math.min(glyph, metrics - 1) * 4) / em;

  const sums = new Map<keyof SetMetric, { total: number; count: number }>();
  for (const char of SAMPLED) {
    const glyph = glyphIndex(cmap, char.codePointAt(0)!);
    if (glyph === 0 && char !== " ") continue;
    const group = classOf(char);
    const at = sums.get(group) ?? { total: 0, count: 0 };
    at.total += advanceOf(glyph);
    at.count += 1;
    sums.set(group, at);
  }
  const read = (group: keyof SetMetric) => {
    const at = sums.get(group);
    if (!at || at.count === 0) throw new Error(`the face carries no ${group} glyph`);
    return Math.round((at.total / at.count) * 1000) / 1000;
  };
  return {
    space: read("space"),
    narrow: read("narrow"),
    wide: read("wide"),
    upper: read("upper"),
    digit: read("digit"),
    other: read("other"),
  };
}
