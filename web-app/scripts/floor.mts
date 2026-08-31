import { config } from "dotenv";

import type { ProjectState, ToolDeclaration } from "../src/lib/agent/shared/tool-declaration";
import { orchestratorTools } from "../src/lib/agent/orchestrator/tools";
import { designerToolsets } from "../src/server/agents/designer/design";
import { designerInstruction } from "../src/server/agents/designer/instruction";
import { orchestratorInstruction } from "../src/server/agents/orchestrator/orchestrator";
import { referenceToolset } from "../src/server/agents/orchestrator/tools";
import { editorDeclarations } from "../src/lib/agent/image-editor/edit-tools";
import { instructionFor } from "../src/server/agents/image-editor/instruction";
import { closeDb, db } from "../src/server/db";
import { MODELS, countTokens, type Content, type CountConfig } from "../src/server/google/vertex";

config({ path: ".env.local" });
config({ path: ".env" });

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

  const editor = editorDeclarations();
  const editorProse = await instructionTokens(instructionFor());
  const editorSchemas = await declarationTokens(editor);

  console.log("\nthe floor under every round of an edit (agent 3):");
  line("instruction", editorProse, editorProse + editorSchemas);
  line("declarations", editorSchemas, editorProse + editorSchemas);
  line("FLOOR", editorProse + editorSchemas);

  console.log(`\nthe ${editor.length} declarations:`);
  for (const declaration of editor) {
    line(declaration.name, await declarationTokens([declaration]), editorSchemas);
  }
} finally {
  await closeDb();
}
