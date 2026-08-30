import { config } from "dotenv";

import { AgentKind } from "../src/generated/prisma/enums";
import { designRunsRead, type CeilingRead } from "../src/lib/agent/designer/design-runs";
import { formatCost, spendSummary } from "../src/lib/agent/shared/model-cost";
import { designerToolsets } from "../src/server/agents/designer/design";
import { DESIGNER_PICTURE_LIMIT, DESIGNER_ROUND_LIMIT } from "../src/server/agents/designer/loop";
import { closeDb, db } from "../src/server/db";
import { SKILL_NAMES } from "../src/server/skills";

config({ path: ".env.local" });
config({ path: ".env" });

const projectId = process.argv[2];

const percent = (share: number) => `${Math.round(share * 100)}%`;

const ceilingLine = (label: string, read: CeilingRead) =>
  [
    `  ${label.padEnd(10)}`,
    `limit ${String(read.limit).padStart(2)}`,
    `max ${String(read.max).padStart(2)}`,
    `mean ${read.mean.toFixed(1).padStart(4)}`,
    `${read.atLimit} of ${read.runs} at the limit`,
  ].join("  ");

try {
  const rows = await db.agentRun.findMany({
    where: { agent: AgentKind.DESIGNER, ...(projectId && { projectId }) },
    select: {
      status: true,
      output: true,
      model: true,
      promptTokens: true,
      outputTokens: true,
      totalTokens: true,
    },
    orderBy: { startedAt: "asc" },
  });

  console.log(projectId ? `project ${projectId}` : "every project on this database");
  if (!rows.length) {
    console.log("no designs on this database — run npm run design:check first");
    process.exit(0);
  }

  const read = designRunsRead(rows, {
    rounds: DESIGNER_ROUND_LIMIT,
    pictures: DESIGNER_PICTURE_LIMIT,
  });
  const { total } = spendSummary(rows.map((row) => ({ ...row, agent: "DESIGNER" })));

  console.log(
    `${read.runs} designs — ${read.byStatus.map(({ status, runs }) => `${runs} ${status}`).join(", ")}`,
  );
  console.log(`${formatCost(total.costMicros)} across all of them\n`);

  console.log("the per-call ceilings:");
  console.log(ceilingLine("rounds", read.rounds));
  console.log(`  ${" ".repeat(10)}${read.stoppedOnRounds} stopped mid-work by it`);
  console.log(ceilingLine("pictures", read.pictures));
  console.log(
    `  ${" ".repeat(10)}${read.picturesRefused} refused by it, ${read.picturesDropped} dropped by PICTURE_WINDOW`,
  );

  const { renders } = read;
  console.log("\nwhat the looking cost the bucket:");
  console.log(
    `  ${renders.runs} of ${read.runs} designs drew at all, ${renders.made + renders.cached + renders.failed} draws between them`,
  );
  console.log(
    `  ${renders.made} made, ${renders.cached} cached, ${renders.failed} failed` +
      (renders.hitRate === null ? "" : ` — ${percent(renders.hitRate)} hit rate`),
  );

  console.log("\nwhat the rounds were spent on:");
  for (const { name, calls, runs } of read.calls) {
    console.log(
      `  ${name.padEnd(20)} ${String(calls).padStart(4)}  in ${String(runs).padStart(3)} of ${read.runs} designs`,
    );
  }

  const declared = designerToolsets({ db, projectId: projectId ?? "", boardId: "" }).flatMap(
    ({ declarations }) => declarations.map(({ name }) => name),
  );
  const called = new Set(read.calls.map(({ name }) => name));
  const unused = declared.filter((name) => !called.has(name));
  console.log(
    `\n${unused.length} of ${declared.length} declarations no design has ever called:\n  ${unused.join(", ") || "—"}`,
  );

  const { skills } = read;
  console.log(
    `\nwhat the designs were taught, over the ${skills.runs} of ${read.runs} that recorded it:`,
  );
  if (!skills.runs) {
    console.log("  nothing — no row here carries the key, so run a design and ask again");
  }
  for (const { name, runs } of skills.read) {
    console.log(`  ${name.padEnd(20)} read by ${String(runs).padStart(3)} of ${skills.runs}`);
  }
  if (skills.runs) {
    const opened = new Set(skills.read.map(({ name }) => name));
    const unread = SKILL_NAMES.filter((name) => !opened.has(name));
    console.log(
      `  ${unread.length} of ${SKILL_NAMES.length} skills no design has read:\n    ${unread.join(", ") || "—"}`,
    );
  }
} finally {
  await closeDb();
}
