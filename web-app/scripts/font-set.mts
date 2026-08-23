/// What the mirrored faces actually measure, against what `text-set.ts` says
/// they do. `npm run fonts:set`.
///
/// `text-set.ts` breaks every line this app writes, and it breaks them on a
/// table of six numbers per face. Those numbers are a measurement, and a
/// measurement nobody can re-take is a constant somebody guessed: for five
/// iterations the table was one row of Helvetica's widths used for all seven
/// faces, on the written argument that the difference between a hand face and a
/// sans "does not move a line by a word". It moves it by a fifth of a line on
/// the face excalidraw defaults to.
///
/// So this opens the `.woff2` the mirror ships, reads the advance widths out of
/// `hmtx` through `cmap`, averages them into the same six classes `text-set.ts`
/// groups by, and reports any row that has drifted. A version bump that redraws
/// a face is the case it exists for — the mirror rebuilds silently
/// (`mirror-excalidraw-assets.mts`), and nothing else in the checkout would
/// notice the widths had changed.
///
/// It is a script rather than a test case because the mirror is generated and
/// gitignored, so a suite that read it would fail on a fresh clone before
/// `npm install` has run.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

import {
  SET_CASCADIA,
  SET_COMICSHANNS,
  SET_EXCALIFONT,
  SET_LIBERATION,
  SET_LILITA,
  SET_NUNITO,
  SET_VIRGIL,
  type SetMetric,
} from "../src/lib/render/font-set";

const FACES: Record<string, SetMetric> = {
  Excalifont: SET_EXCALIFONT,
  Liberation: SET_LIBERATION,
  Cascadia: SET_CASCADIA,
  Nunito: SET_NUNITO,
  Lilita: SET_LILITA,
  Virgil: SET_VIRGIL,
  ComicShanns: SET_COMICSHANNS,
};

/// The same two classes `text-set.ts` groups by, repeated here rather than
/// exported from it: this half is the measuring stick and that half is the
/// thing being measured, and a check that imports its own answer checks
/// nothing.
const NARROW = /[iljt.,:;'`!|()[\]/\\-]/;
const WIDE = /[mwMW@%]/;

/// WOFF2's table directory names the common tables by index instead of by tag
/// (the format's whole compression trick beyond brotli), so the order of this
/// list is the format's, not ours.
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

function base128(buf: Buffer, at: number): [number, number] {
  let value = 0;
  let pos = at;
  for (let i = 0; i < 5; i++) {
    const byte = buf[pos++]!;
    value = ((value << 7) | (byte & 0x7f)) >>> 0;
    if (!(byte & 0x80)) return [value, pos];
  }
  throw new Error("a length field ran past five bytes");
}

/// The tables of one `.woff2`, uncompressed. `glyf` and `loca` are transformed
/// when their version is 0 and every other table when it is not — the one place
/// the flag reads backwards, and the reason the whole directory is walked rather
/// than the tables sought by tag.
function woff2Tables(path: string) {
  const buf = readFileSync(path);
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${path} is not a woff2`);
  const count = buf.readUInt16BE(12);
  const dir: { tag: string; length: number; transformed: boolean }[] = [];
  let pos = 48;
  for (let i = 0; i < count; i++) {
    const flags = buf[pos++]!;
    const index = flags & 0x3f;
    let tag: string;
    if (index === 63) {
      tag = buf.toString("latin1", pos, pos + 4);
      pos += 4;
    } else tag = KNOWN_TAGS[index]!;
    let length: number;
    [length, pos] = base128(buf, pos);
    const transformed = tag === "glyf" || tag === "loca" ? (flags >> 6 & 3) === 0 : (flags >> 6 & 3) !== 0;
    if (transformed) [length, pos] = base128(buf, pos);
    dir.push({ tag, length, transformed });
  }

  const data = brotliDecompressSync(buf.subarray(pos));
  const tables = new Map<string, { bytes: Buffer; transformed: boolean }>();
  let offset = 0;
  for (const { tag, length, transformed } of dir) {
    tables.set(tag, { bytes: data.subarray(offset, offset + length), transformed });
    offset += length;
  }
  return tables;
}

/// Unicode to glyph, formats 4 and 12 — the two a web font ships. Everything
/// this measures is ASCII, so the subtable with the widest coverage wins and
/// the rest are not read.
function characterMap(bytes: Buffer): Map<number, number> {
  const map = new Map<number, number>();
  let chosen: { at: number; format: number } | null = null;
  for (let i = 0; i < bytes.readUInt16BE(2); i++) {
    const record = 4 + i * 8;
    const at = bytes.readUInt32BE(record + 4);
    const format = bytes.readUInt16BE(at);
    const rank = format === 12 ? 3 : format === 4 ? 2 : 1;
    if (!chosen || rank > (chosen.format === 12 ? 3 : chosen.format === 4 ? 2 : 1)) {
      chosen = { at, format };
    }
  }
  if (!chosen) throw new Error("no cmap subtable");
  const { at, format } = chosen;

  if (format === 12) {
    const groups = bytes.readUInt32BE(at + 12);
    for (let i = 0; i < groups; i++) {
      const group = at + 16 + i * 12;
      const start = bytes.readUInt32BE(group);
      const end = bytes.readUInt32BE(group + 4);
      const glyph = bytes.readUInt32BE(group + 8);
      for (let code = start; code <= end; code++) map.set(code, glyph + (code - start));
    }
    return map;
  }
  if (format !== 4) throw new Error(`cmap format ${format} is not read here`);

  const segments = bytes.readUInt16BE(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  for (let s = 0; s < segments; s++) {
    const end = bytes.readUInt16BE(ends + s * 2);
    const start = bytes.readUInt16BE(starts + s * 2);
    const delta = bytes.readInt16BE(deltas + s * 2);
    const range = bytes.readUInt16BE(ranges + s * 2);
    if (start === 0xffff) continue;
    for (let code = start; code <= end; code++) {
      let glyph: number;
      if (range === 0) glyph = (code + delta) & 0xffff;
      else {
        const index = ranges + s * 2 + range + (code - start) * 2;
        if (index + 1 >= bytes.length) continue;
        glyph = bytes.readUInt16BE(index);
        if (glyph) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph) map.set(code, glyph);
    }
  }
  return map;
}

/// How wide each character draws, as a share of the em.
///
/// `hmtx` is a pair per glyph — advance then left side bearing — unless WOFF2
/// transformed it, in which case the bearings are dropped and the advances run
/// contiguously after one flag byte. Reading the untransformed table at the
/// transformed stride is the mistake that reads every other glyph's bearing as
/// a width, and the numbers it gives are plausible enough to keep.
function faceAdvances(path: string): Map<string, number> {
  const tables = woff2Tables(path);
  const head = tables.get("head")!;
  const hhea = tables.get("hhea")!;
  const hmtx = tables.get("hmtx")!;
  const em = head.bytes.readUInt16BE(18);
  const metrics = hhea.bytes.readUInt16BE(34);
  const from = hmtx.transformed ? 1 : 0;
  const stride = hmtx.transformed ? 2 : 4;
  const advances: number[] = [];
  for (let i = 0; i < metrics; i++) advances.push(hmtx.bytes.readUInt16BE(from + i * stride) / em);

  const cmap = characterMap(tables.get("cmap")!.bytes);
  const widths = new Map<string, number>();
  for (const [code, glyph] of cmap) {
    if (code < 0x20 || code > 0x7e) continue;
    widths.set(String.fromCodePoint(code), advances[Math.min(glyph, metrics - 1)]!);
  }
  return widths;
}

/// One face is many files: excalidraw splits each into unicode-range subsets, so
/// the Latin glyphs are in whichever of them happens to carry them.
function faceWidths(dir: string): Map<string, number> {
  const merged = new Map<string, number>();
  for (const file of readdirSync(dir)) {
    for (const [char, width] of faceAdvances(join(dir, file))) {
      if (!merged.has(char)) merged.set(char, width);
    }
  }
  return merged;
}

function classOf(char: string): keyof SetMetric {
  if (char === " ") return "space";
  if (NARROW.test(char)) return "narrow";
  if (WIDE.test(char)) return "wide";
  if (char >= "A" && char <= "Z") return "upper";
  if (char >= "0" && char <= "9") return "digit";
  return "other";
}

/// The classes are averaged over the alphabet rather than over every printable
/// character: `other` is the lowercase bucket that symbols fall into, and
/// letting `$` and `~` vote in it would move the number that decides where
/// English prose breaks.
const SAMPLED = " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;'!()[]/-";

function measure(widths: Map<string, number>): SetMetric {
  const sums = new Map<keyof SetMetric, { total: number; count: number }>();
  for (const char of SAMPLED) {
    const width = widths.get(char);
    if (width === undefined) continue;
    const group = classOf(char);
    const at = sums.get(group) ?? { total: 0, count: 0 };
    at.total += width;
    at.count += 1;
    sums.set(group, at);
  }
  const read = (group: keyof SetMetric) => {
    const at = sums.get(group);
    if (!at) throw new Error(`the face carries no ${group} glyph`);
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

/// Lines a page would actually carry, because the number worth reporting is a
/// line's error rather than a letter's: a wrap breaks on a running total, and
/// the classes are only as good as the sentences they are asked about.
const CORPUS = [
  "AMARA & INES",
  "A Quiet Table",
  "Warm linen, soft clay, and the light of a slow morning.",
  "Every piece is made by hand in small batches.",
  "SPRING 2026",
  "Notes on colour, texture and the space between things.",
  "The quick brown fox jumps over the lazy dog",
  "Studio hours: Tuesday to Saturday, 10 until 6",
  "01 / 06",
  "HOME",
  "Made by hand, in a room with one window.",
];

const HELVETICA: SetMetric = {
  space: 0.28,
  narrow: 0.3,
  wide: 0.86,
  upper: 0.68,
  digit: 0.56,
  other: 0.5,
};

const modelled = (line: string, metric: SetMetric) =>
  [...line].reduce((em, char) => em + metric[classOf(char)], 0);

const drawn = (line: string, widths: Map<string, number>) =>
  [...line].reduce((em, char) => em + (widths.get(char) ?? 0.5), 0);

const mirror = fileURLToPath(new URL("../public/excalidraw-assets/fonts", import.meta.url));

let dirs: string[];
try {
  dirs = readdirSync(mirror);
} catch {
  console.log(`no ${mirror} on this checkout — run npm run mirror:excalidraw first`);
  process.exit(0);
}

const GROUPS: (keyof SetMetric)[] = ["space", "narrow", "wide", "upper", "digit", "other"];
const drift: string[] = [];

for (const face of dirs) {
  const declared = FACES[face];
  if (!declared) {
    drift.push(`${face}: mirrored, and text-set.ts has no metric for it`);
    continue;
  }
  const widths = faceWidths(join(mirror, face));
  const measured = measure(widths);
  const off = GROUPS.filter((group) => Math.abs(measured[group] - declared[group]) > 0.0005);

  /// The worst line in the corpus either way round, which is the number the
  /// table exists to hold down: what the face draws over what the code thought
  /// it would.
  const errors = (metric: SetMetric) =>
    CORPUS.map((line) => drawn(line, widths) / modelled(line, metric));
  const span = (values: number[]) =>
    `${Math.min(...values).toFixed(2)}–${Math.max(...values).toFixed(2)}x`;

  console.log(
    `${face.padEnd(12)} ${GROUPS.map((group) => `${group} ${measured[group].toFixed(3)}`).join("  ")}`,
  );
  console.log(
    `${"".padEnd(12)} drawn/measured ${span(errors(measured))}   drawn/one-Helvetica-table ${span(errors(HELVETICA))}`,
  );
  if (off.length) {
    drift.push(
      `${face}: ${off.map((group) => `${group} ${declared[group]} declared, ${measured[group]} measured`).join(", ")}`,
    );
  }
}

for (const face of Object.keys(FACES)) {
  if (!dirs.includes(face)) drift.push(`${face}: a metric in text-set.ts, and the mirror has no such face`);
}

if (!drift.length) {
  console.log(`\nevery face agrees with text-set.ts, to a thousandth of an em`);
  process.exit(0);
}
console.log(`\n${drift.length} face(s) have drifted from text-set.ts:`);
for (const line of drift) console.log(`  ${line}`);
process.exit(1);
