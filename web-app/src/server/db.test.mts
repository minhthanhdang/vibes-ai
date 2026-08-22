import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolFactory } from "@/server/db";

/// The database path's last unwatched file. `db-path.test.mts` holds its two
/// source rules — one module may name the connector, and the CLI's own
/// connection string stays the CLI's — `cloud-sql.test.mts` holds the dial, and
/// `once.test.mts` holds the caching. Between them sat `db.ts`, which decides
/// what the pool is actually made of and had nothing on it at all.
///
/// (That second rule is a scan for a name, and it reads comments too: spelling
/// the environment key out here would put this file on its list.)
///
/// Everything below was verified breakable with 2,014 cases green: `max` raised
/// from 3 to the instance's whole ceiling of 50, `user` and `database` swapped
/// into each other's slots, `password` dropped, the connector's options left out
/// of the spread entirely (an app with no connection at all), `connectToShadowDb`
/// wired to `connect`, `provider` misspelt `postgresql`, and `closeCloudSql`
/// dropped from `closeDb`. None of the eight failed a single case.
///
/// `env()` memoises `process.env` itself under this flag rather than a parsed
/// copy, so a value moved between assertions is read by the next call — which is
/// what tells a config derived per build apart from one frozen at import.
process.env.SKIP_ENV_VALIDATION = "1";
process.env.CLOUD_SQL_INSTANCE = "test-project:test-region:test-instance";
process.env.CLOUD_SQL_USER = "user-fixture";
process.env.CLOUD_SQL_PASSWORD = "password-fixture";
process.env.CLOUD_SQL_DATABASE = "database-fixture";

const { closeDb, poolAdapter, poolConfig } = await import("@/server/db");

/// Never dialled: `{ stream }` is a socket factory, and the point of the fixture
/// is that no socket is ever opened through it.
type ClientOptions = Parameters<typeof poolConfig>[0];
const socket = (() => undefined) as unknown as ClientOptions["stream"];
const dialled: ClientOptions = { stream: socket };

test("the connector's options are the connection — a config without them has no database in it", () => {
  /// tech-spec §VIII: `getOptions()` returns `{ stream }` and not the
  /// `{host, port, ssl}` the connector's README describes, so the spread that
  /// looks like it carries nothing is the entire route to the instance. Dropping
  /// it leaves a `pg` config that typechecks, reads plausibly, and connects to
  /// no machine.
  assert.equal(poolConfig(dialled).stream, socket);
});

test("each credential comes from its own key, and comes from the environment rather than a literal", () => {
  const config = poolConfig(dialled);
  assert.equal(config.user, process.env.CLOUD_SQL_USER);
  assert.equal(config.password, process.env.CLOUD_SQL_PASSWORD);
  assert.equal(config.database, process.env.CLOUD_SQL_DATABASE);

  /// Three same-shaped strings that read equally well in each other's slots, so
  /// the assertions above only separate them because the fixtures differ. And
  /// asserted a second time across a move, because a config assembled at import
  /// would satisfy the first round and never see the second.
  const was = process.env.CLOUD_SQL_DATABASE;
  process.env.CLOUD_SQL_DATABASE = "moved-database-fixture";
  try {
    assert.equal(poolConfig(dialled).database, "moved-database-fixture");
  } finally {
    process.env.CLOUD_SQL_DATABASE = was;
  }
});

test("the credentials win over anything the connector puts in the same slots", () => {
  /// The spread is first for a reason. `getOptions()` is documented to return
  /// connection details and measured to return only a socket factory (§VIII); if
  /// a connector release starts returning a `user` too, the environment's is
  /// still the one that authenticates.
  const withUser = { ...dialled, user: "connector-supplied" } as ClientOptions;
  assert.equal(poolConfig(withUser).user, process.env.CLOUD_SQL_USER);
});

test("the pool is 3 connections against an instance that allows 50", () => {
  /// infra §XVI: `max_connections = 50` on a `db-g1-small`. Vercel gives every
  /// warm function instance its own pool and the analyzer worker is a second
  /// concurrent client, so the ceiling is shared by a number of pools nobody
  /// counts — which is why this is 3 and not "50, we are the only client".
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
  /// `postgresql` is the provider spelling in `schema.prisma` and is the wrong
  /// one here; Prisma reconciles the two names itself and rejects the pair
  /// inside `new PrismaClient()`, so that mutation takes this whole file down at
  /// import rather than failing one case. This asserts the weaker half it can
  /// assert — that neither string is written down a second time, which is what
  /// would let the two drift after an adapter release renames one.
  const real = new PrismaPg({});
  const adapter = poolAdapter(fakePool().build);
  assert.equal(adapter.provider, real.provider);
  assert.equal(adapter.adapterName, real.adapterName);
});

test("building the adapter dials nothing — the pool is built on the first query, not at import", async () => {
  /// The whole reason this indirection exists: `db` is a synchronous singleton
  /// every route imports, and the pool behind it can only be built by awaiting
  /// the Admin API. A process that never queries must never mint a cert.
  const pool = fakePool();
  const adapter = poolAdapter(pool.build);
  assert.equal(pool.builds(), 0);

  await adapter.connect();
  assert.equal(pool.builds(), 1);
});

test("connect and connectToShadowDb reach different halves of the pool", async () => {
  /// The shadow database is a real one Prisma creates and drops around a
  /// migration diff. Wiring it to `connect()` gives back the live pool, and the
  /// script that follows runs against production.
  const pool = fakePool();
  const adapter = poolAdapter(pool.build);
  assert.equal(await adapter.connect(), pool.connection);
  assert.equal(await adapter.connectToShadowDb(), pool.shadow);
});

test("closing the database closes the connector, after disconnecting the client", async () => {
  /// Prisma's disconnect is not the whole shutdown: the connector holds a
  /// cert-refresh timer, so a CLI that disconnects and stops there hangs on an
  /// empty event loop. Order matters the other way round too — closing the
  /// connector first pulls the socket factory out from under a client that is
  /// still finishing its queries.
  const order: string[] = [];
  await closeDb(
    { $disconnect: async () => void order.push("disconnect") },
    () => void order.push("close"),
  );
  assert.deepEqual(order, ["disconnect", "close"]);
});

test("a failed disconnect still closes the connector", async () => {
  /// Otherwise the failure arrives as a script that never exits rather than as
  /// the error it is — the timer outlives the client it was opened for.
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
