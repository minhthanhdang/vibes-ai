import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUNDLED_FONTS,
  LICENCE_FILE_NAMES,
  MIRRORED_FONT_DIRS,
  UNRESOLVED,
  bareSpdx,
  directDependencies,
  elect,
  groupByLicence,
  isReciprocal,
  licenceOf,
  noticeDocument,
  noticeText,
  packageEntry,
  productionTree,
  repositoryUrl,
  sourceOffer,
  spdxOfText,
  type Manifest,
  type PackageRead,
} from "@/lib/licenses/notice";

const webApp = fileURLToPath(new URL("../../..", import.meta.url));
const nodeModules = join(webApp, "node_modules");
const mirror = join(webApp, "public/excalidraw-assets/fonts");
const fontLicences = join(webApp, "licenses/fonts");

function read(manifest: Manifest, licenceText: string | null = null): PackageRead {
  return { manifest, licenceFileName: licenceText ? "LICENSE" : null, licenceText, noticeText: null };
}

async function fileExists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function ownedPackages(root: string) {
  const owned: { name: string; dir: string }[] = [];
  for (const entry of await readdir(root).catch(() => [])) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) {
      for (const scoped of await readdir(join(root, entry)).catch(() => [])) {
        owned.push({ name: `${entry}/${scoped}`, dir: join(root, entry, scoped) });
      }
      continue;
    }
    owned.push({ name: entry, dir: join(root, entry) });
  }
  return owned;
}

async function indexInstallTree() {
  const index = new Map<string, string>();
  let roots = [nodeModules];

  while (roots.length > 0) {
    const next: string[] = [];
    for (const owned of await Promise.all(roots.map(ownedPackages))) {
      for (const { name, dir } of owned) {
        if (!index.has(name)) index.set(name, dir);
        if (await fileExists(join(dir, "node_modules"))) next.push(join(dir, "node_modules"));
      }
    }
    roots = next;
  }

  return index;
}

const installTree = await indexInstallTree();

async function readInstalled(name: string): Promise<PackageRead | null> {
  const dir = installTree.get(name);
  if (!dir) return null;
  const raw = await readFile(join(dir, "package.json"), "utf8").catch(() => null);
  if (!raw) return null;

  for (const candidate of LICENCE_FILE_NAMES) {
    const text = await readFile(join(dir, candidate), "utf8").catch(() => null);
    if (text && text.trim()) {
      return { manifest: JSON.parse(raw) as Manifest, licenceFileName: candidate, licenceText: text, noticeText: null };
    }
  }
  return { manifest: JSON.parse(raw) as Manifest, licenceFileName: null, licenceText: null, noticeText: null };
}

test("the production walk follows dependencies transitively and leaves dev dependencies out", async () => {
  const tree: Record<string, Manifest> = {
    a: { dependencies: { b: "^1" }, devDependencies: { never: "^1" } } as Manifest,
    b: { dependencies: { c: "^1" } },
    c: {},
    never: {},
  };
  const { names, missing } = await productionTree({ dependencies: { a: "^1" } }, async (name) => tree[name] ?? null);

  assert.deepEqual(names, ["a", "b", "c"]);
  assert.deepEqual(missing, []);
});

test("a dependency cycle terminates instead of walking forever", async () => {
  const tree: Record<string, Manifest> = {
    a: { dependencies: { b: "^1" } },
    b: { dependencies: { a: "^1" } },
  };
  const { names } = await productionTree({ dependencies: { a: "^1" } }, async (name) => tree[name] ?? null);

  assert.deepEqual(names, ["a", "b"]);
});

test("an uninstalled optional dependency is not reported missing but a required one is", async () => {
  const root: Manifest = { dependencies: { required: "^1" }, optionalDependencies: { "other-platform": "^1" } };
  const { names, missing } = await productionTree(root, async () => null);

  assert.deepEqual(names, []);
  assert.deepEqual(missing, ["required"], "optional platform binaries that are not installed do not ship");
});

test("optional dependencies are still walked when they are installed", () => {
  assert.deepEqual(
    directDependencies({ dependencies: { a: "^1" }, optionalDependencies: { b: "^1" } }),
    [
      { name: "a", optional: false },
      { name: "b", optional: true },
    ],
  );
});

test("a licence file's text is classified even when its sentences wrap mid-phrase", () => {
  const wrapped = "The MIT License (MIT)\n\nPermission is hereby granted, free of charge, to any person obtaining a\ncopy of this software";
  assert.equal(spdxOfText(wrapped), "MIT");
});

test("isc and 0bsd are told apart by the copyright-notice condition", () => {
  const isc = "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice";
  const zeroBsd = "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\"";

  assert.equal(spdxOfText(isc), "ISC");
  assert.equal(spdxOfText(zeroBsd), "0BSD");
});

test("a manifest's spdx field wins over the licence file, which carries bundled third-party texts", () => {
  const bsdClause = "Neither the name of Google LLC nor the names of its contributors may be used to endorse";
  const licence = licenceOf(read({ license: "MIT" }, `MIT bits then a bundled dependency: ${bsdClause}`));

  assert.equal(licence.spdx, "MIT");
  assert.equal(licence.from, "field");
});

test("a vague licence field falls through to the text of the file", () => {
  const licence = licenceOf(read({ license: "BSD" }, "Redistributions in binary form must reproduce the above copyright notice"));

  assert.equal(licence.spdx, "BSD-2-Clause");
  assert.equal(licence.from, "file");
});

test("the legacy licenses array is read when there is no license field", () => {
  assert.deepEqual(licenceOf(read({ licenses: [{ type: "MIT" }] })), { spdx: "MIT", from: "licenses" });
});

test("a package with neither a field nor a readable file is unresolved", () => {
  assert.deepEqual(licenceOf(read({})), { spdx: UNRESOLVED, from: "none" });
});

test("khroma resolves to MIT from its licence file despite shipping no license field", async () => {
  const khroma = await readInstalled("khroma");
  assert.ok(khroma, "khroma is not installed — run `npm install`");
  assert.equal(khroma.manifest.license, undefined, "khroma gained a license field; the file-fallback case needs a new subject");

  const entry = packageEntry("khroma", khroma);
  assert.equal(entry.licence, "MIT");
  assert.equal(entry.resolvedFrom, "file");
  assert.ok(entry.licenceText?.includes("Fabio Spampinato"), "the notice must reproduce khroma's own copyright line");
});

test("dompurify records the apache-2.0 election so mpl's source disclosure never applies", async () => {
  const dompurify = await readInstalled("dompurify");
  assert.ok(dompurify, "dompurify is not installed — run `npm install`");

  const entry = packageEntry("dompurify", dompurify);
  assert.equal(entry.declared, "(MPL-2.0 OR Apache-2.0)");
  assert.equal(entry.licence, "Apache-2.0");
  assert.equal(entry.sourceUrl, null, "an elected Apache-2.0 carries no source-availability obligation");
});

test("electing from a dual licence takes the most permissive option and leaves a single licence alone", () => {
  assert.equal(elect("(MPL-2.0 OR Apache-2.0)"), "Apache-2.0");
  assert.equal(elect("MIT OR GPL-3.0"), "MIT");
  assert.equal(elect("Apache-2.0"), "Apache-2.0");
  assert.equal(elect("(MIT AND Zlib)"), "MIT AND Zlib", "an AND expression is not a choice");
});

test("a version-suffixed copyleft licence is still recognised as reciprocal", () => {
  assert.equal(bareSpdx("LGPL-3.0-or-later"), "LGPL-3.0");
  assert.equal(isReciprocal("LGPL-3.0-or-later"), true);
  assert.equal(isReciprocal("GPL-2.0-only"), true);
  assert.equal(isReciprocal("MIT"), false);
});

test("a reciprocal package carries a source offer and a permissive one does not", () => {
  const manifest: Manifest = { repository: { url: "git+https://github.com/yisibl/resvg-js.git" } };

  assert.equal(sourceOffer({ licence: "MPL-2.0", manifest, homepage: null }), "https://github.com/yisibl/resvg-js");
  assert.equal(sourceOffer({ licence: "MIT", manifest, homepage: null }), null);
});

test("repository shorthand and git urls both resolve to a browsable https url", () => {
  assert.equal(repositoryUrl({ repository: "lovell/sharp" }), "https://github.com/lovell/sharp");
  assert.equal(repositoryUrl({ repository: { url: "git@github.com:a/b.git" } }), "https://github.com/a/b");
  assert.equal(repositoryUrl({}), null);
});

test("licence groups are ordered by size and their packages by name", () => {
  const entry = (name: string, licence: string) => packageEntry(name, read({ version: "1.0.0", license: licence }));
  const groups = groupByLicence([entry("z", "MIT"), entry("solo", "ISC"), entry("a", "MIT")]);

  assert.deepEqual(
    groups.map((group) => [group.licence, group.entries.map((item) => item.name)]),
    [
      ["MIT", ["a", "z"]],
      ["ISC", ["solo"]],
    ],
  );
});

test("the rendered notice reproduces each licence text and names the source offers", () => {
  const entries = [
    packageEntry("kept", read({ version: "1.0.0", license: "MIT" }, "MIT License\n\nCopyright (c) 2020 Someone")),
    packageEntry("copyleft", read({ version: "2.0.0", license: "MPL-2.0", repository: "an/org" }, "Mozilla Public License 2.0")),
  ];
  const fonts = [
    { family: "Excalifont", licence: "OFL-1.1", licenceText: "OFL text here", note: "a note", servedFrom: "/fonts/" },
  ];
  const rendered = noticeText(noticeDocument(entries, fonts, { product: "Vibes", generatedAt: "2026-08-31" }));

  assert.match(rendered, /Copyright \(c\) 2020 Someone/);
  assert.match(rendered, /WRITTEN OFFER OF SOURCE/);
  assert.match(rendered, /https:\/\/github\.com\/an\/org/);
  assert.match(rendered, /OFL text here/);
  assert.match(rendered, /a note/);
});

test("a group whose package ships no licence text says so rather than staying silent", () => {
  const entries = [packageEntry("bare", read({ version: "1.0.0", license: "MIT" }))];
  const rendered = noticeText(noticeDocument(entries, [], { product: "Vibes", generatedAt: "2026-08-31" }));

  assert.match(rendered, /ship no licence file of their own/);
  assert.match(rendered, /bare@1\.0\.0/);
});

test("an apache-2.0 package's own NOTICE file is propagated, as section 4(d) requires", () => {
  const entries = [
    packageEntry("apached", {
      manifest: { version: "1.0.0", license: "Apache-2.0" },
      licenceFileName: "LICENSE",
      licenceText: "Apache License, Version 2.0",
      noticeText: "This product includes software developed by Someone.",
    }),
  ];
  const rendered = noticeText(noticeDocument(entries, [], { product: "Vibes", generatedAt: "2026-08-31" }));

  assert.match(rendered, /APACHE-2\.0 NOTICE FILES/);
  assert.match(rendered, /includes software developed by Someone/);
});

test("every production dependency resolves to a licence", async () => {
  const root = JSON.parse(await readFile(join(webApp, "package.json"), "utf8")) as Manifest;
  const { names, missing } = await productionTree(root, async (name) => (await readInstalled(name))?.manifest ?? null);

  assert.deepEqual(missing, [], "run `npm install`");
  assert.ok(names.length > 100, `walked only ${names.length} packages — the production tree is not being followed`);

  const unresolved: string[] = [];
  for (const name of names) {
    const pkg = await readInstalled(name);
    if (!pkg) continue;
    const entry = packageEntry(name, pkg);
    if (entry.licence === UNRESOLVED || entry.licence === "UNLICENSED") unresolved.push(name);
  }

  assert.deepEqual(unresolved, [], "run `npm run licenses:notice` and give each package named here its terms by hand");
});

test("every bundled font family has a committed licence text", async () => {
  const missing: string[] = [];
  for (const font of BUNDLED_FONTS) {
    if (!(await fileExists(join(fontLicences, font.dir, "LICENSE.txt")))) missing.push(font.dir);
  }
  assert.deepEqual(missing, [], "a font is served from this origin with no recorded permission to redistribute it");
});

test("every mirrored font family has a licence file beside it", async () => {
  const mirrored = await readdir(mirror).catch(() => null);
  assert.ok(mirrored, "run `npm run mirror:excalidraw`");

  const missing: string[] = [];
  for (const dir of mirrored) {
    if (!(await fileExists(join(mirror, dir, "LICENSE.txt")))) missing.push(dir);
  }
  assert.deepEqual(missing, [], "run `npm run licenses:notice`");

  const unlisted = mirrored.filter((dir) => !MIRRORED_FONT_DIRS.includes(dir));
  assert.deepEqual(unlisted, [], "a newly mirrored family is missing from BUNDLED_FONTS in notice.ts");
});

test("the generated notice covers every licence group and offers source for the copyleft ones", async () => {
  const raw = await readFile(join(webApp, "public/NOTICE.txt"), "utf8").catch(() => null);
  assert.ok(raw, "run `npm run licenses:notice`");

  assert.doesNotMatch(raw, /\bUNRESOLVED\b/, "an unattributed component reached the notice");
  for (const licence of ["MIT", "ISC", "Apache-2.0", "BSD-3-Clause", "MPL-2.0"]) {
    assert.ok(raw.includes(licence), `${licence} is missing from the notice`);
  }
  for (const font of BUNDLED_FONTS) {
    assert.ok(raw.includes(font.family), `${font.family} is missing from the notice`);
  }
});
