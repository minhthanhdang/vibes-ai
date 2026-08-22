import { test } from "node:test";
import assert from "node:assert/strict";
import { TEST, filesNaming, sourceFiles } from "./source-tree";

/// The one credential in the deployment. Every Google call the app makes goes
/// through this module — the Gen AI SDK builds its client from
/// `googleAuthOptions()` (tech-spec §VII), the Cloud SQL connector is handed the
/// `GoogleAuth` from `googleAuth()` (§VIII), and `vertexFetch`'s one
/// `Authorization` header is minted by `accessToken()` — and until now nothing
/// asserted any of it.
///
/// The migration's spec says outright not to touch this file, which is a
/// sentence and not a guard: the whole of it could be rewritten with the suite
/// green. Dropping `credentials`, dropping `projectId`, minting a fresh client
/// per call and returning an empty token instead of throwing were all verified
/// to leave 1,974 cases passing before these were written.
///
/// `env()` memoises `process.env` itself under this flag rather than a parsed
/// copy, so a value can be moved between assertions and the next call reads the
/// move — which is what shows the options are derived per call and not frozen at
/// import.
process.env.SKIP_ENV_VALIDATION = "1";
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"a@b.iam.gserviceaccount.com"}';
process.env.GOOGLE_CLOUD_PROJECT = "test-project";

const { accessToken, googleAuth, googleAuthOptions } = await import("@/server/google/auth");

test("the key is passed inline, because there is no file on Vercel to point at", () => {
  /// infra.md §VI: no metadata server and no ambient ADC, so a client built with
  /// no `credentials` finds nothing and fails at the first call rather than at
  /// boot. Asserted against the environment rather than against a literal, and
  /// asserted twice across a move, so a hardcoded key cannot satisfy it either.
  assert.equal(googleAuthOptions().credentials, process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const was = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"moved@b.iam.gserviceaccount.com"}';
  try {
    assert.equal(googleAuthOptions().credentials, process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } finally {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = was;
  }
});

test("the options name the project, which is not always the key's own", () => {
  /// A service account can be granted on a project it was not created in, and
  /// the library infers the project from the key when none is given — so an
  /// absent `projectId` is not an error, it is Vertex calls quietly addressed to
  /// the wrong project.
  assert.equal(googleAuthOptions().projectId, process.env.GOOGLE_CLOUD_PROJECT);
});

test("one scope, and it is the one that covers Vertex, GCS and Cloud SQL Admin", () => {
  /// Three services, one token. `cloud-platform` is what makes that possible,
  /// and it is why `googleAuth()` can be shared by the SDK, the connector and
  /// the REST transport instead of each holding a differently-scoped client.
  assert.deepEqual(googleAuthOptions().scopes, ["https://www.googleapis.com/auth/cloud-platform"]);
});

test("the process holds one client, because a client per call is a token cache per call", () => {
  /// `GoogleAuth` caches the minted token and refreshes it before expiry. A
  /// second client is a second cache, which on a warm instance is a second
  /// token request on every call that missed it.
  assert.equal(googleAuth(), googleAuth());
});

/// Stubbed on the shared client on purpose: if `googleAuth()` stopped caching,
/// `accessToken()` would mint through an instance this test never touched and
/// go to the network, so these three cases hold the cache a second way as well
/// as holding what they say they hold.
async function minting<T>(token: string | null | undefined, read: () => Promise<T>) {
  const auth = googleAuth();
  const real = auth.getAccessToken.bind(auth);
  auth.getAccessToken = async () => token;
  try {
    return await read();
  } finally {
    auth.getAccessToken = real;
  }
}

test("the bearer token is what the shared client minted", async () => {
  assert.equal(await minting("ya29.a-token", accessToken), "ya29.a-token");
});

test("a client that mints nothing is a failure here, not an empty bearer far from here", async () => {
  /// The header would still be written — `Bearer undefined` — and Vertex would
  /// answer 401, four backoff-separated times through the throttle ladder, with
  /// a message about the request rather than about the credentials.
  await assert.rejects(
    () => minting(null, accessToken),
    /failed to mint a Google access token/,
  );
});

test("an empty string is nothing minted too", async () => {
  /// The shape this actually arrives in: `getAccessToken()` resolves rather than
  /// rejects when the refresh returned no token, and a check written against
  /// `null` alone lets the empty string through.
  await assert.rejects(
    () => minting("", accessToken),
    /failed to mint a Google access token/,
  );
});

/// `auth.ts` says two places deriving the same credentials from the same env is
/// one place too many, and there are two: `storage.ts` builds a `Storage` with
/// the key directly, because that client takes `credentials` itself and adds its
/// own storage scopes. That is the pair the deployment has, and this holds it at
/// two — a third file reading the key is a third auth path to keep in step, and
/// the one that would not show up in `sdk-boundary.test.mts`'s rules at all.
const MAY_DERIVE_CREDENTIALS = [
  "src/env.ts",
  "src/server/google/auth.ts",
  "src/server/google/storage.ts",
];

test("the service-account key is read in the places that build a client from it, and nowhere else", async () => {
  /// Test files are not scanned: several of them write the key into
  /// `process.env` to give `env()` something to return, and a fixture is not a
  /// derivation. What the rule is about is a client built from the key at
  /// runtime, and every one of those is in the app.
  const app = (await sourceFiles("src", "scripts")).filter((path) => !TEST.test(path));

  assert.deepEqual(
    await filesNaming("GOOGLE_SERVICE_ACCOUNT_JSON", app),
    [...MAY_DERIVE_CREDENTIALS].sort(),
  );
});
