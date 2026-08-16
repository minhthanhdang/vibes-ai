/// One real orchestrator turn, against Vertex, from the command line.
///
///   npm run smoke -- "what have I got in here?"
///   npm run smoke -- <projectId> "crop the mountain to a 2.39 frame"
///
/// Everything else in the agent layer is exercised with the model call injected,
/// which is how nine iterations of it were built without spending anything. This
/// is the other half: the deliberate call. It runs `runOrchestratorTurn` — the
/// same function the chat's tRPC procedure runs — and then prints what the turn
/// cost off the `AgentRun` rows it just wrote, so the bill and the reply arrive
/// together rather than the bill arriving in the Cloud Console some hours later.
///
/// It prints where each attachment's click would land, because "shown in the
/// chat and interactive when clicked" is the requirement and a caption alone
/// does not say whether the click has anywhere to go.

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

import { PrismaClient } from "../src/generated/prisma/client";
import { attachmentTarget, type ChatAttachment } from "../src/lib/agent-tools";
import { formatCost, spendSummary, type Spend } from "../src/lib/model-cost";
import { runOrchestratorTurn } from "../src/server/agents/turn";

config({ path: ".env.local" });
config({ path: ".env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set — this reads it from web-app/.env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const message = args.pop();
if (!message) {
  console.error('usage: npm run smoke -- [projectId] "<message>"');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/// The ledger for this project, read the same way `npm run spend` reads it.
/// Taken twice — before and after — because the number worth knowing is what
/// *this* turn came to, and the table is cumulative.
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
    target.view === "moodboard"
      ? `moodboard ${target.boardId}`
      : [
          `gallery ${target.inspectId}`,
          target.versionId && `at version ${target.versionId}`,
          target.offer && "carrying the offer",
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

try {
  const projectId =
    args[0] ??
    (await db.project.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }))?.id;
  if (!projectId) {
    console.error("no project on this database — make one in the app first");
    process.exit(1);
  }

  const before = await ledger(projectId);
  console.log(`project ${projectId}`);
  console.log(`> ${message}\n`);

  const started = Date.now();
  const { reply, calls, attachments } = await runOrchestratorTurn({ db, projectId, message });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(reply);
  console.log(`\ntools called: ${calls.map((call) => call.name).join(", ") || "none"}`);
  console.log(`attachments (${attachments.length}):`);
  for (const attachment of attachments) console.log(describe(attachment));

  const after = await ledger(projectId);
  console.log(`\nspent on this turn (${seconds}s):`);
  for (const group of after.byAgent) {
    const was = before.byAgent.find((entry) => entry.agent === group.agent);
    const spent = delta(was, group);
    if (!spent.prompt && !spent.output) continue;
    console.log(
      `  ${group.agent.padEnd(12)} ${String(spent.prompt).padStart(8)} in ${String(spent.output).padStart(7)} out  ${formatCost(spent.cost)}`,
    );
  }
  const turn = delta(before.total, after.total);
  console.log(
    `  ${"TURN".padEnd(12)} ${String(turn.prompt).padStart(8)} in ${String(turn.output).padStart(7)} out  ${formatCost(turn.cost)}`,
  );
  console.log(`  project to date: ${formatCost(after.total.costMicros)} over ${after.total.runs} runs`);
} finally {
  await db.$disconnect();
}
