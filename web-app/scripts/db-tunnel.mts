/// A Cloud SQL Auth Proxy that is already in the dependency tree.
///
///   npm run db:tunnel                 # then, in another terminal:
///   DATABASE_URL="$(npm run -s db:tunnel:url)" npm run db:deploy
///
/// `prisma migrate`/`studio` do not go through `server/db.ts` — they read
/// `DATABASE_URL` through `prisma.config.ts` and open ordinary TCP, so the
/// connector's socket factory never reaches them (tech-spec §VIII.2). The
/// documented bridge is the `cloud-sql-proxy` binary, which is not installed
/// here and is a second copy of a connector this repo already ships.
///
/// So: listen on loopback and hand every accepted socket to the same
/// `Connector` the app will use. That is all the proxy binary is. The mTLS,
/// the cert refresh and the Admin API lookup are the connector's, which means
/// this bridge exercises the cutover's own credential path rather than a
/// parallel one.
///
/// A TCP listener rather than the connector's own `startLocalProxy`, which
/// listens on a Unix socket: Prisma reaches one only through a `?host=<dir>`
/// parameter whose directory has to be named for the instance, colons and all.
///
/// Dev-only, and deliberately not a dependency of anything that deploys.

import { config } from "dotenv";
import net from "node:net";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const PORT = Number(process.env.DB_TUNNEL_PORT ?? 5433);

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set — see context/infra.md §XVI for the four CLOUD_SQL_* keys`);
    process.exit(1);
  }
  return value;
}

const instanceConnectionName = required("CLOUD_SQL_INSTANCE");
const user = required("CLOUD_SQL_USER");
const password = required("CLOUD_SQL_PASSWORD");
const database = required("CLOUD_SQL_DATABASE");

/// The URL the CLI should be pointed at. `sslmode=disable` is about the
/// loopback hop only: the connector has already wrapped the real hop to Cloud
/// SQL in mTLS, and asking `pg` to negotiate TLS again with a listener that
/// speaks none would fail on the first byte.
const url = `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${PORT}/${database}?sslmode=disable`;

if (process.argv.includes("--url")) {
  console.log(url);
  process.exit(0);
}

/// Imported after the `--url` exit so printing the URL needs none of the app's
/// environment: `server-only` modules pull in `src/env.ts`, which fails loudly
/// on any missing key.
const { cloudSqlOptions, closeCloudSql } = await import("../src/server/google/cloud-sql");

const clientOpts = await cloudSqlOptions(instanceConnectionName);

const server = net.createServer((client) => {
  const upstream = clientOpts.stream();
  client.on("error", () => upstream.destroy());
  upstream.on("error", (error: Error) => {
    console.error(`upstream: ${error.message}`);
    client.destroy();
  });
  client.pipe(upstream).pipe(client);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`tunnel -> ${instanceConnectionName}`);
  console.log(`DATABASE_URL="${url.replace(encodeURIComponent(password), "***")}"`);
  console.log("ready");
});

function shutdown() {
  server.close();
  closeCloudSql();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
