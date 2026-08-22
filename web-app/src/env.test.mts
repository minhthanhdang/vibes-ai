import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "@/env";

/// The boot gate, and until now the only file on the migration's path with no
/// test at all. Stage 3 made four `CLOUD_SQL_*` keys required here because
/// `server/db.ts` has no other route to a database (tech-spec §VIII), stage 2
/// depends on `GOOGLE_CLOUD_LOCATION` defaulting to `global` because that is
/// the only place gemini-3.x is served (infra §VI, §X), and every Vertex and
/// GCS call runs on a key this schema is the only thing to validate.
///
/// Sixteen mutations were planted here and all sixteen left the 2,023-case
/// suite green — a required key made optional, `global` swapped for a region,
/// the enterprise flag flipped, a blank worker secret no longer disabling the
/// route, a TTL of zero accepted, and the validation branch skipped outright
/// among them. Three of the sixteen are red at `tsc` and the rest are not
/// visible anywhere.
///
/// Every case parses an explicit source rather than `process.env`: `env()`
/// memoises, so one process can only ever observe one environment through it,
/// and the two cases that do use `env()` are the ones about the memo itself.

/// Every required key with a value that is legal but deliberately unlike the
/// production one, so a case that asserts a field cannot be satisfied by a
/// hardcoded real value (the shape of iteration 19's forwarding finding).
const KEY = {
  client_email: "fixture@fixture.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----fixture-----END PRIVATE KEY-----",
  project_id: "fixture-project",
};

function complete(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    DATABASE_URL: "postgresql://fixture@localhost:5432/fixture",
    CLOUD_SQL_INSTANCE: "fixture-project:fixture-region:fixture-instance",
    CLOUD_SQL_USER: "user-fixture",
    CLOUD_SQL_PASSWORD: "password-fixture",
    CLOUD_SQL_DATABASE: "database-fixture",
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(KEY),
    GOOGLE_CLOUD_PROJECT: "project-fixture",
    GOOGLE_OAUTH_CLIENT_ID: "client-id-fixture",
    GOOGLE_OAUTH_CLIENT_SECRET: "client-secret-fixture",
    GCS_BUCKET: "bucket-fixture",
    ...overrides,
  };
}

function without(key: string): Record<string, string | undefined> {
  const source = complete();
  delete source[key];
  return source;
}

const CLOUD_SQL_KEYS = [
  "CLOUD_SQL_INSTANCE",
  "CLOUD_SQL_USER",
  "CLOUD_SQL_PASSWORD",
  "CLOUD_SQL_DATABASE",
];

test("the complete fixture parses, so every case below fails for its own reason", () => {
  assert.ok(parseEnv(complete()));
});

test("each Cloud SQL key is required, because a missing one is an app with no storage", () => {
  /// Optional here would boot an app that fails on its first query instead of
  /// at start-up, and on Vercel that is a deploy that looks healthy. Asserted
  /// per key rather than once, so making any single one optional — or giving
  /// one a default — fails on that key's name.
  for (const key of CLOUD_SQL_KEYS) {
    assert.throws(() => parseEnv(without(key)), new RegExp(key), `${key} is not required`);
  }
});

test("each Cloud SQL value comes back from its own key", () => {
  /// Four same-shaped strings that read equally well in each other's slots —
  /// the fixtures differ from each other on purpose, because that is the only
  /// thing that can tell a correct wiring from a swapped one.
  const parsed = parseEnv(complete());
  assert.equal(parsed.CLOUD_SQL_INSTANCE, "fixture-project:fixture-region:fixture-instance");
  assert.equal(parsed.CLOUD_SQL_USER, "user-fixture");
  assert.equal(parsed.CLOUD_SQL_PASSWORD, "password-fixture");
  assert.equal(parsed.CLOUD_SQL_DATABASE, "database-fixture");
});

test("the connection string the CLI still uses has to be a URL", () => {
  /// It is the Prisma CLI's channel now (tech-spec §VIII) and nothing in the
  /// running app reads it, which is exactly why a bare database name would sit
  /// here unnoticed until a migration ran.
  assert.throws(() => parseEnv(complete({ DATABASE_URL: "vibes_ai" })), /DATABASE_URL/);
});

test("the location defaults to global, because that is where gemini-3.x is served", () => {
  /// infra §VI, §X: the Managed Agents API and the gemini-3.x models are global
  /// only, so a regional default is not a preference — it is every model call
  /// in the app 404ing. Asserted with the key absent and again with it set, so
  /// a default that ignores the environment fails too.
  assert.equal(parseEnv(without("GOOGLE_CLOUD_LOCATION")).GOOGLE_CLOUD_LOCATION, "global");
  assert.equal(
    parseEnv(complete({ GOOGLE_CLOUD_LOCATION: "us-central1" })).GOOGLE_CLOUD_LOCATION,
    "us-central1",
  );
});

test("the enterprise flag defaults on, which is what puts the SDK on Vertex", () => {
  assert.equal(parseEnv(without("GOOGLE_GENAI_USE_ENTERPRISE")).GOOGLE_GENAI_USE_ENTERPRISE, "1");
});

test("the service account key arrives parsed, not as the string it was read from", () => {
  /// `auth.ts` hands this straight to `GoogleAuth` as `credentials`, which
  /// wants the object. This is also the case that fails if validation is
  /// skipped for a source that did not ask to skip it: the escape hatch returns
  /// the raw strings.
  assert.deepEqual(parseEnv(complete()).GOOGLE_SERVICE_ACCOUNT_JSON, KEY);
});

test("a key that is not JSON fails the environment rather than the first call", () => {
  /// The failure has to name the key it came from: `JSON.parse` throwing out of
  /// the transform would surface as an unexplained `SyntaxError` at whichever
  /// import touched `env()` first.
  assert.throws(
    () => parseEnv(complete({ GOOGLE_SERVICE_ACCOUNT_JSON: "{not json" })),
    /GOOGLE_SERVICE_ACCOUNT_JSON/,
  );
});

test("a key missing a field, or with a client_email that is not one, is not a key", () => {
  /// Well-formed JSON with the wrong contents is the realistic failure — a
  /// key pasted from the console with a field trimmed, or an OAuth client's
  /// JSON pasted where a service account's belongs.
  const noPrivateKey = { ...KEY, private_key: "" };
  const notAnEmail = { ...KEY, client_email: "fixture-service-account" };
  assert.throws(() => parseEnv(complete({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(noPrivateKey) })));
  assert.throws(() => parseEnv(complete({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(notAnEmail) })));
});

test("a blank worker secret disables the endpoint instead of failing every run", () => {
  /// `.env.example` carries the key with an empty value, so a copied-but-
  /// unfilled line has to read as unset. Without the preprocess it is a string
  /// of length zero against a minimum of 16, which fails the whole environment
  /// and takes the app down for a route that was meant to be off.
  assert.equal(parseEnv(complete({ ANALYZER_WORKER_SECRET: "" })).ANALYZER_WORKER_SECRET, undefined);
  assert.equal(parseEnv(complete({ ANALYZER_WORKER_SECRET: "   " })).ANALYZER_WORKER_SECRET, undefined);
  assert.equal(parseEnv(without("ANALYZER_WORKER_SECRET")).ANALYZER_WORKER_SECRET, undefined);
});

test("a worker secret short enough to guess is rejected, not accepted quietly", () => {
  /// The route is session-less, so this string is the only thing between the
  /// public internet and Vertex spend.
  assert.throws(() => parseEnv(complete({ ANALYZER_WORKER_SECRET: "tooshort" })), /ANALYZER_WORKER_SECRET/);
  assert.equal(
    parseEnv(complete({ ANALYZER_WORKER_SECRET: "0123456789abcdef" })).ANALYZER_WORKER_SECRET,
    "0123456789abcdef",
  );
});

test("the signed-URL TTL is a positive number of seconds, defaulting to fifteen minutes", () => {
  /// It comes off the environment as a string and is spent as a number. Zero is
  /// the interesting rejection: a URL that has already expired is not a shorter
  /// link, it is a broken image on every reference in the gallery.
  const defaulted = parseEnv(without("SIGNED_URL_TTL_SECONDS")).SIGNED_URL_TTL_SECONDS;
  assert.equal(defaulted, 900);
  assert.equal(typeof parseEnv(complete({ SIGNED_URL_TTL_SECONDS: "60" })).SIGNED_URL_TTL_SECONDS, "number");
  assert.throws(() => parseEnv(complete({ SIGNED_URL_TTL_SECONDS: "0" })));
  assert.throws(() => parseEnv(complete({ SIGNED_URL_TTL_SECONDS: "quarter of an hour" })));
});

test("the app's own origin carries a scheme, because the OAuth redirect is built from it", () => {
  /// The redirect URI has to match what the OAuth client is registered for
  /// exactly, scheme included, so an origin without one is a sign-in that fails
  /// at Google rather than here.
  assert.equal(parseEnv(without("APP_URL")).APP_URL, "http://localhost:12000");
  assert.throws(() => parseEnv(complete({ APP_URL: "localhost:12000" })), /APP_URL/);
});

test("the agent engine resource stays optional, because nothing has deployed one", () => {
  /// `agent-runtime.ts` throws on its own when this is unset (its own test
  /// holds that), which is the whole reason it must not be required here: the
  /// rest of the app runs without an Agent Engine.
  assert.equal(parseEnv(without("AGENT_ENGINE_RESOURCE")).AGENT_ENGINE_RESOURCE, undefined);
});

test("SKIP_ENV_VALIDATION trusts the source it is set on, and returns it unparsed", () => {
  /// Nine test files in this suite boot modules under this flag with two or
  /// three keys set, so what it means is load-bearing: not "validate later" but
  /// "hand back exactly what was given". The raw string here is the proof — a
  /// parsed source would have made it an object.
  const source = { SKIP_ENV_VALIDATION: "1", GOOGLE_SERVICE_ACCOUNT_JSON: "{not json" };
  assert.equal(parseEnv(source).GOOGLE_SERVICE_ACCOUNT_JSON, "{not json");
});

test("the environment is parsed once per process, and the parse is what is kept", async () => {
  /// `env()` is called on nearly every request path in the app; re-running a
  /// zod parse and a `JSON.parse` of the service account key per call is the
  /// cost the memo exists to avoid. Asserted by identity and then across a
  /// change to `process.env`, so a memo that re-reads fails the second half.
  for (const [key, value] of Object.entries(complete())) process.env[key] = value;
  const { env } = await import("@/env");

  assert.equal(env(), env());

  process.env.GCS_BUCKET = "a-different-bucket";
  assert.equal(env().GCS_BUCKET, "bucket-fixture");
});
