import { config } from "dotenv";
config({ path: ".env.local" });
const { db } = await import("./src/server/db");
const rows = await db.agentRun.findMany({
  where: { id: { in: ["cmtcep3j40003r0rvlmy2ez39", "cmtcep4oy0007r0rvw1uy01sj"] } },
  select: { id: true, status: true, startedAt: true, output: true, error: true },
});
for (const r of rows) console.log(JSON.stringify(r));
process.exit(0);
