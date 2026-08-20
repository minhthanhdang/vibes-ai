/// A real conversation with the orchestrator, against Vertex, from the command
/// line.
///
///   npm run smoke -- "what have I got in here?"
///   npm run smoke -- --project <projectId> "make me a board" "add the other one"
///
/// Everything else in the agent layer is exercised with the model call injected,
/// which is how nine iterations of it were built without spending anything. This
/// is the other half: the deliberate call. It runs `runOrchestratorTurn` — the
/// same function the chat's tRPC procedure runs — and then prints what the turn
/// cost off the `AgentRun` rows it just wrote, so the bill and the reply arrive
/// together rather than the bill arriving in the Cloud Console some hours later.
///
/// Several messages are several turns of *one* conversation, with the history
/// carried forward exactly as the sidebar carries it — role and text, no tool
/// results. That is the only way to exercise what the interesting tools are
/// actually reached by: "add the other photograph to that board" is a rebuild,
/// and it only means anything on the second turn.
///
/// It prints where each attachment's click would land, because "shown in the
/// chat and interactive when clicked" is the requirement and a caption alone
/// does not say whether the click has anywhere to go.
///
/// `--drain` runs the analyzer's queue once the conversation is over. Agent 2 is
/// the one agent no turn waits for: an upload files a job and wakes a worker with
/// `after()`, which needs a request to run after and so does nothing here — so
/// without this a harness run talks about pictures that are queued forever, and
/// `read_references` answers about every one of them with nothing stored. It
/// costs a vision call per queued picture, which is why it is a flag.

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

import { PrismaClient } from "../src/generated/prisma/client";
import { attachmentTarget, type ChatAttachment } from "../src/lib/agent/agent-tools";
import { formatCost, spendSummary, type Spend } from "../src/lib/agent/model-cost";
import { runOrchestratorTurn } from "../src/server/agents/turn";
import type { Turn } from "../src/server/agents/orchestrator";

config({ path: ".env.local" });
config({ path: ".env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set — this reads it from web-app/.env.local");
  process.exit(1);
}

/// The project is a flag rather than a leading positional, because every other
/// argument is now a message and "is this first string an id or something the
/// director said" is a guess a harness should not be making.
const argv = process.argv.slice(2);
const drainAfter = argv.includes("--drain");
const args = argv.filter((argument) => argument !== "--drain");
const flag = args.indexOf("--project");
const chosenProject = flag === -1 ? undefined : args[flag + 1];
const messages = args.filter((_, index) => flag === -1 || (index !== flag && index !== flag + 1));

/// `--drain` on its own is a legitimate run: the readings the last upload filed
/// are still sitting in the queue, and finishing them costs nothing in routing.
if (!messages.length && !drainAfter) {
  console.error('usage: npm run smoke -- [--project <id>] [--drain] "<message>" ["<message>" ...]');
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

/// What one turn cost, per agent and in total, off the ledger either side of it.
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
  console.log(`project ${projectId}`);

  /// Carried the way `reference-sidebar.tsx` carries it: role and text only. The
  /// model does not get its own tool results back, so a turn that means "that
  /// board" has to be able to find the board in the brief.
  const history: Turn[] = [];

  for (const [index, message] of messages.entries()) {
    const before = await ledger(projectId);
    console.log(`\n${"─".repeat(60)}\n> ${message}\n`);

    const started = Date.now();
    const { reply, calls, attachments, rounds, modelCalls } = await runOrchestratorTurn({
      db,
      projectId,
      message,
      history,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    history.push({ role: "user", text: message }, { role: "model", text: reply });

    console.log(reply);
    console.log(`\ntools called: ${calls.map((call) => call.name).join(", ") || "none"}`);
    /// The routing tokens below are close to this many copies of the
    /// instruction, the declarations and the brief — which is what an
    /// expensive turn is usually made of rather than a long question.
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
      const { drainAnalyzerQueue } = await import("../src/server/agents/analysis-queue");
      const before = await ledger(projectId);
      console.log(JSON.stringify(await drainAnalyzerQueue({ limit: waiting })));
      report(before, await ledger(projectId), "analyzer", "—");
    }
  }

  const closed = await ledger(projectId);
  if (messages.length > 1) report(opened, closed, "conversation", "—");
  console.log(`  project to date: ${formatCost(closed.total.costMicros)} over ${closed.total.runs} runs`);
} finally {
  await db.$disconnect();
}
