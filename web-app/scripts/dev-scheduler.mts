import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const INTERVAL_MS = 3_000;
const ATTEMPT_DEADLINE_MS = 300_000;

const appUrl = process.env.APP_URL?.trim() || "http://localhost:12000";

const workers = [
  { name: "vibes", path: "/api/agents/vibes/worker", secret: secret("VIBES_WORKER_SECRET") },
  { name: "analyzer", path: "/api/agents/analyzer/worker", secret: secret("ANALYZER_WORKER_SECRET") },
].filter((worker) => worker.secret !== null);

function secret(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (value.length < 16) {
    console.error(`${name} is shorter than the 16 chars env.ts requires — the route will 503`);
    process.exit(1);
  }
  return value;
}

if (workers.length === 0) {
  console.error(
    "Neither VIBES_WORKER_SECRET nor ANALYZER_WORKER_SECRET is set in .env.local — " +
      "without one the routes are disabled and there is nothing to tick.",
  );
  process.exit(1);
}

console.log(
  `ticking ${workers.map((worker) => worker.name).join(" + ")} at ${appUrl} every ${INTERVAL_MS / 1000}s`,
);

function tick() {
  for (const worker of workers) {
    const at = new Date().toISOString();
    void fetch(new URL(worker.path, appUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${worker.secret}` },
      signal: AbortSignal.timeout(ATTEMPT_DEADLINE_MS),
    })
      .then(async (response) => {
        const body = (await response.text()).slice(0, 200);
        console.log(`${at} ${worker.name} ${response.status} ${body}`);
      })
      .catch((cause: unknown) => {
        const reason = cause instanceof Error ? cause.message : String(cause);
        console.log(`${at} ${worker.name} unreachable (${reason}) — is next dev up?`);
      });
  }
}

tick();
setInterval(tick, INTERVAL_MS);
