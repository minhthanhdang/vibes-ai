import { test } from "node:test";
import assert from "node:assert/strict";

import { TEST, filesNaming, sourceFiles } from "@/server/google/source-tree";

/// §VII's headline claim, held as a test rather than as a habit: **the model
/// never learns that there is more than one conversation**, because from inside
/// a turn there is not.
///
/// A project holds many threads, one open at a time, and `orchestrator.send`
/// reads its history from the one being asked in. Everything below that door is
/// unchanged — `runOrchestratorTurn` takes a project and a history, the tools
/// take a project, agent 8 takes a board — so no new tool, no instruction
/// clause and no declaration byte moved, and the floors did not move with them.
///
/// That is a property nothing in the type system defends. A `conversationId`
/// threaded down into an agent would compile, would work, and would quietly make
/// the conversation a thing the model can reason about — a `list_conversations`
/// away from a tool that reads a thread the user did not open. The shape of this
/// rule is `db-path.test.mts`'s and `contract.test.mts`'s: a text scan over the
/// files it is about.

const AGENTS = "src/server/agents";

const SELF = "src/server/agents/conversation-blind.test.mts";

async function agentSources() {
  const walked = await sourceFiles(AGENTS);
  return walked.filter((path) => !TEST.test(path));
}

test("the agents scan as a real tree — the rule below is asserted over files, not over none", async () => {
  const files = await agentSources();
  assert.ok(files.length >= 20, `expected every agent module, walked ${files.length} files`);
  assert.ok(files.includes("src/server/agents/turn.ts"));
  assert.ok(files.includes("src/server/agents/tools.ts"));
  assert.ok(files.includes("src/server/agents/designer/design.ts"));
});

test("the model never learns that there is more than one conversation", async () => {
  /// Not `Conversation` the model either: a Prisma read of the table from inside
  /// an agent is the same fact arriving by another door.
  assert.deepEqual(await filesNaming(/\bconversationId\b/, await agentSources()), []);
  assert.deepEqual(await filesNaming("db.conversation", await agentSources()), []);
  /// And this file is not accidentally the thing it is asserting about.
  assert.ok(TEST.test(SELF));
});
