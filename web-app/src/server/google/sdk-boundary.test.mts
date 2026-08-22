import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/// Where the model lives, held as a test rather than as a rule someone
/// remembers. tech-spec §VII put `@google/genai` underneath `vertex.ts` and
/// nowhere else, and that is an invariant nothing in the type system defends:
/// the next agent that needs a model call can `import { GoogleGenAI }` in its
/// own file, get a working answer, and split the app across two clients — two
/// auth paths, two retry ladders, and a burst throttle (infra.md §X) that only
/// one of them knows how to read.
///
/// The same for the endpoint. `apiHost()` is the one place the Vertex domain is
/// spelled, so a hand-rolled `fetch` at a model URL shows up here as a second
/// file naming the host.

const webApp = fileURLToPath(new URL("../../..", import.meta.url));

/// The two test files read the real SDK on purpose — `vertex.test.mts` throws a
/// real `ApiError` at the throttle retry, and `model-finish.test.mts` compares
/// against the real `FinishReason` — because a boundary asserted against a
/// hand-written stand-in asserts nothing. This file names the package in its own
/// allow-list, so it is skipped rather than allowed.
const MAY_IMPORT_SDK = [
  "src/server/google/vertex.ts",
  "src/server/google/vertex.test.mts",
  "src/lib/agent/model-finish.test.mts",
];

const MAY_NAME_THE_HOST = ["src/server/google/vertex.ts"];

const SELF = "src/server/google/sdk-boundary.test.mts";

const SOURCE = /\.(m?ts|tsx)$/;

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(join(webApp, dir), { withFileTypes: true });
  const found = await Promise.all(
    entries.map((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      return SOURCE.test(entry.name) ? [path] : [];
    }),
  );
  return found.flat();
}

async function naming(needle: string) {
  const files = [...(await sourceFiles("src")), ...(await sourceFiles("scripts"))];
  const hits = await Promise.all(
    files.map(async (path) => {
      const source = await readFile(join(webApp, path), "utf8");
      return source.includes(needle) ? [path] : [];
    }),
  );
  return hits.flat().filter((path) => path !== SELF);
}

test("the app scans as a real tree — the boundary below is asserted over files, not over none", async () => {
  const files = await sourceFiles("src");
  assert.ok(files.length > 100, `expected the whole of src, walked ${files.length} files`);
  assert.ok(files.includes("src/server/google/vertex.ts"));
});

test("@google/genai is imported by vertex.ts and by the tests that assert against the real SDK", async () => {
  assert.deepEqual((await naming("@google/genai")).sort(), [...MAY_IMPORT_SDK].sort());
});

test("the Vertex host is spelled in one place, so no model call is a hand-rolled fetch", async () => {
  const named = await naming("aiplatform.googleapis.com");
  assert.deepEqual(named.sort(), [...MAY_NAME_THE_HOST].sort());
});
