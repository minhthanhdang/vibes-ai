import "server-only";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
    }
  }
  found.set(dir, file);
  return file;
}
