import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id-fixture";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret-fixture";
process.env.APP_URL = "https://vibes.test";

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

test("the deck grant asks for the two Slides scopes on top of sign-in's own", async () => {
  const { DECK_SCOPES, authorizeUrl } = await door("production");
  const url = new URL(authorizeUrl({ state: "s", codeChallenge: "c", scopes: DECK_SCOPES, offline: true }));
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/drive.file",
  ]);
});

test("an offline grant forces consent, because Google withholds a refresh token otherwise", async () => {
  const { authorizeUrl } = await door("production");
  const url = new URL(authorizeUrl({ state: "s", codeChallenge: "c", offline: true }));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
});

test("a sign-in stays online and keeps the account picker it has always shown", async () => {
  const { authorizeUrl } = await door("production");
  const url = new URL(authorizeUrl({ state: "s", codeChallenge: "c" }));
  assert.equal(url.searchParams.get("access_type"), null);
  assert.equal(url.searchParams.get("prompt"), "select_account");
});

test("a pending flow remembers it was a grant, so the callback never re-keys the session", async () => {
  const { pendingFlowCookie, readPendingFlow } = await door("production");
  const cookie = pendingFlowCookie({ state: "s", codeVerifier: "v", next: "/projects/p", grant: true });
  const read = readPendingFlow({
    cookies: { get: () => ({ value: cookie.value }) },
  } as unknown as Parameters<typeof readPendingFlow>[0]);
  assert.equal(read?.grant, true);
  assert.equal(read?.next, "/projects/p");
});
