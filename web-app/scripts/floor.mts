/// What a turn costs before anybody has said anything.
///
///   npm run floor                     # the most recent project
///   npm run floor -- <projectId>
///   npm run floor -- <projectId> <boardId>
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
///
/// Agent 8 is priced after it (compositor-v2.md §IV), on the same terms and for
/// a sharper reason: a design is up to `DESIGNER_ROUND_LIMIT` model calls, so
/// its floor is paid twelve times where the orchestrator pays it once or twice.
/// Its floor really is a constant — nothing about agent 8 is gated on what the
/// project holds, because agent 6's `design_page` gate (`boards > 0`) has
/// already answered that question by the time the loop opens.

import { config } from "dotenv";

import type { ProjectState, ToolDeclaration } from "../src/lib/agent/shared/tool-declaration";
import { orchestratorTools } from "../src/lib/agent/orchestrator/tools";
import { designerToolsets } from "../src/server/agents/designer/design";
import { designerInstruction } from "../src/server/agents/designer/instruction";
import { orchestratorInstruction } from "../src/server/agents/orchestrator/orchestrator";
import { referenceToolset } from "../src/server/agents/orchestrator/tools";
import { closeDb, db } from "../src/server/db";
import { MODELS, countTokens, type Content, type CountConfig } from "../src/server/google/vertex";

config({ path: ".env.local" });
config({ path: ".env" });

/// One message of nothing, so what comes back is the prompt around it. Vertex
/// counts an empty `contents` as a bad request, and "hello" is one token.
const NOTHING: Content[] = [{ role: "user", parts: [{ text: "hello" }] }];

async function count(config: CountConfig) {
  const total = await countTokens(MODELS.FLASH, NOTHING, config);
  return (total || 1) - 1;
}

const instructionTokens = (text: string) => count({ systemInstruction: text });
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

  /// The board a tab is showing, which is what the priming names (§II.1). The
  /// browser is the only thing that knows it, so the measurement stands in for
  /// one: the board worked on most recently is the one a user is looking at in
  /// the case worth pricing. Without it the brief prices a message sent with no
  /// board open, which is the cheaper case rather than the usual one.
  const currentBoardId =
    process.argv[3] ??
    (
      await db.moodboard.findFirst({
        where: { projectId },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      })
    )?.id;

  const tools = referenceToolset({ db, projectId, currentBoardId });
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
  /// Agent 8's own floor. `designerToolsets` is the list a design really sends,
  /// asked for here rather than re-listed, so a toolset added to agent 8 shows
  /// up in this number without anybody remembering to come back. The board id
  /// picks nothing out of a declaration — it is where `crop_image` resolves a
  /// placed object at execute time — so the floor below is every design's.
  const designer = designerToolsets({ db, projectId, boardId: "" }).flatMap(
    ({ declarations }) => declarations,
  );
  const designerProse = await instructionTokens(designerInstruction());
  const designerSchemas = await declarationTokens(designer);

  console.log("\nthe floor under every round of a design (agent 8):");
  line("instruction", designerProse, designerProse + designerSchemas);
  line("declarations", designerSchemas, designerProse + designerSchemas);
  line("FLOOR", designerProse + designerSchemas);

  console.log(`\nthe ${designer.length} declarations:`);
  for (const declaration of designer) {
    line(declaration.name, await declarationTokens([declaration]), designerSchemas);
  }
} finally {
  await closeDb();
}
