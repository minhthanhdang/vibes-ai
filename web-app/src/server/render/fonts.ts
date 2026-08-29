import "server-only";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/// Where the classic faces' TTFs live on this machine.
///
/// `.fonts/` is generated beside `public/` by `mirror-excalidraw-assets.mts` —
/// one Latin TTF per classic family, under the family's mirror directory. On
/// Vercel the directory is traced into the render routes
/// (`next.config.ts`), where it can land relative to a different cwd, so the
/// lookup walks a short candidate list and `VIBES_FONTS_DIR` is the escape
/// hatch if none of them is right.
///
/// Answers are memoised for the life of the process: the mirror rebuilds only
/// between runs, and a render asks once per text draw.

let rootFound: string | null | undefined;

function fontsRoot(): string | null {
  if (rootFound !== undefined) return rootFound;
  const candidates = [
    process.env.VIBES_FONTS_DIR,
    join(process.cwd(), ".fonts"),
    join(process.cwd(), "web-app/.fonts"),
  ];
  rootFound = candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
  return rootFound;
}

const found = new Map<string, string | null>();

/// The TTF for one classic family's mirror directory, or null on a checkout
/// where the mirror has not run — which is the case the rasteriser outlines
/// and names rather than drawing nothing.
export function classicFontFile(dir: string): string | null {
  const cached = found.get(dir);
  if (cached !== undefined) return cached;

  const root = fontsRoot();
  let file: string | null = null;
  if (root) {
    try {
      const ttf = readdirSync(join(root, dir)).find((name) => name.endsWith(".ttf"));
      if (ttf) file = join(root, dir, ttf);
    } catch {
      /// A family the mirror does not carry is a face that cannot be set.
    }
  }
  found.set(dir, file);
  return file;
}
