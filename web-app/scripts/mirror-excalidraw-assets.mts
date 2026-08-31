import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import wawoff2 from "wawoff2";

import { familyName, setsLatin } from "../src/lib/render/font-measure";
import { CLASSIC_FONT_FAMILIES } from "../src/lib/render/render-plan";
import {
  CDN_ONLY_FONT_FAMILIES,
  fontUrisInBundle,
  isCdnOnlyFontUri,
  mirroredAssetPath,
} from "../src/lib/scene/excalidraw-assets";

const webApp = fileURLToPath(new URL("..", import.meta.url));
const packageDist = join(webApp, "node_modules/@excalidraw/excalidraw/dist/prod");
const mirror = join(webApp, "public/excalidraw-assets");

async function bundleSource() {
  const files = (await readdir(packageDist)).filter((name) => name.endsWith(".js"));
  const sources = await Promise.all(files.map((name) => readFile(join(packageDist, name), "utf8")));
  return sources.join("\n");
}

const uris = fontUrisInBundle(await bundleSource()).filter((uri) => !isCdnOnlyFontUri(uri));
if (uris.length === 0) {
  throw new Error(
    `No font uris found in ${packageDist} — the bundle's shape changed and the mirror would ship nothing.`,
  );
}

await rm(mirror, { recursive: true, force: true });

let bytes = 0;
for (const uri of uris) {
  const relative = mirroredAssetPath(uri);
  const source = join(packageDist, relative);
  const target = join(mirror, relative);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
  bytes += (await stat(target)).size;
}

console.log(
  `excalidraw assets: mirrored ${uris.length} font files (${Math.round(bytes / 1024)} KB) into public/excalidraw-assets; ${CDN_ONLY_FONT_FAMILIES.join(", ")} left to the CDN`,
);

const fontsDir = join(webApp, ".fonts");
await rm(fontsDir, { recursive: true, force: true });

let faces = 0;
for (const dir of await readdir(join(mirror, "fonts"))) {
  const wanted = CLASSIC_FONT_FAMILIES[dir];
  if (!wanted) {
    throw new Error(`the mirror carries a family render-plan.ts has no row for: ${dir}`);
  }
  const kept: string[] = [];
  for (const file of await readdir(join(mirror, "fonts", dir))) {
    const ttf = Buffer.from(await wawoff2.decompress(await readFile(join(mirror, "fonts", dir, file))));
    if (!setsLatin(ttf)) continue;
    const named = familyName(ttf);
    if (named !== wanted) {
      throw new Error(
        `${dir}'s Latin face calls itself ${JSON.stringify(named)} and render-plan.ts says ${JSON.stringify(wanted)} — the package renamed a face and the rasteriser would silently fall back`,
      );
    }
    const target = join(fontsDir, dir, file.replace(/\.woff2$/, ".ttf"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, ttf);
    kept.push(file);
  }
  if (kept.length !== 1) {
    throw new Error(
      `${dir}: expected exactly one Latin subset and found ${kept.length} (${kept.join(", ") || "none"}) — the subset split changed and the picked face is no longer certain`,
    );
  }
  faces += 1;
}

for (const dir of Object.keys(CLASSIC_FONT_FAMILIES)) {
  if (!(await stat(join(fontsDir, dir)).catch(() => null))) {
    throw new Error(`render-plan.ts names a family the package no longer ships: ${dir}`);
  }
}

console.log(`excalidraw assets: decompressed ${faces} Latin faces into .fonts for the rasteriser`);

let licences = 0;
for (const dir of await readdir(join(mirror, "fonts"))) {
  const source = join(webApp, "licenses/fonts", dir, "LICENSE.txt");
  if (!(await stat(source).catch(() => null))) {
    throw new Error(
      `${dir} is mirrored into public/excalidraw-assets but has no licence text at licenses/fonts/${dir}/LICENSE.txt — this origin would serve a font it has no recorded permission to redistribute; add the family's licence there and to BUNDLED_FONTS in src/lib/licenses/notice.ts`,
    );
  }
  await cp(source, join(mirror, "fonts", dir, "LICENSE.txt"));
  licences += 1;
}

console.log(`excalidraw assets: copied ${licences} font licence texts in beside the mirrored families`);
