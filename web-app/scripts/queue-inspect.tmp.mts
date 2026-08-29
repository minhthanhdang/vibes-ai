import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const { db, closeDb } = await import("../src/server/db");

const rows = await db.agentRun.findMany({
  where: { agent: "VIBES" },
  orderBy: { startedAt: "desc" },
  take: 20,
  select: {
    id: true,
    status: true,
    input: true,
    output: true,
    error: true,
    startedAt: true,
    finishedAt: true,
  },
});
for (const r of rows) {
  console.log(
    r.status.padEnd(10),
    JSON.stringify(r.input),
    "started", r.startedAt?.toISOString() ?? "-",
    "finished", r.finishedAt?.toISOString() ?? "-",
    r.error ? `error: ${r.error}` : "",
    r.output ? `output: ${JSON.stringify(r.output)}` : "",
  );
}
await closeDb();
