import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/// The source tree read as text, so a rule about *where* something may appear
/// can be asserted rather than remembered. Two such rules exist — the SDK
/// boundary (`sdk-boundary.test.mts`) and the model floor
/// (`model-floor.test.mts`) — and both are invariants nothing in the type
/// system defends, so both are held as tests over these paths.
///
/// It lives outside a `.test.mts` file because a test file imported by another
/// test file registers its own cases a second time, which would inflate the
/// suite count the migration is measured by.

const webApp = fileURLToPath(new URL("../../..", import.meta.url));

const SOURCE = /\.(m?ts|tsx)$/;

/// `prisma generate` writes a client into the tree that names things the rules
/// here forbid — the connection-string env var among them — and it is not
/// authored, not committed, and not something a person could fix if a rule
/// caught it.
const GENERATED = "src/generated";

export const TEST = /\.test\.mts$/;

/// Repo-relative paths, so an allow-list reads as the paths a person would type.
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

/// Which of `files` name `needle` at all. Deliberately a text match and not an
/// import graph: the rules being defended are about a name being *written*
/// anywhere in a file, and a parser that understood imports would miss a
/// hand-rolled URL or a dynamic one.
export async function filesNaming(needle: string | RegExp, files: string[]): Promise<string[]> {
  const hits = await Promise.all(
    files.map(async (path) => {
      const source = await readSource(path);
      /// `search` and not `test`: a caller's regex may carry `g`, and `test`
      /// on a global regex answers from `lastIndex` rather than from the string.
      const found = typeof needle === "string" ? source.includes(needle) : source.search(needle) >= 0;
      return found ? [path] : [];
    }),
  );
  return hits.flat().sort();
}
