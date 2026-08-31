import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "@/env";

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
  for (const key of CLOUD_SQL_KEYS) {
    assert.throws(() => parseEnv(without(key)), new RegExp(key), `${key} is not required`);
  }
});

test("each Cloud SQL value comes back from its own key", () => {
  const parsed = parseEnv(complete());
  assert.equal(parsed.CLOUD_SQL_INSTANCE, "fixture-project:fixture-region:fixture-instance");
  assert.equal(parsed.CLOUD_SQL_USER, "user-fixture");
  assert.equal(parsed.CLOUD_SQL_PASSWORD, "password-fixture");
  assert.equal(parsed.CLOUD_SQL_DATABASE, "database-fixture");
});

test("the connection string the CLI still uses has to be a URL", () => {
  assert.throws(() => parseEnv(complete({ DATABASE_URL: "vibes_ai" })), /DATABASE_URL/);
});

test("the location defaults to global, because that is where gemini-3.x is served", () => {
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
  assert.deepEqual(parseEnv(complete()).GOOGLE_SERVICE_ACCOUNT_JSON, KEY);
});

test("a key that is not JSON fails the environment rather than the first call", () => {
  assert.throws(
    () => parseEnv(complete({ GOOGLE_SERVICE_ACCOUNT_JSON: "{not json" })),
    /GOOGLE_SERVICE_ACCOUNT_JSON/,
  );
});

test("a key missing a field, or with a client_email that is not one, is not a key", () => {
  const noPrivateKey = { ...KEY, private_key: "" };
  const notAnEmail = { ...KEY, client_email: "fixture-service-account" };
  assert.throws(() => parseEnv(complete({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(noPrivateKey) })));
  assert.throws(() => parseEnv(complete({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(notAnEmail) })));
});

test("a blank worker secret disables the endpoint instead of failing every run", () => {
  assert.equal(parseEnv(complete({ ANALYZER_WORKER_SECRET: "" })).ANALYZER_WORKER_SECRET, undefined);
  assert.equal(parseEnv(complete({ ANALYZER_WORKER_SECRET: "   " })).ANALYZER_WORKER_SECRET, undefined);
  assert.equal(parseEnv(without("ANALYZER_WORKER_SECRET")).ANALYZER_WORKER_SECRET, undefined);
  assert.equal(parseEnv(complete({ VIBES_WORKER_SECRET: "" })).VIBES_WORKER_SECRET, undefined);
  assert.equal(parseEnv(complete({ VIBES_WORKER_SECRET: "   " })).VIBES_WORKER_SECRET, undefined);
  assert.equal(parseEnv(without("VIBES_WORKER_SECRET")).VIBES_WORKER_SECRET, undefined);
});

test("a worker secret short enough to guess is rejected, not accepted quietly", () => {
  assert.throws(() => parseEnv(complete({ ANALYZER_WORKER_SECRET: "tooshort" })), /ANALYZER_WORKER_SECRET/);
  assert.equal(
    parseEnv(complete({ ANALYZER_WORKER_SECRET: "0123456789abcdef" })).ANALYZER_WORKER_SECRET,
    "0123456789abcdef",
  );
  assert.throws(() => parseEnv(complete({ VIBES_WORKER_SECRET: "tooshort" })), /VIBES_WORKER_SECRET/);
  assert.equal(
    parseEnv(complete({ VIBES_WORKER_SECRET: "0123456789abcdef" })).VIBES_WORKER_SECRET,
    "0123456789abcdef",
  );
});

test("an unset judges code closes the judges path, rather than opening it", () => {
  assert.equal(parseEnv(without("JUDGE_SIGNUP_CODES")).JUDGE_SIGNUP_CODES, undefined);
  assert.equal(parseEnv(complete({ JUDGE_SIGNUP_CODES: "" })).JUDGE_SIGNUP_CODES, undefined);
  assert.equal(parseEnv(complete({ JUDGE_SIGNUP_CODES: "   " })).JUDGE_SIGNUP_CODES, undefined);
});

test("a judges code short enough to guess fails the environment, and so does one of a list", () => {
  assert.throws(() => parseEnv(complete({ JUDGE_SIGNUP_CODES: "letmein" })), /JUDGE_SIGNUP_CODES/);
  assert.throws(
    () => parseEnv(complete({ JUDGE_SIGNUP_CODES: `${"a".repeat(24)},short` })),
    /JUDGE_SIGNUP_CODES/,
  );
});

test("a list of long codes is kept whole, so one can be rotated per judging group", () => {
  const codes = `${"a".repeat(24)},${"b".repeat(30)}`;
  assert.equal(parseEnv(complete({ JUDGE_SIGNUP_CODES: codes })).JUDGE_SIGNUP_CODES, codes);
});

test("a blank transcript directory counts as unset, which is the state every deployment is in", () => {
  assert.equal(parseEnv(without("AGENT_TRANSCRIPT_DIR")).AGENT_TRANSCRIPT_DIR, undefined);
  assert.equal(parseEnv(complete({ AGENT_TRANSCRIPT_DIR: "" })).AGENT_TRANSCRIPT_DIR, undefined);
  assert.equal(parseEnv(complete({ AGENT_TRANSCRIPT_DIR: "   " })).AGENT_TRANSCRIPT_DIR, undefined);
  assert.equal(
    parseEnv(complete({ AGENT_TRANSCRIPT_DIR: ".transcripts" })).AGENT_TRANSCRIPT_DIR,
    ".transcripts",
  );
});

test("the signed-URL TTL is a positive number of seconds, defaulting to fifteen minutes", () => {
  const defaulted = parseEnv(without("SIGNED_URL_TTL_SECONDS")).SIGNED_URL_TTL_SECONDS;
  assert.equal(defaulted, 900);
  assert.equal(typeof parseEnv(complete({ SIGNED_URL_TTL_SECONDS: "60" })).SIGNED_URL_TTL_SECONDS, "number");
  assert.throws(() => parseEnv(complete({ SIGNED_URL_TTL_SECONDS: "0" })));
  assert.throws(() => parseEnv(complete({ SIGNED_URL_TTL_SECONDS: "quarter of an hour" })));
});

test("the app's own origin carries a scheme, because the OAuth redirect is built from it", () => {
  assert.equal(parseEnv(without("APP_URL")).APP_URL, "http://localhost:12000");
  assert.throws(() => parseEnv(complete({ APP_URL: "localhost:12000" })), /APP_URL/);
});

test("the agent engine resource stays optional, because nothing has deployed one", () => {
  assert.equal(parseEnv(without("AGENT_ENGINE_RESOURCE")).AGENT_ENGINE_RESOURCE, undefined);
});

test("SKIP_ENV_VALIDATION trusts the source it is set on, and returns it unparsed", () => {
  const source = { SKIP_ENV_VALIDATION: "1", GOOGLE_SERVICE_ACCOUNT_JSON: "{not json" };
  assert.equal(parseEnv(source).GOOGLE_SERVICE_ACCOUNT_JSON, "{not json");
});

test("the environment is parsed once per process, and the parse is what is kept", async () => {
  for (const [key, value] of Object.entries(complete())) process.env[key] = value;
  const { env } = await import("@/env");

  assert.equal(env(), env());

  process.env.GCS_BUCKET = "a-different-bucket";
  assert.equal(env().GCS_BUCKET, "bucket-fixture");
});
