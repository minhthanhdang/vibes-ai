import { test } from "node:test";
import assert from "node:assert/strict";
import { filesNaming, sourceFiles } from "./source-tree";

const MAY_IMPORT_SDK = [
  "src/server/google/vertex.ts",
  "src/server/google/vertex.test.mts",
  "src/server/google/retry-ladder.test.mts",
  "src/lib/agent/shared/model-finish.test.mts",
];

const MAY_NAME_THE_HOST = ["src/server/google/vertex.ts"];

const MAY_CALL_THE_REST_TRANSPORT = [
  "src/server/google/vertex.ts",
  "src/server/google/agent-runtime.ts",
];

const MAY_HOLD_A_BEARER_TOKEN = [
  "src/server/google/auth.ts",
  "src/server/google/auth.test.mts",
  "src/server/google/vertex.ts",
];

const MODEL_ENDPOINT_VERBS =
  /[\w}]:(?:generateContent|streamGenerateContent|countTokens|computeTokens|predict|rawPredict)\b/;

const SELF = "src/server/google/sdk-boundary.test.mts";

async function naming(needle: string | RegExp) {
  const named = await filesNaming(needle, await sourceFiles("src", "scripts"));
  return named.filter((path) => path !== SELF);
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

test("the REST transport that stayed is called by the one surface it stayed for", async () => {
  const named = await naming(/vertexFetch\(|import\s*\{[^}]*\bvertexFetch\b/);
  assert.deepEqual(named.sort(), [...MAY_CALL_THE_REST_TRANSPORT].sort());
});

test("the one access token the app holds is held where the one hand-written request is", async () => {
  assert.deepEqual((await naming("accessToken")).sort(), [...MAY_HOLD_A_BEARER_TOKEN].sort());
});

test("no file spells a model endpoint, so no model call is assembled by hand", async () => {
  assert.deepEqual(await naming(MODEL_ENDPOINT_VERBS), []);
});
