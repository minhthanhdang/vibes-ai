import { config } from "dotenv";
config({ path: ".env.local" });
const { db } = await import("./src/server/db");
const { claimVibesRun, runClaimedVibesJob } = await import(
  "./src/server/agents/vibes/vibes-worker"
);
const { runVibesPage } = await import("./src/server/agents/vibes/run-vibes-page");

const deps = {
  db,
  runPage: async (job: { boardId: string; pageId: string; index: number }) =>
    runVibesPage({ db, ...job }),
};

async function worker(name: string) {
  for (;;) {
    const claimed = await claimVibesRun(deps);
    if (!claimed) {
      console.log(`[${name}] queue empty`);
      return;
    }
    console.log(`[${name}] claimed ${claimed.id} input=${JSON.stringify(claimed.input)}`);
    const t0 = Date.now();
    const settled = await runClaimedVibesJob(deps, claimed);
    const ticket = await db.agentRun.findUniqueOrThrow({
      where: { id: settled.id },
      select: { status: true, output: true, error: true },
    });
    console.log(
      `[${name}] settle ${ticket.status} ${JSON.stringify(ticket.output ?? ticket.error)} in ${Math.round((Date.now() - t0) / 1000)}s chained=${settled.chained}`,
    );
  }
}

await Promise.all([worker("A"), worker("B")]);
process.exit(0);
