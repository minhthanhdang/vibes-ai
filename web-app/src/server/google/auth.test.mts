import { test } from "node:test";
import assert from "node:assert/strict";
import { TEST, filesNaming, sourceFiles } from "./source-tree";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.APP_ENV = "production";
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"a@b.iam.gserviceaccount.com"}';
process.env.GOOGLE_CLOUD_PROJECT = "test-project";

const { accessToken, googleAuth, googleAuthOptions } = await import("@/server/google/auth");

test("the key is passed inline, because there is no file on Vercel to point at", () => {
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
  assert.equal(googleAuthOptions().projectId, process.env.GOOGLE_CLOUD_PROJECT);
});

test("one scope, and it is the one that covers Vertex, GCS and Cloud SQL Admin", () => {
  assert.deepEqual(googleAuthOptions().scopes, ["https://www.googleapis.com/auth/cloud-platform"]);
});

test("the process holds one client, because a client per call is a token cache per call", () => {
  assert.equal(googleAuth(), googleAuth());
});

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
  await assert.rejects(
    () => minting(null, accessToken),
    /failed to mint a Google access token/,
  );
});

test("an empty string is nothing minted too", async () => {
  await assert.rejects(
    () => minting("", accessToken),
    /failed to mint a Google access token/,
  );
});

const MAY_DERIVE_CREDENTIALS = [
  "src/env.ts",
  "src/server/google/auth.ts",
  "src/server/google/storage.ts",
];

test("the service-account key is read in the places that build a client from it, and nowhere else", async () => {
  const app = (await sourceFiles("src", "scripts")).filter((path) => !TEST.test(path));

  assert.deepEqual(
    await filesNaming("GOOGLE_SERVICE_ACCOUNT_JSON", app),
    [...MAY_DERIVE_CREDENTIALS].sort(),
  );
});
