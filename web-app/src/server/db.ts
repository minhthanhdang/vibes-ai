import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { cloudEnv } from "@/env";
import { closeCloudSql, cloudSqlOptions } from "@/server/google/cloud-sql";
import { buildOnce } from "@/lib/util/once";

const POOL_MAX = 3;

type SqlClientOptions = Awaited<ReturnType<typeof cloudSqlOptions>>;

export function poolConfig(clientOpts: SqlClientOptions) {
  return {
    ...clientOpts,
    user: cloudEnv().CLOUD_SQL_USER,
    password: cloudEnv().CLOUD_SQL_PASSWORD,
    database: cloudEnv().CLOUD_SQL_DATABASE,
    max: POOL_MAX,
  };
}

const pool = buildOnce(async () => new PrismaPg(poolConfig(await cloudSqlOptions(cloudEnv().CLOUD_SQL_INSTANCE))));

export type PoolFactory = Pick<PrismaPg, "connect" | "connectToShadowDb">;

export function poolAdapter(build: () => Promise<PoolFactory>) {
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

export async function closeDb(
  client: Pick<PrismaClient, "$disconnect"> = db,
  close: () => void = closeCloudSql,
) {
  try {
    await client.$disconnect();
  } finally {
    close();
  }
}
