import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { grantPayload, grantRefused, grantToken, grantUrl, verifyGrant } = await import(
  "@/server/storage/dev-signing"
);

const SECRET = "a-dev-signing-secret";
const NOW = Date.UTC(2026, 7, 30, 12, 30);

const read = {
  bucket: "vibes-dev-local",
  object: "projects/p1/references/a.png",
  method: "GET" as const,
  accessibleAt: Date.UTC(2026, 7, 30, 12),
  expires: Date.UTC(2026, 7, 31, 13),
};

const write = {
  bucket: "vibes-dev-local",
  object: "projects/p1/references/b.png",
  method: "PUT" as const,
  contentType: "image/png",
  cacheControl: "public, max-age=31536000, immutable",
  accessibleAt: 0,
  expires: NOW + 900_000,
};

function checked(url: string, at: { bucket: string; object: string; method: "GET" | "PUT" }, headers?: Headers) {
  const token = new URL(url).searchParams.get("t");
  return verifyGrant(token, SECRET, { ...at, headers, now: NOW });
}

test("the same grant signs the same bytes, which is what makes a read URL deterministic", () => {
  assert.equal(grantUrl("http://localhost:12000", read, SECRET), grantUrl("http://localhost:12000", read, SECRET));
});

test("the payload is a joined string, so no key ordering can move under a refactor", () => {
  assert.equal(grantPayload(read).split("\n").length, 8);
  assert.equal(grantPayload(read).startsWith("v1\nvibes-dev-local\n"), true);
});

test("the URL routes by path and authorises by token, and the two carry the same object", () => {
  const url = grantUrl("http://localhost:12000", read, SECRET);
  assert.equal(
    new URL(url).pathname,
    "/api/dev-storage/vibes-dev-local/projects/p1/references/a.png",
  );

  const grant = checked(url, read);
  assert.equal(grantRefused(grant), false);
});

test("a token for one object does not open another, however well signed it is", () => {
  const url = grantUrl("http://localhost:12000", read, SECRET);
  const grant = checked(url, { ...read, object: "projects/p2/references/secret.png" });
  assert.equal(grantRefused(grant) && grant.refused.includes("not this object"), true);
});

test("a token signed by another store, or edited after signing, is refused", () => {
  const url = grantUrl("http://localhost:12000", read, "a-different-secret");
  assert.equal(grantRefused(checked(url, read)), true);

  const good = new URL(grantUrl("http://localhost:12000", read, SECRET));
  const [payload, signature] = good.searchParams.get("t")!.split(".");
  const edited = `${Buffer.from(grantPayload({ ...read, expires: read.expires + 1 })).toString("base64url")}.${signature}`;
  assert.notEqual(payload, edited.split(".")[0]);
  assert.equal(grantRefused(verifyGrant(edited, SECRET, { ...read, now: NOW })), true);
});

test("a read grant does not double as a write one", () => {
  const url = grantUrl("http://localhost:12000", read, SECRET);
  const grant = checked(url, { ...read, method: "PUT" });
  assert.equal(grantRefused(grant) && grant.refused.includes("for GET"), true);
});

test("a grant is refused before it opens and after it expires", () => {
  const token = grantToken(read, SECRET);
  const early = verifyGrant(token, SECRET, { ...read, now: read.accessibleAt - 1 });
  const late = verifyGrant(token, SECRET, { ...read, now: read.expires + 1 });
  assert.equal(grantRefused(early) && early.refused.includes("not accessible yet"), true);
  assert.equal(grantRefused(late) && late.refused.includes("expired"), true);
});

test("a missing token is a named refusal rather than a throw", () => {
  for (const token of [null, undefined, "", "not-a-token"]) {
    assert.equal(grantRefused(verifyGrant(token, SECRET, { ...read, now: NOW })), true, String(token));
  }
});

test("every header the grant signed is matched exactly, and the upload that signs both must send both", () => {
  const url = grantUrl("http://localhost:12000", write, SECRET);

  const both = new Headers({ "Content-Type": "image/png", "Cache-Control": write.cacheControl });
  assert.equal(grantRefused(checked(url, write, both)), false);

  const onlyType = new Headers({ "Content-Type": "image/png" });
  assert.equal(grantRefused(checked(url, write, onlyType)), true);

  const wrongType = new Headers({ "Content-Type": "image/jpeg", "Cache-Control": write.cacheControl });
  assert.equal(grantRefused(checked(url, write, wrongType)), true);
});

test("a header the grant did not sign is ignored, because GCS canonicalises only what it signed", () => {
  const typeOnly = { ...write, cacheControl: undefined };
  const url = grantUrl("http://localhost:12000", typeOnly, SECRET);

  const spare = new Headers({
    "Content-Type": "image/png",
    "Cache-Control": "no-store",
    "X-Whatever": "1",
  });
  assert.equal(grantRefused(checked(url, typeOnly, spare)), false);
});
