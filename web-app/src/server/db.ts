import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/env";
import { closeCloudSql, cloudSqlOptions } from "@/server/google/cloud-sql";
import { buildOnce } from "@/lib/util/once";

/// Postgres is reached through the Cloud SQL connector rather than a host and
/// port (tech-spec §VIII): it mints short-lived certs against the Admin API, so
/// there is no password on the wire to the instance and no IP allowlist to keep
/// in step with Vercel's moving egress IPs. It is handed the same `GoogleAuth`
/// that reaches Vertex and GCS, so one credential serves all three.
///
/// `max` is 3 against the instance's ceiling of 50 (infra §XVI). Vercel gives
/// every warm function instance its own pool, and the analyzer worker is a
/// second concurrent client draining jobs while the UI serves requests.
const POOL_MAX = 3;

/// Derived from the module that dials rather than imported from the connector
/// package: `db-path.test.mts` holds that `cloud-sql.ts` is the only file in the
/// app that names it, and a type-only import is still a name to a source scan.
type SqlClientOptions = Awaited<ReturnType<typeof cloudSqlOptions>>;

/// Assembled here, and exported, because everything that makes this config
/// right is invisible from its one call site: the spread carries the
/// connector's `{ stream }` socket factory and *is* the connection (a `pg`
/// config with no hostname in it is correct — tech-spec §VIII), and the three
/// credentials are three same-shaped strings that read equally well in each
/// other's slots. Reading it needs no Admin API call; building the pool it goes
/// into does.
export function poolConfig(clientOpts: SqlClientOptions) {
  return {
    ...clientOpts,
    user: env().CLOUD_SQL_USER,
    password: env().CLOUD_SQL_PASSWORD,
    database: env().CLOUD_SQL_DATABASE,
    max: POOL_MAX,
  };
}

/// `getOptions()` is async — it resolves the instance and mints the certs —
/// while `db` is the synchronous singleton every caller already imports. The
/// await therefore lives behind the factory Prisma calls on first query, not at
/// module load: nothing downstream moves, and a process that never queries
/// never dials the Admin API.
///
/// `buildOnce` rather than `??=` because that first query dials a network. One
/// pool and one cert-refresh loop is the point, but a rejected promise is not
/// nullish: `??=` would keep a cold start's lost Admin API call and re-throw it
/// at every query for as long as Vercel keeps that instance warm, turning a
/// dropped packet into an outage no deploy triggered and no retry can clear.
const pool = buildOnce(async () => new PrismaPg(poolConfig(await cloudSqlOptions(env().CLOUD_SQL_INSTANCE))));

/// Prisma wants a factory it can call synchronously; the pool behind it can
/// only be built by awaiting the Admin API. This is the adapter that bridges
/// the two. The `provider`/`adapterName` pair is read off `PrismaPg` rather
/// than written down a second time: Prisma checks it against the schema's
/// datasource inside `new PrismaClient()`, and the schema spells that provider
/// `postgresql` while the adapter reports `postgres` — so the obvious-looking
/// correction is the one that throws at boot.
///
/// Takes the pool as an argument so it can be driven by one that never dials.
/// `Pick` rather than `PrismaPg` for the same reason `cloud-sql.ts` picks off
/// `Connector`: the class brands with private fields, so nothing but itself is
/// assignable to it, and these two methods are the whole of what Prisma calls.
export type PoolFactory = Pick<PrismaPg, "connect" | "connectToShadowDb">;

export function poolAdapter(build: () => Promise<PoolFactory>) {
  /// Both strings are instance fields, not statics, and the constructor is
  /// inert — it stores the config and nothing else, no pool until `connect()`.
  const naming = new PrismaPg({});
  return {
    provider: naming.provider,
    adapterName: naming.adapterName,
    connect: async () => (await build()).connect(),
    connectToShadowDb: async () => (await build()).connectToShadowDb(),
  } as const;
}

function createClient() {
  return new PrismaClient({
    adapter: poolAdapter(pool),
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/// For CLI entry points, which are the only callers that ever want the process
/// to end: the connector holds a cert-refresh timer, so disconnecting Prisma
/// alone leaves `npm run floor` and friends hanging on an empty event loop.
///
/// Both halves are parameters for the same reason `cloud-sql.ts` takes its
/// connector: the real ones end the process's database life, so an assertion
/// that the connector is closed *after* the client is disconnected — and not
/// instead of it — cannot be made against them.
export async function closeDb(
  client: Pick<PrismaClient, "$disconnect"> = db,
  close: () => void = closeCloudSql,
) {
  /// `finally` because the connector's refresh timer is what holds the event
  /// loop open: a `$disconnect` that rejects and skips the close leaves the CLI
  /// hanging on a timer with no database behind it, which reads as a wedged
  /// script rather than as the error it is.
  try {
    await client.$disconnect();
  } finally {
    close();
  }
}
