import { test } from "node:test";
import assert from "node:assert/strict";

import { runOrchestratorTurn } from "./turn";
import { MODELS } from "@/server/google/vertex";
import { HISTORY_TURN_LIMIT } from "@/lib/agent/orchestrator/history";
import { pageFrame } from "@/lib/pages/board-pages";
import type { orchestrate } from "./orchestrator";
import type { PrismaClient } from "@/generated/prisma/client";

/// The turn as the chat and the command-line harness both run it. Everything
/// inside it is tested elsewhere; what is only true here is the row — one per
/// turn, carrying the routing's own tokens and the names of what it called.

type Write = { data: Record<string, unknown> };

function fakeDb(
  references: Record<string, unknown>[] = [],
  boards: Record<string, unknown>[] = [],
  /// What the user called the work and what they wrote it was for. The
  /// priming opens with it, so a turn cannot be asserted without it.
  named: { title: string; brief: string } = { title: "Cold open", brief: "" },
) {
  const writes: Write[] = [];
  const db = {
    reference: { findMany: async () => references },
    project: { findUnique: async () => named },
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
  let held: unknown;

  await runOrchestratorTurn({
    db,
    projectId: "p1",
    message: "what have I got?",
    /// Both arrive as the toolset's own readers rather than as their answers, so
    /// the round after a tool files something is asked against what it filed.
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

/// The one thing a turn is told that comes off the browser rather than out of
/// the database (§II.1): which board the tab sending the message is showing.
/// What the id primes as is the toolset's rule and is asserted there; what is
/// only true here is that the turn carries it from the router down to the
/// toolset at all — a turn that dropped it would prime every message as sent
/// from nowhere, and nothing below the turn would notice.
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

/// Unchecked on the way through, and this is the case that says so: the id is a
/// tab's, and the board it named may have been deleted in another one. The turn
/// hands it on rather than rejecting the message, and the toolset primes it as
/// no board — with the count still said, so the model does not read it as a
/// project with no boards.
test("the turn passes an id this project has not got through rather than refusing it", async () => {
  const primed = await primeWith("board-gone");

  assert.match(primed, /The project holds 2 boards, none of them open in front of the user\./);
  assert.equal(primed.includes("board-8"), false);
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

  assert.deepEqual(writes[0]!.data.output, {
    calls: ["crop_reference"],
    attachments: 0,
    rounds: 1,
    modelCalls: 2,
  });
  assert.deepEqual(writes[0]!.data.input, { message: "crop that one", history: 1 });
  assert.equal(writes[0]!.data.promptTokens, 4400);
});

/// The tokens on the row above say what the turn cost; these two say what it was
/// spent on. Every model call re-sends the instruction, the declarations and the
/// brief, so a turn's input is close to `modelCalls` copies of that base — which
/// is the difference between an expensive question and a long walk to an answer,
/// and it was not readable off the ledger at all until now.
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
  /// One more than the rounds: the answering call follows the last of them, and
  /// it is billed like every other.
  assert.equal(output.modelCalls, 3);
});

/// A turn the user was given a sentence about instead of an answer is the one
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
    rounds: 1,
    modelCalls: 2,
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
        model: MODELS.FLASH,
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

/// tech-spec §V.5: a page the user attached rides in front of their own
/// words. What is only true here is the wiring — that the parts reach the model
/// call, and that the row says which pages the reply was answered with.
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
          /// Seated in SPLIT's left panel, because the page's own line only
          /// claims a template while the page is still standing in it — a
          /// picture dropped at the corner of the page is the user's
          /// arrangement, whatever the row was last composed at.
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
  /// The turn is not replayable from the row without this: the same sentence
  /// about the same board reads differently when a page of it was in front of
  /// the model, and a page sent as text only is the one case where it answered
  /// about a picture it never saw.
  assert.deepEqual(writes[0]!.data.input, {
    message: "what is missing from this one?",
    history: 0,
    pages: [{ boardId: "board-7", pageId: "page-1", rendered: false }],
  });
});

/// The ordinary turn, which is every turn until the user picks a page.
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
