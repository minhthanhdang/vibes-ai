/// Copies the font files excalidraw would otherwise fetch from esm.sh into
/// `public/`, so a board's text does not depend on a third-party CDN. Runs
/// before `dev` and `build` and on install; the output is generated, ignored by
/// git, and always matches the installed version of the package.

import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CDN_ONLY_FONT_FAMILIES,
  fontUrisInBundle,
  isCdnOnlyFontUri,
  mirroredAssetPath,
} from "../src/lib/excalidraw-assets";

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

/// Rebuilt rather than added to: a version bump that renames a hashed subset
/// would otherwise leave the old file behind forever.
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
