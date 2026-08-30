import { config } from "dotenv";

import { attachmentTarget, type ChatAttachment } from "../src/lib/agent/shared/attachments";
import { formatCost, spendSummary, type Spend } from "../src/lib/agent/shared/model-cost";
import { runOrchestratorTurn } from "../src/server/agents/orchestrator/turn";
import { closeDb, db } from "../src/server/db";
import type { Turn } from "../src/server/agents/orchestrator/orchestrator";

config({ path: ".env.local" });
config({ path: ".env" });

const argv = process.argv.slice(2);
const drainAfter = argv.includes("--drain");
const rest = argv.filter((argument) => argument !== "--drain");

function takeFlag(name: string) {
  const at = rest.indexOf(name);
  if (at === -1) return undefined;
  const value = rest[at + 1];
  rest.splice(at, value === undefined ? 1 : 2);
  return value;
}

const chosenProject = takeFlag("--project");
const openBoard = takeFlag("--board");
const messages = rest;

if (!messages.length && !drainAfter) {
  console.error(
    'usage: npm run smoke -- [--project <id>] [--board <id>] [--drain] "<message>" ["<message>" ...]',
  );
  process.exit(1);
}

async function ledger(projectId: string) {
  const runs = await db.agentRun.findMany({
    where: { projectId },
    select: {
      agent: true,
      model: true,
      promptTokens: true,
      outputTokens: true,
      totalTokens: true,
    },
  });
  return spendSummary(runs);
}

function describe(attachment: ChatAttachment) {
  const target = attachmentTarget(attachment);
  const where =
    target.view === "design"
      ? `design ${target.boardId}`
      : [
          `gallery ${target.inspectId}`,
          target.versionId && `at version ${target.versionId}`,
        ]
          .filter(Boolean)
          .join(" ");
  return `  [${attachment.kind}] ${attachment.caption} → ${where}`;
}

function delta(before: Spend | undefined, after: Spend) {
  const prompt = after.usage.promptTokens - (before?.usage.promptTokens ?? 0);
  const output = after.usage.outputTokens - (before?.usage.outputTokens ?? 0);
  const cost = (after.costMicros ?? 0) - (before?.costMicros ?? 0);
  return { prompt, output, cost };
}

type Ledger = ReturnType<typeof spendSummary>;

function report(before: Ledger, after: Ledger, label: string, seconds: string) {
  console.log(`\nspent on ${label} (${seconds}s):`);
  for (const group of after.byAgent) {
    const was = before.byAgent.find((entry) => entry.agent === group.agent);
    const spent = delta(was, group);
    if (!spent.prompt && !spent.output) continue;
    console.log(
      `  ${group.agent.padEnd(12)} ${String(spent.prompt).padStart(8)} in ${String(spent.output).padStart(7)} out  ${formatCost(spent.cost)}`,
    );
  }
  const total = delta(before.total, after.total);
  console.log(
    `  ${label.toUpperCase().padEnd(12)} ${String(total.prompt).padStart(8)} in ${String(total.output).padStart(7)} out  ${formatCost(total.cost)}`,
  );
}

try {
  const projectId =
    chosenProject ??
    (await db.project.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }))?.id;
  if (!projectId) {
    console.error("no project on this database — make one in the app first");
    process.exit(1);
  }

  const opened = await ledger(projectId);
  console.log(`project ${projectId} · ${openBoard ? `board ${openBoard} open` : "no board open"}`);

  const history: Turn[] = [];

  for (const [index, message] of messages.entries()) {
    const before = await ledger(projectId);
    console.log(`\n${"─".repeat(60)}\n> ${message}\n`);

    const started = Date.now();
    const { reply, calls, attachments, rounds, modelCalls } = await runOrchestratorTurn({
      db,
      projectId,
      message,
      currentBoardId: openBoard,
      history,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    history.push({ role: "user", text: message }, { role: "model", text: reply });

    console.log(reply);
    console.log(`\ntools called: ${calls.map((call) => call.name).join(", ") || "none"}`);
    console.log(`routing: ${modelCalls} model calls over ${rounds} tool round${rounds === 1 ? "" : "s"}`);
    console.log(`attachments (${attachments.length}):`);
    for (const attachment of attachments) console.log(describe(attachment));

    report(before, await ledger(projectId), `turn ${index + 1}`, seconds);
  }

  if (drainAfter) {
    const waiting = await db.agentRun.count({
      where: { projectId, agent: "ANALYZER", status: "QUEUED" },
    });
    console.log(`\n${"─".repeat(60)}\ndraining the analyzer queue (${waiting} waiting)`);
    if (waiting) {
      const { drainAnalyzerQueue } = await import("../src/server/agents/analyzer/analysis-queue");
      const before = await ledger(projectId);
      console.log(JSON.stringify(await drainAnalyzerQueue({ limit: waiting })));
      report(before, await ledger(projectId), "analyzer", "—");
    }
  }

  const closed = await ledger(projectId);
  if (messages.length > 1) report(opened, closed, "conversation", "—");
  console.log(`  project to date: ${formatCost(closed.total.costMicros)} over ${closed.total.runs} runs`);
} finally {
  await closeDb();
}
