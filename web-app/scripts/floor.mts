/// What a turn costs before anybody has said anything.
///
///   npm run floor                     # the most recent project
///   npm run floor -- <projectId>
///
/// Every other instrument in this app measures *after* a call: the `AgentRun`
/// ledger sums what Vertex reported, and `npm run spend` reads it back. That is
/// the right instrument for what a turn came to and the wrong one for deciding
/// what to cut, because it prices the whole prompt as one number.
///
/// This one prices the parts. The system instruction, the brief primed into it
/// and every tool declaration are re-sent on *every model call of every turn* —
/// there is no cache discount on this model (§VI) — so they are the floor under
/// a turn, paid before the director's message is read. `countTokens` is free and
/// exact, which makes the floor measurable without spending anything.
///
/// It also prints the floor for the four project shapes, because the gating in
/// `orchestratorTools` and `orchestratorInstruction` means a project's floor is
/// a function of what it holds rather than a constant.

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

import { PrismaClient } from "../src/generated/prisma/client";
import { orchestratorTools, type ProjectState, type ToolDeclaration } from "../src/lib/agent/agent-tools";
import { orchestratorInstruction } from "../src/server/agents/orchestrator";
import { referenceToolset } from "../src/server/agents/tools";
import { MODELS, modelPath, vertexFetch } from "../src/server/google/vertex";

config({ path: ".env.local" });
config({ path: ".env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set — this reads it from web-app/.env.local");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/// One message of nothing, so what comes back is the prompt around it. Vertex
/// counts an empty `contents` as a bad request, and "hello" is one token.
const NOTHING = [{ role: "user", parts: [{ text: "hello" }] }];

async function count(body: Record<string, unknown>) {
  const response = await vertexFetch(`${modelPath(MODELS.FLASH)}:countTokens`, {
    method: "POST",
    body: JSON.stringify({ contents: NOTHING, ...body }),
  });
  const { totalTokens } = (await response.json()) as { totalTokens?: number };
  return (totalTokens ?? 1) - 1;
}

const instructionTokens = (text: string) => count({ systemInstruction: { parts: [{ text }] } });
const declarationTokens = (declarations: ToolDeclaration[]) =>
  count({ tools: [{ functionDeclarations: declarations }] });

function line(label: string, tokens: number, of?: number) {
  const share = of ? `  ${Math.round((tokens / of) * 100)}%` : "";
  console.log(`  ${label.padEnd(26)} ${String(tokens).padStart(6)}${share}`);
}

try {
  const projectId =
    process.argv[2] ??
    (await db.project.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }))?.id;
  if (!projectId) {
    console.error("no project on this database — make one in the app first");
    process.exit(1);
  }

  const tools = referenceToolset({ db, projectId });
  const [brief, declarations, state] = await Promise.all([
    tools.brief(),
    tools.declarations(),
    tools.state(),
  ]);

  const prose = await instructionTokens(orchestratorInstruction("", state));
  const primed = await instructionTokens(orchestratorInstruction(brief, state));
  const schemas = await declarationTokens(declarations);
  const floor = primed + schemas;

  console.log(`project ${projectId}`);
  console.log(
    `  ${state.photographs} photographs, ${state.crops} cuts, ${state.boards} boards\n`,
  );
  console.log("the floor under every model call:");
  line("instruction", prose, floor);
  line("the project, primed", primed - prose, floor);
  line("declarations", schemas, floor);
  line("FLOOR", floor);

  console.log(`\nthe ${declarations.length} declarations:`);
  for (const declaration of declarations) {
    line(declaration.name, await declarationTokens([declaration]), schemas);
  }

  /// The same floor for the shapes a project passes through, since the gating
  /// makes it a function of what the project holds. Read with the real project
  /// above: this one uses its brief, so the difference is the gating alone.
  const shapes: [string, ProjectState][] = [
    ["nothing uploaded", { photographs: 0, crops: 0, boards: 0 }],
    ["photographs only", { ...state, crops: 0, boards: 0 }],
    ["and cuts", { ...state, crops: Math.max(state.crops, 1), boards: 0 }],
    ["and boards", { ...state, crops: Math.max(state.crops, 1), boards: Math.max(state.boards, 1) }],
  ];

  console.log("\nthe floor as this project grows:");
  for (const [label, shape] of shapes) {
    const withProse = await instructionTokens(orchestratorInstruction(brief, shape));
    line(label, withProse + (await declarationTokens(orchestratorTools(shape))));
  }
} finally {
  await db.$disconnect();
}
