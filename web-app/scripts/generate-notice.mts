import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUNDLED_FONTS,
  LICENCE_FILE_NAMES,
  NOTICE_FILE_NAMES,
  UNRESOLVED,
  noticeDocument,
  noticeText,
  packageEntry,
  productionTree,
  publishedNotice,
  type FontEntry,
  type Manifest,
  type PackageRead,
} from "../src/lib/licenses/notice";

const webApp = fileURLToPath(new URL("..", import.meta.url));
const nodeModules = join(webApp, "node_modules");
const fontLicences = join(webApp, "licenses/fonts");

async function isDir(path: string) {
  return stat(path).then(
    (entry) => entry.isDirectory(),
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
    const found = await Promise.all(roots.map(ownedPackages));
    const next: string[] = [];
    for (const owned of found) {
      for (const { name, dir } of owned) {
        if (!index.has(name)) index.set(name, dir);
        const nested = join(dir, "node_modules");
        if (await isDir(nested)) next.push(nested);
      }
    }
    roots = next;
  }

  return index;
}

const installed = await indexInstallTree();

function packageDir(name: string): string | null {
  return installed.get(name) ?? null;
}

async function readText(dir: string, names: readonly string[]) {
  for (const name of names) {
    const text = await readFile(join(dir, name), "utf8").catch(() => null);
    if (text && text.trim()) return { name, text };
  }
  return null;
}

async function readManifest(name: string): Promise<Manifest | null> {
  const dir = packageDir(name);
  if (!dir) return null;
  const raw = await readFile(join(dir, "package.json"), "utf8").catch(() => null);
  return raw ? (JSON.parse(raw) as Manifest) : null;
}

async function readPackage(name: string): Promise<PackageRead | null> {
  const dir = packageDir(name);
  const manifest = await readManifest(name);
  if (!dir || !manifest) return null;

  const licence = await readText(dir, LICENCE_FILE_NAMES);
  const notice = await readText(dir, NOTICE_FILE_NAMES);

  return {
    manifest,
    licenceFileName: licence?.name ?? null,
    licenceText: licence?.text ?? null,
    noticeText: notice?.text ?? null,
  };
}

const rootManifest = JSON.parse(await readFile(join(webApp, "package.json"), "utf8")) as Manifest;
const { names, missing } = await productionTree(rootManifest, readManifest);

if (names.length === 0) {
  throw new Error(
    `No production dependencies found under ${nodeModules} — the notice would claim this app bundles nothing.`,
  );
}

if (missing.length > 0) {
  throw new Error(
    `${missing.length} required production packages are not installed (${missing.slice(0, 8).join(", ")}) — run \`npm install\` before generating the notice, or it would omit components this app ships.`,
  );
}

const entries = [];
for (const name of names) {
  const pkg = await readPackage(name);
  if (!pkg) continue;
  entries.push(packageEntry(name, pkg));
}

const unresolved = entries.filter((entry) => entry.licence === UNRESOLVED || entry.licence === "UNLICENSED");
if (unresolved.length > 0) {
  throw new Error(
    `no licence could be resolved for ${unresolved.map((entry) => `${entry.name}@${entry.version}`).join(", ")} — the notice would ship an unattributed component; add its terms by hand or drop the dependency`,
  );
}

const fonts: FontEntry[] = [];
for (const font of BUNDLED_FONTS) {
  const dir = join(fontLicences, font.dir);
  const licenceText = await readFile(join(dir, "LICENSE.txt"), "utf8").catch(() => null);
  if (!licenceText) {
    throw new Error(
      `${font.family} has no licence text at licenses/fonts/${font.dir}/LICENSE.txt — this app serves the font from its own origin and may not redistribute it unattributed`,
    );
  }
  fonts.push({
    family: font.family,
    licence: font.licence,
    licenceText,
    note: await readFile(join(dir, "NOTE.txt"), "utf8").catch(() => null),
    servedFrom: font.servedFrom,
  });
}

const document = noticeDocument(entries, fonts, {
  product: "Vibes",
  generatedAt: new Date().toISOString().slice(0, 10),
});

const json = join(webApp, "src/generated/third-party.json");
const text = join(webApp, "public/NOTICE.txt");
await mkdir(dirname(json), { recursive: true });
await mkdir(dirname(text), { recursive: true });

await writeFile(json, `${JSON.stringify(publishedNotice(document), null, 2)}\n`);

await writeFile(text, noticeText(document));

console.log(
  `third-party notices: ${document.packageCount} packages across ${document.groups.length} licences and ${document.fonts.length} font families into public/NOTICE.txt and src/generated/third-party.json`,
);
