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

/// Docs that live beside the code they document. `context/` is gitignored, so a
/// design record that has to survive a fresh clone is a file under `src/` — and
/// finding those is a different question from the one the source-text rules ask,
/// which is why it is a second pattern rather than a wider `SOURCE`. Widening
/// `SOURCE` would silently change the file set six rule tests assert over.
export const DOC = /\.md$/;

/// `prisma generate` writes a client into the tree that names things the rules
/// here forbid — the connection-string env var among them — and it is not
/// authored, not committed, and not something a person could fix if a rule
/// caught it.
const GENERATED = "src/generated";

export const TEST = /\.test\.mts$/;

/// Repo-relative paths, so an allow-list reads as the paths a person would type.
export async function sourceFiles(...dirs: string[]): Promise<string[]> {
  return filesUnder(SOURCE, dirs);
}

/// The colocated docs, walked by the same descent so a doc four levels down is
/// found on the same terms a module there is.
export async function docFiles(...dirs: string[]): Promise<string[]> {
  return filesUnder(DOC, dirs);
}

async function filesUnder(pattern: RegExp, dirs: string[]): Promise<string[]> {
  const walked = await Promise.all(dirs.map((dir) => walk(dir, pattern)));
  return walked.flat();
}

async function walk(dir: string, pattern: RegExp): Promise<string[]> {
  const entries = await readdir(join(webApp, dir), { withFileTypes: true });
  const found = await Promise.all(
    entries.map((entry) => {
      const path = `${dir}/${entry.name}`;
      if (path === GENERATED) return [];
      if (entry.isDirectory()) return walk(path, pattern);
      return pattern.test(entry.name) ? [path] : [];
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
