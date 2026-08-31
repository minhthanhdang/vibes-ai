import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolFactory } from "@/server/db";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.APP_ENV = "production";
process.env.CLOUD_SQL_INSTANCE = "test-project:test-region:test-instance";
process.env.CLOUD_SQL_USER = "user-fixture";
process.env.CLOUD_SQL_PASSWORD = "password-fixture";
process.env.CLOUD_SQL_DATABASE = "database-fixture";

const { closeDb, poolAdapter, poolConfig } = await import("@/server/db");

type ClientOptions = Parameters<typeof poolConfig>[0];
const socket = (() => undefined) as unknown as ClientOptions["stream"];
const dialled: ClientOptions = { stream: socket };

test("the connector's options are the connection — a config without them has no database in it", () => {
  assert.equal(poolConfig(dialled).stream, socket);
});

test("each credential comes from its own key, and comes from the environment rather than a literal", () => {
  const config = poolConfig(dialled);
  assert.equal(config.user, process.env.CLOUD_SQL_USER);
  assert.equal(config.password, process.env.CLOUD_SQL_PASSWORD);
  assert.equal(config.database, process.env.CLOUD_SQL_DATABASE);

  const was = process.env.CLOUD_SQL_DATABASE;
  process.env.CLOUD_SQL_DATABASE = "moved-database-fixture";
  try {
    assert.equal(poolConfig(dialled).database, "moved-database-fixture");
  } finally {
    process.env.CLOUD_SQL_DATABASE = was;
  }
});

test("the credentials win over anything the connector puts in the same slots", () => {
  const withUser = { ...dialled, user: "connector-supplied" } as ClientOptions;
  assert.equal(poolConfig(withUser).user, process.env.CLOUD_SQL_USER);
});

test("the pool is 3 connections against an instance that allows 50", () => {
  assert.equal(poolConfig(dialled).max, 3);
});

function fakePool() {
  const connection = { kind: "connect" } as unknown as Awaited<ReturnType<PoolFactory["connect"]>>;
  const shadow = { kind: "shadow" } as unknown as Awaited<ReturnType<PoolFactory["connectToShadowDb"]>>;
  let built = 0;

  const build = async () => {
    built += 1;
    return { connect: async () => connection, connectToShadowDb: async () => shadow };
  };

  return { build, connection, shadow, builds: () => built };
}

test("the adapter names itself exactly as the real adapter does", () => {
  const real = new PrismaPg({});
  const adapter = poolAdapter(fakePool().build);
  assert.equal(adapter.provider, real.provider);
  assert.equal(adapter.adapterName, real.adapterName);
});

test("building the adapter dials nothing — the pool is built on the first query, not at import", async () => {
  const pool = fakePool();
  const adapter = poolAdapter(pool.build);
  assert.equal(pool.builds(), 0);

  await adapter.connect();
  assert.equal(pool.builds(), 1);
});

test("connect and connectToShadowDb reach different halves of the pool", async () => {
  const pool = fakePool();
  const adapter = poolAdapter(pool.build);
  assert.equal(await adapter.connect(), pool.connection);
  assert.equal(await adapter.connectToShadowDb(), pool.shadow);
});

test("closing the database closes the connector, after disconnecting the client", async () => {
  const order: string[] = [];
  await closeDb(
    { $disconnect: async () => void order.push("disconnect") },
    () => void order.push("close"),
  );
  assert.deepEqual(order, ["disconnect", "close"]);
});

test("a failed disconnect still closes the connector", async () => {
  let closed = 0;
  await assert.rejects(
    closeDb(
      { $disconnect: async () => Promise.reject(new Error("connection reset")) },
      () => void (closed += 1),
    ),
    /connection reset/,
  );
  assert.equal(closed, 1);
});
