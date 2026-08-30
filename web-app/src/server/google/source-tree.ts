import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webApp = fileURLToPath(new URL("../../..", import.meta.url));

const SOURCE = /\.(m?ts|tsx)$/;

const GENERATED = "src/generated";

export const TEST = /\.test\.mts$/;

export async function sourceFiles(...dirs: string[]): Promise<string[]> {
  const walked = await Promise.all(dirs.map((dir) => walk(dir)));
  return walked.flat();
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(join(webApp, dir), { withFileTypes: true });
  const found = await Promise.all(
    entries.map((entry) => {
      const path = `${dir}/${entry.name}`;
      if (path === GENERATED) return [];
      if (entry.isDirectory()) return walk(path);
      return SOURCE.test(entry.name) ? [path] : [];
    }),
  );
  return found.flat();
}

export function readSource(path: string): Promise<string> {
  return readFile(join(webApp, path), "utf8");
}

export async function filesNaming(needle: string | RegExp, files: string[]): Promise<string[]> {
  const hits = await Promise.all(
    files.map(async (path) => {
      const source = await readSource(path);
      const found = typeof needle === "string" ? source.includes(needle) : source.search(needle) >= 0;
      return found ? [path] : [];
    }),
  );
  return hits.flat().sort();
}
