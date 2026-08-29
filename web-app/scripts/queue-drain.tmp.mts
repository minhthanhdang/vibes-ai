import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const { drainVibesQueue } = await import("../src/server/agents/vibes/vibes-queue");

for (let round = 0; round < 5; round++) {
  const result = await drainVibesQueue();
  console.log(`round ${round}:`, JSON.stringify(result));
  if (result.drained) break;
}
console.log("done");
process.exit(0);
