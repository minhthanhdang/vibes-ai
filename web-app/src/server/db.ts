import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/env";
import { closeCloudSql, cloudSqlOptions } from "@/server/google/cloud-sql";

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

/// `getOptions()` is async — it resolves the instance and the certs — while
/// `db` is the synchronous singleton every caller already imports. The await
/// therefore lives behind the factory Prisma calls on first query, not at
/// module load: nothing downstream moves, and a process that never queries
/// never dials the Admin API.
let connecting: Promise<PrismaPg> | undefined;

async function cloudSqlPool() {
  const clientOpts = await cloudSqlOptions(env().CLOUD_SQL_INSTANCE);
  return new PrismaPg({
    ...clientOpts,
    user: env().CLOUD_SQL_USER,
    password: env().CLOUD_SQL_PASSWORD,
    database: env().CLOUD_SQL_DATABASE,
    max: POOL_MAX,
  });
}

function pool() {
  return (connecting ??= cloudSqlPool());
}

const adapter = {
  provider: "postgres",
  adapterName: "@prisma/adapter-pg",
  connect: async () => (await pool()).connect(),
  connectToShadowDb: async () => (await pool()).connectToShadowDb(),
} as const;

function createClient() {
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/// For CLI entry points, which are the only callers that ever want the process
/// to end: the connector holds a cert-refresh timer, so disconnecting Prisma
/// alone leaves `npm run floor` and friends hanging on an empty event loop.
export async function closeDb() {
  await db.$disconnect();
  closeCloudSql();
}
