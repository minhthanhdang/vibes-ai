export type Manifest = {
  name?: unknown;
  version?: unknown;
  license?: unknown;
  licenses?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
  repository?: unknown;
  homepage?: unknown;
  author?: unknown;
};

export type PackageRead = {
  manifest: Manifest;
  licenceFileName: string | null;
  licenceText: string | null;
  noticeText: string | null;
};

export type LicenceSource = "file" | "field" | "licenses" | "none";

export type Licence = {
  spdx: string;
  from: LicenceSource;
};

export type PackageEntry = {
  name: string;
  version: string;
  licence: string;
  declared: string;
  resolvedFrom: LicenceSource;
  licenceFileName: string | null;
  licenceText: string | null;
  noticeText: string | null;
  homepage: string | null;
  author: string | null;
  sourceUrl: string | null;
};

export type FontEntry = {
  family: string;
  licence: string;
  licenceText: string;
  note: string | null;
  servedFrom: string;
};

export type LicenceGroup = {
  licence: string;
  entries: PackageEntry[];
};

export type NoticeDocument = {
  product: string;
  generatedAt: string;
  packageCount: number;
  groups: LicenceGroup[];
  fonts: FontEntry[];
};

export const UNRESOLVED = "UNRESOLVED";

export const LICENCE_FILE_NAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "license",
  "license.md",
  "license.txt",
  "licence",
  "LICENSE-MIT",
  "LICENSE-APACHE",
  "COPYING",
  "COPYING.txt",
];

export const NOTICE_FILE_NAMES = ["NOTICE", "NOTICE.txt", "NOTICE.md"];

const RECIPROCAL = ["MPL-2.0", "GPL-2.0", "GPL-3.0", "LGPL-2.0", "LGPL-2.1", "LGPL-3.0", "EPL-1.0", "EPL-2.0", "CDDL-1.0", "AGPL-3.0"];

const KNOWN_SPDX = [
  "0BSD",
  "AGPL-3.0",
  "Apache-2.0",
  "Artistic-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC0-1.0",
  "CDDL-1.0",
  "EPL-1.0",
  "EPL-2.0",
  "GPL-2.0",
  "GPL-3.0",
  "ISC",
  "LGPL-2.0",
  "LGPL-2.1",
  "LGPL-3.0",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "OFL-1.1",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
];

export function bareSpdx(spdx: string): string {
  return spdx.trim().replace(/\+$/, "").replace(/-(?:or-later|only)$/i, "");
}

function isKnownSpdx(spdx: string): boolean {
  const atoms = spdx
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND|WITH)\s+/i)
    .map((atom) => bareSpdx(atom))
    .filter(Boolean);
  return atoms.length > 0 && atoms.every((atom) => KNOWN_SPDX.includes(atom));
}

export function isReciprocal(spdx: string): boolean {
  return RECIPROCAL.includes(bareSpdx(spdx));
}

const ELECTION_PREFERENCE = [
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "Python-2.0",
  "CC-BY-4.0",
];

const TEXT_MARKERS: [string, RegExp][] = [
  ["Apache-2.0", /Apache License ?,? Version 2\.0/i],
  ["MPL-2.0", /Mozilla Public License(?: Version)? 2\.0/i],
  ["OFL-1.1", /SIL Open Font License,? Version 1\.1/i],
  ["Python-2.0", /PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2/i],
  ["GPL-3.0", /GNU GENERAL PUBLIC LICENSE Version 3/i],
  ["GPL-2.0", /GNU GENERAL PUBLIC LICENSE Version 2/i],
  ["LGPL-3.0", /GNU LESSER GENERAL PUBLIC LICENSE Version 3/i],
  ["Unlicense", /This is free and unencumbered software released into the public domain/i],
  ["CC0-1.0", /CC0 1\.0 Universal/i],
  ["CC-BY-4.0", /Creative Commons Attribution 4\.0 International/i],
  ["BSD-3-Clause", /Neither the name of .{0,80}?(?:nor|or) the names of its contributors may be used to endorse/i],
  ["0BSD", /Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted\. THE SOFTWARE/i],
  ["ISC", /Permission to use, copy, modify,? and\/?or distribute this software for any purpose with or without fee is hereby granted, provided that/i],
  ["MIT", /Permission is hereby granted, free of charge, to any person obtaining a copy/i],
  ["BSD-2-Clause", /Redistributions in binary form must reproduce the above copyright/i],
];

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, spec] of Object.entries(value as Record<string, unknown>)) {
    if (typeof spec === "string") out[key] = spec;
  }
  return out;
}

export type Dependency = {
  name: string;
  optional: boolean;
};

export type ProductionTree = {
  names: string[];
  missing: string[];
};

export function directDependencies(manifest: Manifest): Dependency[] {
  return [
    ...Object.keys(stringRecord(manifest.dependencies)).map((name) => ({ name, optional: false })),
    ...Object.keys(stringRecord(manifest.optionalDependencies)).map((name) => ({ name, optional: true })),
  ];
}

export async function productionTree(
  rootPkg: Manifest,
  readPkg: (name: string) => Promise<Manifest | null>,
): Promise<ProductionTree> {
  const optionalOnly = new Map<string, boolean>();
  const installed = new Set<string>();
  const absent = new Set<string>();
  let frontier = directDependencies(rootPkg);

  while (frontier.length > 0) {
    const wanted: string[] = [];
    for (const dependency of frontier) {
      const known = optionalOnly.get(dependency.name);
      if (known === undefined) wanted.push(dependency.name);
      optionalOnly.set(dependency.name, (known ?? true) && dependency.optional);
    }

    const manifests = await Promise.all(wanted.map((name) => readPkg(name)));
    frontier = [];
    for (const [index, manifest] of manifests.entries()) {
      const name = wanted[index]!;
      if (!manifest) {
        absent.add(name);
        continue;
      }
      installed.add(name);
      frontier.push(...directDependencies(manifest));
    }
  }

  return {
    names: [...installed].sort(),
    missing: [...absent].filter((name) => optionalOnly.get(name) === false).sort(),
  };
}

export function spdxOfText(text: string | null): string | null {
  if (!text) return null;
  const head = text.slice(0, 6000).replace(/\s+/g, " ");
  for (const [spdx, marker] of TEXT_MARKERS) {
    if (marker.test(head)) return spdx;
  }
  return null;
}

function spdxOfField(license: unknown): string | null {
  if (typeof license === "string" && license.trim()) return license.trim();
  if (license && typeof license === "object" && typeof (license as { type?: unknown }).type === "string") {
    return (license as { type: string }).type.trim() || null;
  }
  return null;
}

function spdxOfLegacyArray(licenses: unknown): string | null {
  if (!Array.isArray(licenses)) return null;
  const named = licenses.map(spdxOfField).filter((spdx): spdx is string => Boolean(spdx));
  if (named.length === 0) return null;
  return named.length === 1 ? named[0]! : `(${named.join(" OR ")})`;
}

export function licenceOf(pkg: PackageRead): Licence {
  const fromField = spdxOfField(pkg.manifest.license);
  if (fromField && isKnownSpdx(fromField)) return { spdx: fromField, from: "field" };

  const fromText = spdxOfText(pkg.licenceText);
  if (fromText) return { spdx: fromText, from: "file" };

  if (fromField) return { spdx: fromField, from: "field" };

  const fromArray = spdxOfLegacyArray(pkg.manifest.licenses);
  if (fromArray) return { spdx: fromArray, from: "licenses" };

  return { spdx: UNRESOLVED, from: pkg.licenceText ? "file" : "none" };
}

export function elect(spdx: string): string {
  const stripped = spdx.trim().replace(/^\(([\s\S]*)\)$/, "$1").trim();
  if (!/\bOR\b/.test(stripped)) return stripped;

  const options = stripped
    .split(/\s+OR\s+/)
    .map((option) => option.trim().replace(/^\(([\s\S]*)\)$/, "$1").trim())
    .filter(Boolean);
  if (options.length === 0) return stripped;

  const ranked = [...options].sort((a, b) => {
    const rank = (spdxId: string) => {
      const index = ELECTION_PREFERENCE.indexOf(bareSpdx(spdxId));
      return index === -1 ? ELECTION_PREFERENCE.length + (isReciprocal(spdxId) ? 1 : 0) : index;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  return ranked[0]!;
}

export function repositoryUrl(manifest: Manifest): string | null {
  const repository = manifest.repository;
  const raw =
    typeof repository === "string"
      ? repository
      : repository && typeof repository === "object" && typeof (repository as { url?: unknown }).url === "string"
        ? (repository as { url: string }).url
        : null;
  if (!raw) return null;

  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(raw);
  if (shorthand) return `https://github.com/${shorthand[1]}`;

  return raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "");
}

export function sourceOffer(entry: { licence: string; manifest: Manifest; homepage: string | null }): string | null {
  if (!isReciprocal(entry.licence)) return null;
  return repositoryUrl(entry.manifest) ?? entry.homepage;
}

export function authorName(author: unknown): string | null {
  if (typeof author === "string") return author.replace(/\s*<[^>]*>/g, "").replace(/\s*\([^)]*\)/g, "").trim() || null;
  if (author && typeof author === "object" && typeof (author as { name?: unknown }).name === "string") {
    return (author as { name: string }).name.trim() || null;
  }
  return null;
}

export function packageEntry(name: string, pkg: PackageRead): PackageEntry {
  const licence = licenceOf(pkg);
  const elected = elect(licence.spdx);
  const homepage = typeof pkg.manifest.homepage === "string" ? pkg.manifest.homepage : null;

  return {
    name,
    version: typeof pkg.manifest.version === "string" ? pkg.manifest.version : "",
    licence: elected,
    declared: licence.spdx,
    resolvedFrom: licence.from,
    licenceFileName: pkg.licenceFileName,
    licenceText: pkg.licenceText,
    noticeText: pkg.noticeText,
    homepage,
    author: authorName(pkg.manifest.author),
    sourceUrl: sourceOffer({ licence: elected, manifest: pkg.manifest, homepage }),
  };
}

export function groupByLicence(entries: PackageEntry[]): LicenceGroup[] {
  const groups = new Map<string, PackageEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.licence);
    if (bucket) bucket.push(entry);
    else groups.set(entry.licence, [entry]);
  }

  return [...groups.entries()]
    .map(([licence, group]) => ({
      licence,
      entries: [...group].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.entries.length - a.entries.length || a.licence.localeCompare(b.licence));
}

export function noticeDocument(
  entries: PackageEntry[],
  fonts: FontEntry[],
  meta: { product: string; generatedAt: string },
): NoticeDocument {
  return {
    product: meta.product,
    generatedAt: meta.generatedAt,
    packageCount: entries.length,
    groups: groupByLicence(entries),
    fonts: [...fonts].sort((a, b) => a.family.localeCompare(b.family)),
  };
}

function rule(title: string): string {
  return `${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`;
}

export function noticeText(document: NoticeDocument): string {
  const parts: string[] = [];

  parts.push(
    rule(`THIRD-PARTY NOTICES FOR ${document.product.toUpperCase()}`),
    "",
    `This product bundles ${document.packageCount} third-party npm packages and ${document.fonts.length} font`,
    "families. Their copyright notices and licence texts are reproduced below, as",
    "their licences require. Each component remains the property of its authors and",
    "is used under the terms stated with it.",
    "",
    `Generated ${document.generatedAt}. Regenerate with \`npm run licenses:notice\`.`,
    "",
    rule("SUMMARY"),
    "",
  );

  for (const group of document.groups) {
    parts.push(`  ${group.licence.padEnd(28)} ${group.entries.length} package${group.entries.length === 1 ? "" : "s"}`);
  }
  parts.push("");
  for (const font of document.fonts) {
    parts.push(`  ${`font: ${font.family}`.padEnd(28)} ${font.licence}`);
  }

  const reciprocal = document.groups.flatMap((group) => group.entries).filter((entry) => entry.sourceUrl);
  if (reciprocal.length > 0) {
    parts.push("", rule("WRITTEN OFFER OF SOURCE"), "");
    parts.push("The following components carry a source-availability obligation. Their");
    parts.push("complete corresponding source is available at the URLs below.", "");
    for (const entry of reciprocal) {
      parts.push(`  ${entry.name}@${entry.version} (${entry.licence})`);
      parts.push(`    ${entry.sourceUrl}`);
    }
  }

  parts.push("", rule("FONTS"), "");
  for (const font of document.fonts) {
    parts.push(`${"-".repeat(78)}`, `${font.family} -- ${font.licence}`, `served from: ${font.servedFrom}`, "");
    if (font.note) parts.push(font.note.trimEnd(), "");
    parts.push(font.licenceText.trimEnd(), "");
  }

  parts.push(rule("NPM PACKAGES"), "");
  for (const group of document.groups) {
    parts.push(
      `${"-".repeat(78)}`,
      `${group.licence} -- ${group.entries.length} package${group.entries.length === 1 ? "" : "s"}`,
      `${"-".repeat(78)}`,
      "",
    );
    for (const entry of group.entries) {
      parts.push(`  ${entry.name}@${entry.version}${entry.homepage ? ` -- ${entry.homepage}` : ""}`);
      if (entry.author) parts.push(`    copyright ${entry.author}`);
      if (entry.declared !== entry.licence) parts.push(`    declared ${entry.declared}; ${entry.licence} elected`);
    }
    parts.push("");

    const untexted = group.entries.filter((entry) => !entry.licenceText);
    if (untexted.length > 0) {
      parts.push(
        `  The following ship no licence file of their own and declare ${group.licence} in`,
        "  their package manifest. The standard terms of that licence, as reproduced in",
        "  this section, govern them:",
        "",
        ...untexted.map((entry) => `    ${entry.name}@${entry.version}`),
        "",
      );
    }

    const texts = new Map<string, string[]>();
    for (const entry of group.entries) {
      if (!entry.licenceText) continue;
      const key = entry.licenceText.trimEnd();
      const holders = texts.get(key);
      if (holders) holders.push(`${entry.name}@${entry.version}`);
      else texts.set(key, [`${entry.name}@${entry.version}`]);
    }

    for (const [text, holders] of texts) {
      parts.push(`  ---- ${holders.join(", ")} ----`, "", text, "");
    }
  }

  const notices = document.groups
    .flatMap((group) => group.entries)
    .filter((entry) => entry.noticeText)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (notices.length > 0) {
    parts.push(rule("APACHE-2.0 NOTICE FILES"), "");
    parts.push("Reproduced as section 4(d) of the Apache License, Version 2.0 requires.", "");
    for (const entry of notices) {
      parts.push(`${"-".repeat(78)}`, `${entry.name}@${entry.version}`, "", entry.noticeText!.trimEnd(), "");
    }
  }

  return `${parts.join("\n").replace(/\n{4,}/g, "\n\n\n")}\n`;
}

export type BundledFont = {
  family: string;
  dir: string;
  licence: string;
  servedFrom: string;
  mirrored: boolean;
};

export const BUNDLED_FONTS: BundledFont[] = [
  { family: "Assistant", dir: "Assistant", licence: "OFL-1.1", mirrored: false, servedFrom: "bundled into .next/static/media from @excalidraw/excalidraw's index.css" },
  { family: "Cascadia Code", dir: "Cascadia", licence: "OFL-1.1", mirrored: true, servedFrom: "/excalidraw-assets/fonts/Cascadia/" },
  { family: "Comic Shanns", dir: "ComicShanns", licence: "MIT", mirrored: true, servedFrom: "/excalidraw-assets/fonts/ComicShanns/" },
  { family: "Excalifont", dir: "Excalifont", licence: "OFL-1.1", mirrored: true, servedFrom: "/excalidraw-assets/fonts/Excalifont/" },
  { family: "Geist and Geist Mono", dir: "Geist", licence: "OFL-1.1", mirrored: false, servedFrom: "bundled into .next/static/media by next/font/google" },
  { family: "Liberation Sans", dir: "Liberation", licence: "GPL-2.0 with font exception", mirrored: true, servedFrom: "/excalidraw-assets/fonts/Liberation/" },
  { family: "Lilita One", dir: "Lilita", licence: "OFL-1.1", mirrored: true, servedFrom: "/excalidraw-assets/fonts/Lilita/" },
  { family: "Nunito", dir: "Nunito", licence: "OFL-1.1", mirrored: true, servedFrom: "/excalidraw-assets/fonts/Nunito/" },
  { family: "Virgil", dir: "Virgil", licence: "OFL-1.1", mirrored: true, servedFrom: "/excalidraw-assets/fonts/Virgil/" },
];

export const MIRRORED_FONT_DIRS = BUNDLED_FONTS.filter((font) => font.mirrored).map((font) => font.dir);

export type PublishedEntry = Omit<PackageEntry, "licenceText" | "noticeText">;

export type PublishedFont = Omit<FontEntry, "licenceText">;

export type PublishedNotice = {
  product: string;
  generatedAt: string;
  packageCount: number;
  groups: { licence: string; entries: PublishedEntry[] }[];
  fonts: PublishedFont[];
};

export function publishedNotice(document: NoticeDocument): PublishedNotice {
  return {
    product: document.product,
    generatedAt: document.generatedAt,
    packageCount: document.packageCount,
    groups: document.groups.map((group) => ({
      licence: group.licence,
      entries: group.entries.map((entry) => ({
        name: entry.name,
        version: entry.version,
        licence: entry.licence,
        declared: entry.declared,
        resolvedFrom: entry.resolvedFrom,
        licenceFileName: entry.licenceFileName,
        homepage: entry.homepage,
        author: entry.author,
        sourceUrl: entry.sourceUrl,
      })),
    })),
    fonts: document.fonts.map((font) => ({
      family: font.family,
      licence: font.licence,
      note: font.note,
      servedFrom: font.servedFrom,
    })),
  };
}
