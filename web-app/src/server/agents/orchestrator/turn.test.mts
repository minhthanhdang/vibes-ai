import { test } from "node:test";
import assert from "node:assert/strict";

import { runOrchestratorTurn } from "./turn";
import { MODELS } from "@/server/google/vertex";
import { HISTORY_TURN_LIMIT } from "@/lib/agent/orchestrator/history";
import { pageFrame } from "@/lib/pages/board-pages";
import type { orchestrate } from "./orchestrator";
import type { PrismaClient } from "@/generated/prisma/client";

type Write = { data: Record<string, unknown> };

function fakeDb(
  references: Record<string, unknown>[] = [],
  boards: Record<string, unknown>[] = [],
  named: { title: string; brief: string } = { title: "Cold open", brief: "" },
) {
  const writes: Write[] = [];
  const db = {
    reference: { findMany: async () => references },
    project: { findUnique: async () => named },
    moodboard: { findMany: async () => boards },
    agentRun: {
      create: async (args: Write) => {
        writes.push(args);
        return { id: "run-1" };
      },
      update: async () => ({}),
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
    model: MODELS.FLASH,
    usage: TURN_USAGE,
    rounds: 1,
    modelCalls: 2,
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
    model: MODELS.FLASH,
    promptTokens: 4400,
    outputTokens: 540,
    totalTokens: 4940,
  });
});

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
      analysis: { lighting: ["golden_hour"] },
    },
  ]);
  let primed: string | undefined;
  let held: unknown;

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "what have I got?",
    run: (async (args: { brief?: () => Promise<string>; state?: () => Promise<unknown> }) => {
      primed = await args.brief!();
      held = await args.state!();
      return {
        reply: "one photograph",
        calls: [],
        attachments: [],
        model: MODELS.FLASH,
        usage: TURN_USAGE,
      };
    }) as unknown as typeof orchestrate,
  });

  assert.equal(
    primed,
    "This project is called “Cold open”. The user has not written a brief for it.\n\n" +
      "The project holds 1 photograph:\nr1 · Ridge · 4:3 · Golden_hour",
  );
  assert.deepEqual(held, { photographs: 1, crops: 0, boards: 0, generated: 0 });
});

const boardRow = (id: string, title: string) => ({
  id,
  title,
  widthPx: 1920,
  heightPx: 1080,
  layout: "SPLIT",
});

async function primeWith(currentBoardId: string | undefined) {
  const { db } = fakeDb([], [boardRow("board-7", "Cold open"), boardRow("board-8", "Scraps")]);
  let primed: string | undefined;

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "swap the left one out",
    currentBoardId,
    run: (async (args: { brief?: () => Promise<string> }) => {
      primed = await args.brief!();
      return {
        reply: "swapped",
        calls: [],
        attachments: [],
        model: MODELS.FLASH,
        usage: TURN_USAGE,
      };
    }) as unknown as typeof orchestrate,
  });

  return primed!;
}

test("the turn primes the board the tab it was sent from is showing", async () => {
  assert.match(
    await primeWith("board-8"),
    /The project holds 2 boards\. The one the user has open:\nboard-8 · Scraps · 1920×1080 · SPLIT/,
  );
});

test("the turn passes an id this project has not got through rather than refusing it", async () => {
  const primed = await primeWith("board-gone");

  assert.match(primed, /The project holds 2 boards, none of them open in front of the user\./);
  assert.equal(primed.includes("board-8"), false);
});

test("the row records what was called, not what the calls cost", async () => {
  const { db, writes } = fakeDb();

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "crop that one",
    history: [{ role: "user", text: "hello" }],
    run: routing({ calls: [{ name: "crop_reference", args: { referenceId: "r1" } }] }),
  });

  assert.deepEqual(writes[0]!.data.output, {
    calls: ["crop_reference"],
    attachments: 0,
    rounds: 1,
    modelCalls: 2,
  });
  assert.deepEqual(writes[0]!.data.input, { message: "crop that one", history: 1 });
  assert.equal(writes[0]!.data.promptTokens, 4400);
});

test("the row says how many model calls the routing was", async () => {
  const { db, writes } = fakeDb();

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "which two sit loosest?",
    run: routing({ rounds: 2, modelCalls: 3 }),
  });

  const output = writes[0]!.data.output as { rounds: number; modelCalls: number };
  assert.equal(output.rounds, 2);
  assert.equal(output.modelCalls, 3);
});

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
    rounds: 1,
    modelCalls: 2,
    finish: "MALFORMED_FUNCTION_CALL",
  });
});

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
        model: MODELS.FLASH,
        usage: TURN_USAGE,
      };
    }) as unknown as typeof orchestrate,
  });

  assert.equal(sent?.length, HISTORY_TURN_LIMIT);
  assert.equal(sent?.at(-1)?.text, `line ${HISTORY_TURN_LIMIT * 2 - 1}`);
  assert.deepEqual(writes[0]!.data.input, {
    message: "and now?",
    history: HISTORY_TURN_LIMIT,
    historyDropped: HISTORY_TURN_LIMIT,
  });
});

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

test("a page the user attached reaches the model before their message", async () => {
  const { db, writes } = fakeDb(
    [
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
        analysis: { lighting: ["golden_hour"] },
      },
    ],
    [
      {
        id: "board-7",
        title: "Cold open",
        revision: 4,
        widthPx: 1920,
        heightPx: 1080,
        layout: "SPLIT",
        elements: [
          { id: "el-0", type: "image", fileId: "ref:r1", x: 48, y: 203, width: 900, height: 675 },
          pageFrame({ x: 0, y: 0, width: 1920, height: 1080 }, { name: "Act one", makeId: () => "page-1" }),
        ],
      },
    ],
  );
  let attached: { text?: string }[] | undefined;

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "what is missing from this one?",
    pages: [{ boardId: "board-7", pageId: "page-1", revision: 4 }],
    run: (async (args: { attached?: { text?: string }[] }) => {
      attached = args.attached;
      return {
        reply: "the right half is empty",
        calls: [],
        attachments: [],
        model: MODELS.FLASH,
        usage: TURN_USAGE,
      };
    }) as unknown as typeof orchestrate,
  });

  assert.equal(attached?.length, 1);
  assert.match(
    attached![0]!.text!,
    /^The user attached “Act one” — page 1 of 1 of the board “Cold open”, 1920×1080, composed at SPLIT\./,
  );
  assert.match(attached![0]!.text!, /\nr1 · Ridge · 4:3 · \[188,25,813,494\] · Golden_hour$/);
  assert.deepEqual(writes[0]!.data.input, {
    message: "what is missing from this one?",
    history: 0,
    pages: [{ boardId: "board-7", pageId: "page-1", rendered: false }],
  });
});

test("a message with no page attached carries no parts and leaves the row as it was", async () => {
  const { db, writes } = fakeDb();
  let attached: unknown[] | undefined;

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "what have I got?",
    run: (async (args: { attached?: unknown[] }) => {
      attached = args.attached;
      return {
        reply: "nothing yet",
        calls: [],
        attachments: [],
        model: MODELS.FLASH,
        usage: TURN_USAGE,
      };
    }) as unknown as typeof orchestrate,
  });

  assert.deepEqual(attached, []);
  assert.equal("pages" in (writes[0]!.data.input as Record<string, unknown>), false);
});
