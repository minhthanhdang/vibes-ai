import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, normalize } from "node:path/posix";
import { readSource } from "@/server/google/source-tree";

const ENTRY = ["src/server/decks/deck-export.ts"];

const NO_MODEL_FILES = [
  "src/server/google/vertex.ts",
  "src/server/google/agent-runtime.ts",
  "src/server/google/auth.ts",
];

const MODEL_SDK_SCOPE = "@google/";

const GENERATED = "src/generated/";

const SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']/g;
const BARE_IMPORT = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

function specifiersIn(source: string): string[] {
  return [SPECIFIER, BARE_IMPORT, DYNAMIC_IMPORT].flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1]!),
  );
}

async function resolved(from: string, specifier: string): Promise<string | null> {
  const base = specifier.startsWith("@/")
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith(".")
      ? normalize(join(dirname(from), specifier))
      : null;
  if (base === null) return null;

  for (const suffix of CANDIDATE_SUFFIXES) {
    const path = `${base}${suffix}`;
    if (!/\.(m?ts|tsx)$/.test(path)) continue;
    try {
      await readSource(path);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

async function walkFromEntries() {
  const reached = new Set<string>();
  const packages = new Set<string>();
  const skippedGenerated: string[] = [];
  const queue = [...ENTRY];

  while (queue.length > 0) {
    const path = queue.pop()!;
    if (reached.has(path)) continue;
    reached.add(path);

    const source = await readSource(path);
    for (const specifier of specifiersIn(source)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
        packages.add(specifier);
        continue;
      }
      const next = await resolved(path, specifier);
      if (!next) continue;
      if (next.startsWith(GENERATED)) {
        skippedGenerated.push(next);
        continue;
      }
      if (!reached.has(next)) queue.push(next);
    }
  }

  return { reached, packages, skippedGenerated };
}

test("the deck's import graph is a real graph, walked from the export itself", async () => {
  const { reached, skippedGenerated } = await walkFromEntries();
  assert.ok(reached.size > 10, `walked only ${reached.size} files from the deck export`);
  assert.ok(reached.has("src/lib/decks/deck-plan.ts"));
  assert.ok(reached.has("src/server/decks/slides-api.ts"));
  assert.ok(reached.has("src/server/decks/credential.ts"));
  assert.ok(skippedGenerated.length > 0, "the Prisma client was never reached, so its skip is a hole");
});

test("nothing the deck reaches is a model call — that is what makes the deck not an agent", async () => {
  const { reached, packages } = await walkFromEntries();
  for (const path of NO_MODEL_FILES) assert.ok(!reached.has(path), `deck reaches ${path}`);
  assert.deepEqual(
    [...packages].filter((name) => name.startsWith(MODEL_SDK_SCOPE)),
    [],
  );
});
