import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id-fixture";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret-fixture";

async function door(appEnv: string | undefined) {
  if (appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = appEnv;
  return import("./google");
}

test("production is the environment the Google door is open in", async () => {
  const { googleSignInOpen } = await door("production");
  assert.equal(googleSignInOpen(), true);
});

test("development closes it, so the only way in is an email and a password", async () => {
  const { googleSignInOpen } = await door("development");
  assert.equal(googleSignInOpen(), false);
});

test("an unset switch is not development, so a deployment behaves as it does today", async () => {
  const { googleSignInOpen } = await door(undefined);
  assert.equal(googleSignInOpen(), true);
});

test("the open door hands back the pair itself, so a route and a panel cannot disagree", async () => {
  const { googleOauth } = await door("production");
  assert.deepEqual(googleOauth(), {
    clientId: "client-id-fixture",
    clientSecret: "client-secret-fixture",
  });
});

test("the closed door hands back nothing rather than a half-built client", async () => {
  const { googleOauth } = await door("development");
  assert.equal(googleOauth(), null);
});

test("a flow past a closed door throws rather than bouncing the user at Google", async () => {
  const { authorizeUrl } = await door("development");
  assert.throws(
    () => authorizeUrl({ state: "s", codeChallenge: "c" }),
    /the Google door is closed/,
  );
});

test("the same call past an open door builds an authorize URL carrying the client id", async () => {
  const { authorizeUrl } = await door("production");
  const url = new URL(authorizeUrl({ state: "s", codeChallenge: "c" }));
  assert.equal(url.searchParams.get("client_id"), "client-id-fixture");
  assert.equal(url.searchParams.get("state"), "s");
});
