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
  assert.ok(files.includes("src/server/agents/orchestrator/turn.ts"));
  assert.ok(files.includes("src/server/agents/orchestrator/tools.ts"));
  assert.ok(files.includes("src/server/agents/designer/design.ts"));
});

/// The one exemption, and why it is not a hole in the rule: `runVibesPage` is
/// not an agent but agent 8's *caller* — the vibes door's body, moved under
/// `agents/` from the router so the queue worker can call it without a session
/// (multi-vibes-and-preview-prd §II.4). The `conversationId` it names is the
/// run's own account, written for the user and handed back to the panel,
/// exactly as the router wrote it before the move — nothing of it reaches an
/// instruction, a tool answer or any other byte a model reads, and the
/// model-facing tree below still scans clean. Named file by file rather than
/// as a directory, so the next file under `agents/vibes/` answers to the rule
/// until somebody writes down why it should not.
const CALLER_DOORS = ["src/server/agents/vibes/run-vibes-page.ts"];

test("the model never learns that there is more than one conversation", async () => {
  const agents = (await agentSources()).filter((path) => !CALLER_DOORS.includes(path));
  /// Not `Conversation` the model either: a Prisma read of the table from inside
  /// an agent is the same fact arriving by another door.
  assert.deepEqual(await filesNaming(/\bconversationId\b/, agents), []);
  assert.deepEqual(await filesNaming("db.conversation", agents), []);
  /// And this file is not accidentally the thing it is asserting about.
  assert.ok(TEST.test(SELF));
});
