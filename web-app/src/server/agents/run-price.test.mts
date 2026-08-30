import { test } from "node:test";
import assert from "node:assert/strict";

import { TEST, filesNaming, sourceFiles } from "@/server/google/source-tree";

const DOORS = [
  "src/server/agents/analyzer/analyzer-worker.ts",
  "src/server/agents/orchestrator/turn.ts",
  "src/server/agents/orchestrator/tools.ts",
  "src/server/api/routers/reference.ts",
  "src/server/references/tool-crop.ts",
  "src/server/references/tool-generation.ts",
  "src/server/agents/designer/design.ts",
  "src/lib/agent/shared/model-cost.ts",
];

async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path));
}

test("the doors onto the run table are the ones this rule is about", async () => {
  const writers = await filesNaming("spentColumns(", await appSources());
  assert.deepEqual(writers, [...DOORS].sort());
});

test("a run row's price is never a model its writer named itself", async () => {
  const writers = await filesNaming("spentColumns(", await appSources());
  assert.deepEqual(await filesNaming(/\bMODELS\./, writers), []);
});
