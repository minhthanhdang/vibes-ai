import { test } from "node:test";
import assert from "node:assert/strict";
import { filesNaming, sourceFiles } from "./source-tree";

/// Where the model lives, held as a test rather than as a rule someone
/// remembers. tech-spec §VII put `@google/genai` underneath `vertex.ts` and
/// nowhere else, and that is an invariant nothing in the type system defends:
/// the next agent that needs a model call can `import { GoogleGenAI }` in its
/// own file, get a working answer, and split the app across two clients — two
/// auth paths, two retry ladders, and a burst throttle (infra.md §X) that only
/// one of them knows how to read.
///
/// The same for the endpoint. `apiHost()` is the one place the Vertex domain is
/// spelled, so a `fetch` written at a model URL shows up here as a second file
/// naming the host.
///
/// The host rule alone does not finish the job, and it reads as if it does.
/// `vertexFetch` is exported and already knows the host, the version prefix and
/// the bearer token, so a model call hand-rolled *through it* names neither the
/// package nor the domain and passes both rules above. What stays REST is one
/// surface — Agent Runtime, which the SDK has no equivalent for (tech-spec §VII
/// "What stays on REST") — so the three rules below say that outright: who may
/// call the REST transport, who may hold a bearer token, and that nothing in
/// the tree spells a model endpoint's verb at all.

/// The two test files read the real SDK on purpose — `vertex.test.mts` throws a
/// real `ApiError` at the throttle retry, and `model-finish.test.mts` compares
/// against the real `FinishReason` — because a boundary asserted against a
/// hand-written stand-in asserts nothing. This file names the package in its own
/// allow-list, so it is skipped rather than allowed.
const MAY_IMPORT_SDK = [
  "src/server/google/vertex.ts",
  "src/server/google/vertex.test.mts",
  "src/server/google/retry-ladder.test.mts",
  "src/lib/agent/model-finish.test.mts",
];

const MAY_NAME_THE_HOST = ["src/server/google/vertex.ts"];

/// vertex.ts declares it; `agent-runtime.ts` is the one caller, and the reason
/// `vertexFetch` survived the swap at all. A third entry here is a second
/// transport to Vertex — its own retry ladder, and a burst throttle read a
/// second way.
const MAY_CALL_THE_REST_TRANSPORT = [
  "src/server/google/vertex.ts",
  "src/server/google/agent-runtime.ts",
];

/// auth.ts mints it, vertex.ts puts it in the one `Authorization` header the app
/// writes. Everything else that authenticates to Google — GCS, Cloud SQL — takes
/// the `GoogleAuth` client and lets a library do the header, so a raw token
/// anywhere else is a request being assembled by hand.
/// `auth.test.mts` is on the list for the same reason the three test files above
/// are on the SDK's: it asserts against the real thing. What it holds is that a
/// client which minted nothing is a failure at the mint rather than an empty
/// `Bearer` four backoffs later, and there is no way to assert that without
/// naming the function that mints.
const MAY_HOLD_A_BEARER_TOKEN = [
  "src/server/google/auth.ts",
  "src/server/google/auth.test.mts",
  "src/server/google/vertex.ts",
];

/// The verbs a model URL ends in. The SDK composes these paths itself and the
/// app never sees one, so unlike the rules above this one has no allow-list at
/// all: a file spelling any of them is assembling a model call by hand,
/// whichever transport it then hands it to.
///
/// Anchored on the character before the colon, which is the end of a resource
/// path — `${resource()}:` or `…/models/gemini-3.7-flash:`. Without it the
/// pattern also matches its own alternation syntax, and `generate-seam.test.mts`
/// (which greps for `(?:generateContent|countTokens)`) reads as a hand-rolled
/// call.
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
  /// Matched at the call *or* at the import, and not by name alone: five files
  /// name it in prose — `image-generator.ts` explaining its backoff, four test
  /// files explaining what they assert — and a comment about a transport is not
  /// a second one.
  ///
  /// The call anchor alone was enough until `agent-runtime.ts` took an injected
  /// transport (tech-spec §VII "What stays on REST"): it passes `vertexFetch` as
  /// a default and calls the parameter, so the one file this rule exists to
  /// name stopped matching and the rule went green reporting a single entry.
  /// A binding import is what "reaches the transport" actually means, and it is
  /// the one spelling prose cannot produce by accident.
  const named = await naming(/vertexFetch\(|import\s*\{[^}]*\bvertexFetch\b/);
  assert.deepEqual(named.sort(), [...MAY_CALL_THE_REST_TRANSPORT].sort());
});

test("the one access token the app holds is held where the one hand-written request is", async () => {
  assert.deepEqual((await naming("accessToken")).sort(), [...MAY_HOLD_A_BEARER_TOKEN].sort());
});

test("no file spells a model endpoint, so no model call is assembled by hand", async () => {
  assert.deepEqual(await naming(MODEL_ENDPOINT_VERBS), []);
});
