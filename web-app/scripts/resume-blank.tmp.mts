import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const { db } = await import("../src/server/db");
const { storedBrief } = await import("../src/lib/vibes/vibes-brief");
const { vibesPending, vibesRun } = await import("../src/lib/vibes/vibes-resume");
const { persistableElements } = await import("../src/lib/scene/moodboard-scene");
const { enqueueVibesPage, drainVibesQueue } = await import("../src/server/agents/vibes/vibes-queue");
const { AgentKind, RunStatus } = await import("../src/generated/prisma/enums");

const boards = await db.moodboard.findMany({
  where: { title: { startsWith: "a spring seasonal" } },
  select: { id: true, projectId: true, title: true, elements: true, vibesBrief: true },
});

for (const board of boards) {
  const brief = storedBrief(board.vibesBrief);
  if (!brief) continue;
  const pending = vibesPending(vibesRun({ elements: persistableElements(board.elements), brief }));
  const next = pending[0];
  if (!next) {
    console.log(board.id.slice(-6), "no blank pages");
    continue;
  }
  const live = await db.agentRun.findFirst({
    where: {
      projectId: board.projectId,
      agent: AgentKind.VIBES,
      status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] },
      input: { path: ["boardId"], equals: board.id },
    },
    select: { id: true },
  });
  if (live) {
    console.log(board.id.slice(-6), "run still live, skipping");
    continue;
  }
  await enqueueVibesPage(db, {
    projectId: board.projectId,
    boardId: board.id,
    pageId: next.pageId,
    index: next.index,
  });
  console.log(board.id.slice(-6), `enqueued page ${next.index + 1}`);
}

for (let round = 0; round < 5; round++) {
  const result = await drainVibesQueue();
  console.log(`round ${round}:`, JSON.stringify(result));
  if (result.drained) break;
}
console.log("done");
process.exit(0);
