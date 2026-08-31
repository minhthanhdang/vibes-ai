import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.APP_ENV = "production";
process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id-fixture";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret-fixture";

import { deckCredential, grantRejected, type GrantDb } from "./credential";

const noGrant = () => {
  const deleted: string[] = [];
  const db = {
    googleGrant: {
      findUnique: async () => null,
      deleteMany: async ({ where }: { where: { userId: string } }) => {
        deleted.push(where.userId);
        return { count: 1 };
      },
    },
  } as unknown as GrantDb;
  return { db, deleted };
};

test("a revoked grant is recognised from the message google-auth-library throws", () => {
  assert.equal(grantRejected(new Error("invalid_grant: Token has been expired or revoked.")), true);
});

test("a revoked grant is recognised from the error body when it arrives as a response", () => {
  assert.equal(grantRejected({ response: { data: { error: "invalid_grant" } } }), true);
});

test("anything else is not a revocation, so it must not delete the user's grant", () => {
  assert.equal(grantRejected(new Error("getaddrinfo ENOTFOUND oauth2.googleapis.com")), false);
  assert.equal(grantRejected({ response: { data: { error: "invalid_client" } } }), false);
  assert.equal(grantRejected(null), false);
  assert.equal(grantRejected(undefined), false);
});

test("a user who has never consented needs consent, and nothing is asked of Google", async () => {
  const { db, deleted } = noGrant();
  assert.deepEqual(await deckCredential(db, "user_1"), { status: "needsConsent" });
  assert.deepEqual(deleted, []);
});
