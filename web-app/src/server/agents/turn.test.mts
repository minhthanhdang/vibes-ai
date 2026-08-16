import { test } from "node:test";
import assert from "node:assert/strict";

import { runOrchestratorTurn } from "./turn";
import { MODELS } from "@/server/google/vertex";
import type { orchestrate } from "./orchestrator";
import type { PrismaClient } from "@/generated/prisma/client";

/// The turn as the chat and the command-line harness both run it. Everything
/// inside it is tested elsewhere; what is only true here is the row — one per
/// turn, carrying the routing's own tokens and the names of what it called.

type Write = { data: Record<string, unknown> };

function fakeDb() {
  const writes: Write[] = [];
  const db = {
    reference: { findMany: async () => [] },
    agentRun: {
      create: async (args: Write) => {
        writes.push(args);
        return { id: "run-1" };
      },
      update: async () => ({}),
    },
  };
  return { db: db as unknown as PrismaClient, writes };
}

const TURN_USAGE = { promptTokens: 4400, outputTokens: 540, totalTokens: 4940 };

const routing = (over: Partial<Awaited<ReturnType<typeof orchestrate>>> = {}) =>
  (async () => ({
    reply: "you have two pictures in here",
    calls: [
      { name: "list_references", args: {} },
      { name: "show_references", args: {} },
    ],
    attachments: [],
    model: MODELS.PRO,
    usage: TURN_USAGE,
    ...over,
  })) as unknown as typeof orchestrate;

test("the turn writes one run row carrying its own tokens", async () => {
  const { db, writes } = fakeDb();

  await runOrchestratorTurn({ db, projectId: "p1", message: "what have I got?", run: routing() });

  assert.equal(writes.length, 1);
  const { agent, projectId, model, promptTokens, outputTokens, totalTokens } = writes[0]!.data;
  assert.equal(agent, "ORCHESTRATOR");
  assert.equal(projectId, "p1");
  assert.deepEqual({ model, promptTokens, outputTokens, totalTokens }, {
    model: MODELS.PRO,
    promptTokens: 4400,
    outputTokens: 540,
    totalTokens: 4940,
  });
});

/// The routing's tokens are the routing's. A crop ordered through a tool wrote
/// its own row inside the executor, and adding it here would bill it twice.
test("the row records what was called, not what the calls cost", async () => {
  const { db, writes } = fakeDb();

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "crop that one",
    history: [{ role: "user", text: "hello" }],
    run: routing({ calls: [{ name: "crop_reference", args: { referenceId: "r1" } }] }),
  });

  assert.deepEqual(writes[0]!.data.output, { calls: ["crop_reference"], attachments: 0 });
  assert.deepEqual(writes[0]!.data.input, { message: "crop that one", history: 1 });
  assert.equal(writes[0]!.data.promptTokens, 4400);
});
