import { test } from "node:test";
import assert from "node:assert/strict";

import { dummyPasswordHash, hashPassword, verifyPassword } from "./password";

const PLAIN = "correct horse battery staple";

test("a password verifies against its own hash", async () => {
  const stored = await hashPassword(PLAIN);
  assert.ok(await verifyPassword(PLAIN, stored));
});

test("the stored string carries the parameters, so the cost can be raised later", async () => {
  const stored = await hashPassword(PLAIN);
  const segments = stored.split("$");
  assert.equal(segments.length, 6);
  assert.equal(segments[0], "scrypt");
  assert.equal(segments[1], "16384");
  assert.equal(segments[2], "8");
  assert.equal(segments[3], "1");
});

test("two hashes of one password differ, because the salt is fresh each time", async () => {
  assert.notEqual(await hashPassword(PLAIN), await hashPassword(PLAIN));
});

test("a wrong password does not verify", async () => {
  const stored = await hashPassword(PLAIN);
  assert.ok(!(await verifyPassword("correct horse battery stapl", stored)));
  assert.ok(!(await verifyPassword("", stored)));
  assert.ok(!(await verifyPassword(`${PLAIN} `, stored)));
});

test("a tampered salt does not verify", async () => {
  const [scheme, cost, blockSize, parallelism, salt, key] = (await hashPassword(PLAIN)).split("$");
  const flipped = `${salt.slice(0, -1)}${salt.endsWith("A") ? "B" : "A"}`;
  const stored = [scheme, cost, blockSize, parallelism, flipped, key].join("$");
  assert.ok(!(await verifyPassword(PLAIN, stored)));
});

test("a tampered parameter does not verify", async () => {
  const [scheme, , blockSize, parallelism, salt, key] = (await hashPassword(PLAIN)).split("$");
  const stored = [scheme, "8192", blockSize, parallelism, salt, key].join("$");
  assert.ok(!(await verifyPassword(PLAIN, stored)));
});

test("a malformed stored string comes back false rather than throwing", async () => {
  for (const stored of [
    "",
    "scrypt",
    "scrypt$16384$8$1$salt",
    "scrypt$16384$8$1$salt$key$extra",
    "argon2id$16384$8$1$c2FsdA$a2V5",
    "scrypt$0$8$1$c2FsdA$a2V5",
    "scrypt$-1$8$1$c2FsdA$a2V5",
    "scrypt$abc$8$1$c2FsdA$a2V5",
    "scrypt$16384$8$1$$a2V5",
    "scrypt$16384$8$1$c2FsdA$",
    "scrypt$16384$8$1$not base64!$a2V5",
  ]) {
    assert.equal(await verifyPassword(PLAIN, stored), false, stored);
  }
});

test("an absurd cost is refused rather than exhausting memory", async () => {
  assert.equal(await verifyPassword(PLAIN, "scrypt$99999999$8$1$c2FsdA$a2V5"), false);
});

test("the dummy hash is a real hash nothing verifies against, and is minted once", async () => {
  const first = await dummyPasswordHash();
  assert.equal(first, await dummyPasswordHash());
  assert.ok(first.startsWith("scrypt$"));
  assert.ok(!(await verifyPassword(PLAIN, first)));
  assert.ok(!(await verifyPassword("", first)));
});
