import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CDN_ONLY_FONT_FAMILIES,
  EXCALIDRAW_ASSET_PATH,
  fontFamilyOfUri,
  fontUrisInBundle,
  isCdnOnlyFontUri,
  mirroredAssetPath,
  mirroredAssetUrl,
} from "@/lib/scene/excalidraw-assets";

const webApp = fileURLToPath(new URL("../../..", import.meta.url));
const packageDist = join(webApp, "node_modules/@excalidraw/excalidraw/dist/prod");
const mirror = join(webApp, "public/excalidraw-assets");

async function bundleSource() {
  const files = (await readdir(packageDist)).filter((name) => name.endsWith(".js"));
  const sources = await Promise.all(files.map((name) => readFile(join(packageDist, name), "utf8")));
  return sources.join("\n");
}

async function fileExists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

test("fontUrisInBundle picks font descriptors out of a minified bundle, deduped", () => {
  const source = `var a="./fonts/Virgil/Virgil-Regular.woff2";var b=[{uri:a},{uri:"./fonts/Nunito/Nunito-Regular-XR.woff2"}];var c="./fonts/Virgil/Virgil-Regular.woff2";`;
  assert.deepEqual(fontUrisInBundle(source), [
    "./fonts/Nunito/Nunito-Regular-XR.woff2",
    "./fonts/Virgil/Virgil-Regular.woff2",
  ]);
});

test("fontUrisInBundle finds nothing in a bundle that names no fonts", () => {
  assert.deepEqual(fontUrisInBundle('import("./subset-worker.chunk.js")'), []);
});

test("fontFamilyOfUri reads the directory the file lives in", () => {
  assert.equal(fontFamilyOfUri("./fonts/Excalifont/Excalifont-Regular-349fac.woff2"), "Excalifont");
  assert.equal(fontFamilyOfUri("nonsense"), "");
});

test("the CJK fallback is left to the CDN and everything else is mirrored", () => {
  assert.equal(isCdnOnlyFontUri("./fonts/Xiaolai/Xiaolai-Regular-019d66.woff2"), true);
  assert.equal(isCdnOnlyFontUri("./fonts/Excalifont/Excalifont-Regular-349fac.woff2"), false);
});

test("a mirrored uri keeps the package's directory layout", () => {
  assert.equal(
    mirroredAssetPath("./fonts/Cascadia/CascadiaCode-Regular.woff2"),
    "fonts/Cascadia/CascadiaCode-Regular.woff2",
  );
  assert.equal(
    mirroredAssetUrl("./fonts/Cascadia/CascadiaCode-Regular.woff2"),
    "/excalidraw-assets/fonts/Cascadia/CascadiaCode-Regular.woff2",
  );
});

test("the asset path is absolute and ends in a slash, as excalidraw's URL join needs", () => {
  assert.match(EXCALIDRAW_ASSET_PATH, /^\/.*\/$/);
});

/// Excalidraw resolves a uri with `new URL(uri.replace(/^\.?\/+/, ""), base)`,
/// where `base` is the asset path normalized to end in a slash. Pinning the
/// join here means a change to either half is caught without a browser.
test("excalidraw's own resolution lands on the mirrored url", () => {
  const uri = "./fonts/Excalifont/Excalifont-Regular-349fac.woff2";
  const resolved = new URL(uri.replace(/^\.?\/+/, ""), `https://app.test${EXCALIDRAW_ASSET_PATH}`);
  assert.equal(resolved.pathname, mirroredAssetUrl(uri));
});

/// The contract that cannot be seen by looking at the board: a font the bundle
/// asks for but the mirror does not hold loads from esm.sh instead, which is
/// exactly the silent CDN dependency the mirror exists to remove. A version
/// bump that adds or rehashes a family fails here rather than in production.
test("every font the installed bundle asks for is mirrored, except the CDN-only families", async () => {
  const uris = fontUrisInBundle(await bundleSource());
  assert.ok(uris.length > 0, "found no font uris in the installed package");

  const missing: string[] = [];
  for (const uri of uris.filter((candidate) => !isCdnOnlyFontUri(candidate))) {
    if (!(await fileExists(join(mirror, mirroredAssetPath(uri))))) missing.push(uri);
  }
  assert.deepEqual(missing, [], "run `npm run mirror:excalidraw`");

  const families = new Set(uris.map(fontFamilyOfUri));
  for (const family of CDN_ONLY_FONT_FAMILIES) {
    assert.ok(families.has(family), `${family} is no longer in the package — drop it from the list`);
  }
});

/// The other half: the mirror is small on purpose. Xiaolai alone is 12 MB of
/// the package's 13 MB of fonts, and copying it in on every install would
/// dwarf the app it is being served next to.
test("the CDN-only families are absent from the mirror", async () => {
  const present: string[] = [];
  for (const family of CDN_ONLY_FONT_FAMILIES) {
    if (await fileExists(join(mirror, "fonts", family))) present.push(family);
  }
  assert.deepEqual(present, []);
});
