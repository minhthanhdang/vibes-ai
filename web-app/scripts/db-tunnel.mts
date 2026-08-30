import { config } from "dotenv";
import net from "node:net";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const PORT = Number(process.env.DB_TUNNEL_PORT ?? 5433);

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set — see context/infra.md for the four CLOUD_SQL_* keys`);
    process.exit(1);
  }
  return value;
}

const instanceConnectionName = required("CLOUD_SQL_INSTANCE");
const user = required("CLOUD_SQL_USER");
const password = required("CLOUD_SQL_PASSWORD");
const database = required("CLOUD_SQL_DATABASE");

const url = `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${PORT}/${database}?sslmode=disable`;

if (process.argv.includes("--url")) {
  console.log(url);
  process.exit(0);
}

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
