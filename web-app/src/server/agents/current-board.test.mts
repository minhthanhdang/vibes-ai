import { test } from "node:test";
import assert from "node:assert/strict";

import { TEST, filesNaming, readSource, sourceFiles } from "@/server/google/source-tree";

const CHAIN = [
  "src/app/projects/[id]/_chat-sidebar/_conversation/components/conversation-body.tsx",
  "src/app/projects/[id]/_chat-sidebar/_conversation/stores/use-chat-log-store.ts",
  "src/server/api/routers/orchestrator.ts",
  "src/server/agents/orchestrator/turn.ts",
  "src/server/agents/orchestrator/tools.ts",
];

const HARNESSES = ["scripts/floor.mts", "scripts/smoke.mts"];

async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path));
}

test("the id is named by the five hops and the two harnesses, and by nothing else", async () => {
  assert.deepEqual(
    await filesNaming("currentBoardId", await appSources()),
    [...CHAIN, ...HARNESSES].sort(),
  );
});

const FORWARDS: [string, RegExp][] = [
  [CHAIN[0]!, /currentBoardId: openBoardId \?\? undefined,/],
  [CHAIN[1]!, /await ask\(\{[^}]*currentBoardId,/],
  [CHAIN[2]!, /runOrchestratorTurn\(\{[^}]*currentBoardId: input\.currentBoardId,/],
  [CHAIN[3]!, /referenceToolset\(\{[^}]*currentBoardId[^}]*\}\)/],
  [CHAIN[4]!, /\.find\(\(board\) => board\.id === currentBoardId\) \?\? null,/],
];

for (const [path, forward] of FORWARDS) {
  test(`${path} hands the board id on`, async () => {
    assert.match(await readSource(path), forward);
  });
}

test("nothing between the tab and the priming validates the id", async () => {
  assert.match(
    await readSource(CHAIN[2]!),
    /currentBoardId: z\.string\(\)\.optional\(\),/,
    "the wire's schema is a bare optional string — a refinement here refuses the send",
  );
  assert.match(
    await readSource(CHAIN[3]!),
    /const tools = referenceToolset\(\{ db, projectId, currentBoardId \}\);/,
    "the turn forwards the id it was handed, with no lookup of its own",
  );
});
