import { test } from "node:test";
import assert from "node:assert/strict";

import { TEST, filesNaming, sourceFiles } from "@/server/google/source-tree";

const AGENTS = "src/server/agents";

const SELF = "src/server/agents/conversation-blind.test.mts";

async function agentSources() {
  const walked = await sourceFiles(AGENTS);
  return walked.filter((path) => !TEST.test(path));
}

test("the agents scan as a real tree — the rule below is asserted over files, not over none", async () => {
  const files = await agentSources();
  assert.ok(files.length >= 20, `expected every agent module, walked ${files.length} files`);
  assert.ok(files.includes("src/server/agents/orchestrator/turn.ts"));
  assert.ok(files.includes("src/server/agents/orchestrator/tools.ts"));
  assert.ok(files.includes("src/server/agents/designer/design.ts"));
});

const CALLER_DOORS = ["src/server/agents/vibes/run-vibes-page.ts"];

test("the model never learns that there is more than one conversation", async () => {
  const agents = (await agentSources()).filter((path) => !CALLER_DOORS.includes(path));
  assert.deepEqual(await filesNaming(/\bconversationId\b/, agents), []);
  assert.deepEqual(await filesNaming("db.conversation", agents), []);
  assert.ok(TEST.test(SELF));
});
