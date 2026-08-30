import { config } from "dotenv";

import { formatCost, spendSummary, type Spend } from "../src/lib/agent/shared/model-cost";
import { closeDb, db } from "../src/server/db";

config({ path: ".env.local" });
config({ path: ".env" });

const args = process.argv.slice(2);
const flagged = args.indexOf("--project");
const projectId = flagged >= 0 ? args[flagged + 1] : args[0];

try {
  const runs = await db.agentRun.findMany({
    ...(projectId && { where: { projectId } }),
    select: {
      agent: true,
      model: true,
      promptTokens: true,
      outputTokens: true,
      totalTokens: true,
    },
  });

  const { byAgent, total } = spendSummary(runs);
  const line = ({ agent, runs: count, usage, costMicros }: Spend) =>
    [
      agent.padEnd(14),
      String(count).padStart(5),
      usage.promptTokens.toLocaleString().padStart(12),
      usage.outputTokens.toLocaleString().padStart(12),
      formatCost(costMicros).padStart(10),
    ].join(" ");

  console.log(projectId ? `project ${projectId}` : "every project on this database");
  console.log(["agent".padEnd(14), "runs".padStart(5), "in".padStart(12), "out".padStart(12), "cost".padStart(10)].join(" "));
  for (const group of byAgent) console.log(line(group));
  console.log(line({ ...total, agent: "TOTAL" }));
  console.log("\nrates from MODEL_PRICES — check them against Vertex AI pricing before quoting one");
} finally {
  await closeDb();
}
