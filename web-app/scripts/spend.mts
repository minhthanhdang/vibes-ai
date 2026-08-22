/// What the pipeline has spent, off the `AgentRun` table. `npm run spend`, or
/// `npm run spend -- <projectId>` for one director's project.
///
/// The Cloud Console bills a whole GCP project across every app on it and lags
/// by hours; these rows are exact, arrive the moment a call returns, and already
/// say which agent spent it — which is the number you need to know which cap to
/// move. This script is the console for them until a panel wants one.

import { config } from "dotenv";

import { formatCost, spendSummary, type Spend } from "../src/lib/agent/model-cost";
import { closeDb, db } from "../src/server/db";

/// The same two files, in the same order, as `prisma.config.ts`: Next reads
/// `.env.local` and nothing outside it does on its own.
config({ path: ".env.local" });
config({ path: ".env" });

const projectId = process.argv[2];

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
  /// Said rather than assumed: the counts are read off the API, the rates are a
  /// table somebody typed, and only one of those two can be wrong quietly.
  console.log("\nrates from MODEL_PRICES — check them against Vertex AI pricing before quoting one");
} finally {
  await closeDb();
}
