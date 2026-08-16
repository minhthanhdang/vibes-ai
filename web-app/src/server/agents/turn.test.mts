import { test } from "node:test";
import assert from "node:assert/strict";

import { runOrchestratorTurn } from "./turn";
import { MODELS } from "@/server/google/vertex";
import { HISTORY_TURN_LIMIT } from "@/lib/chat-history";
import type { orchestrate } from "./orchestrator";
import type { PrismaClient } from "@/generated/prisma/client";

/// The turn as the chat and the command-line harness both run it. Everything
/// inside it is tested elsewhere; what is only true here is the row — one per
/// turn, carrying the routing's own tokens and the names of what it called.

type Write = { data: Record<string, unknown> };

function fakeDb(references: Record<string, unknown>[] = [], boards: Record<string, unknown>[] = []) {
  const writes: Write[] = [];
  const db = {
    reference: { findMany: async () => references },
    /// The brief names the project's boards as well as its photographs, so
    /// priming a turn reads both.
    moodboard: { findMany: async () => boards },
    agentRun: {
      create: async (args: Write) => {
        writes.push(args);
        return { id: "run-1" };
      },
      update: async () => ({}),
      /// The analyzer runs behind a photograph with no tags. Read only when
      /// there is one, which the fixtures below have.
      findMany: async () => [],
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

/// The turn is where the project gets written into the prompt. Asserted here
/// rather than in the orchestrator because this is the only place the toolset's
/// read and the model call meet — a turn that forgot to prime is a turn that
/// buys a round back.
test("the turn hands the model the project before asking it anything", async () => {
  const { db } = fakeDb([
    {
      id: "r1",
      title: "Ridge",
      width: 4000,
      height: 3000,
      editIntent: "",
      editAspect: "",
      gcsUri: "gs://bucket/r1.jpg",
      thumbGcsUri: null,
      source: null,
      /// Read, so the line is the plain one. A fixture with no analysis is a
      /// photograph nobody has looked at, which the brief now says — and saying
      /// it here would make this a test of the analyzer rather than of priming.
      analysis: { lighting: ["golden_hour"] },
    },
  ]);
  let primed: string | undefined;

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "what have I got?",
    run: (async (args: { brief?: string }) => {
      primed = args.brief;
      return {
        reply: "one photograph",
        calls: [],
        attachments: [],
        model: MODELS.PRO,
        usage: TURN_USAGE,
      };
    }) as unknown as typeof orchestrate,
  });

  assert.equal(primed, "The project holds 1 photograph:\nr1 · Ridge · 4:3 · Golden_hour");
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

/// A turn the director was given a sentence about instead of an answer is the one
/// turn on the ledger whose tokens bought nothing. Without the reason on the row
/// it is indistinguishable from one that worked.
test("a turn that stopped for a reason records the reason", async () => {
  const { db, writes } = fakeDb();

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "two things at once",
    run: routing({ reply: "I got in a muddle", calls: [], finish: "MALFORMED_FUNCTION_CALL" }),
  });

  assert.deepEqual(writes[0]!.data.output, {
    calls: [],
    attachments: 0,
    finish: "MALFORMED_FUNCTION_CALL",
  });
});

/// The conversation is clamped where the turn is run rather than at the router,
/// so a client sending more than fits gets a shorter answer instead of a
/// rejected one — and the chat and `npm run smoke` are bounded by the same rule.
test("a conversation longer than the window is cut down rather than refused", async () => {
  const { db, writes } = fakeDb();
  const history = Array.from({ length: HISTORY_TURN_LIMIT * 2 }, (_, index) => ({
    role: (index % 2 === 0 ? "user" : "model") as "user" | "model",
    text: `line ${index}`,
  }));
  let sent: { role: string; text: string }[] | undefined;

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "and now?",
    history,
    run: (async (args: { history?: { role: string; text: string }[] }) => {
      sent = args.history;
      return {
        reply: "here",
        calls: [],
        attachments: [],
        model: MODELS.PRO,
        usage: TURN_USAGE,
      };
    }) as unknown as typeof orchestrate,
  });

  assert.equal(sent?.length, HISTORY_TURN_LIMIT);
  assert.equal(sent?.at(-1)?.text, `line ${HISTORY_TURN_LIMIT * 2 - 1}`);
  /// The row records the conversation as sent, and what the window left behind.
  assert.deepEqual(writes[0]!.data.input, {
    message: "and now?",
    history: HISTORY_TURN_LIMIT,
    historyDropped: HISTORY_TURN_LIMIT,
  });
});

/// A conversation that fits leaves no trace of a window it never hit.
test("a conversation inside the window records nothing dropped", async () => {
  const { db, writes } = fakeDb();

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "and now?",
    history: [{ role: "user", text: "hello" }],
    run: routing({ calls: [] }),
  });

  assert.deepEqual(writes[0]!.data.input, { message: "and now?", history: 1 });
});
