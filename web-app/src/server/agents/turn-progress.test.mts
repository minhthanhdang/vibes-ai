import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { orchestrate } = await import("@/server/agents/orchestrator/orchestrator");
const { emit, withAgent, withEvents } = await import("@/server/agents/shared/agent-scope");
import type { TurnEvent } from "@/lib/agent/shared/turn-events";
import type { ToolOutcome } from "@/lib/agent/shared/attachments";

type Part = { text: string; thought?: boolean } | { functionCall: { name: string; args: Record<string, unknown> } };

function saying(...rounds: Part[][]) {
  let asked = 0;
  const generate = (async (
    _model: string,
    _contents: unknown,
    _config: unknown,
    watch?: { chunk: (parts: Part[]) => void },
  ) => {
    const round = rounds[asked++];
    assert.ok(round, `the loop asked ${asked} times for ${rounds.length} answers`);
    for (const part of round) watch?.chunk([part]);
    return {
      candidates: [{ content: { parts: round } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    };
  }) as never;
  return generate;
}

const toolEvents = (events: readonly TurnEvent[]) =>
  events.filter((event) => event.kind === "calling" || event.kind === "called");

const call = (name: string, args: Record<string, unknown> = {}): Part => ({ functionCall: { name, args } });

const executing = (answers: Record<string, ToolOutcome>) => async ({ name }: { name: string }) =>
  answers[name] ?? { result: { ok: true } };

async function watched(run: () => Promise<unknown>) {
  const events: TurnEvent[] = [];
  await withEvents((event) => events.push(event), () => withAgent("orchestrator", run));
  return events;
}

test("a round names its tools before it runs them, and says how they went after", async () => {
  const events = await watched(() =>
    orchestrate({
      message: "what have I got?",
      generate: saying([call("list_references")], [{ text: "Four pictures." }]),
      execute: executing({}),
      tools: () => [{ name: "list_references", description: "", parameters: { type: "object" } }],
    }),
  );

  assert.deepEqual(
    toolEvents(events).map((event) => event.kind),
    ["calling", "called"],
  );
  const [calling, called] = toolEvents(events);
  assert.ok(calling?.kind === "calling" && called?.kind === "called");
  assert.deepEqual(calling.calls, [{ callId: "1.1", name: "list_references", args: {} }]);
  assert.deepEqual(called.results, [{ callId: "1.1", name: "list_references", ok: true }]);
});

test("the callIds a round announces are the ones its stored parts carry", async () => {
  const events: TurnEvent[] = [];
  const turn = await withEvents(
    (event) => events.push(event),
    () =>
      withAgent("orchestrator", () =>
        orchestrate({
          message: "crop them both",
          generate: saying(
            [call("crop_reference", { id: "a" }), call("crop_reference", { id: "b" })],
            [{ text: "Both cropped." }],
          ),
          execute: executing({}),
          tools: () => [{ name: "crop_reference", description: "", parameters: { type: "object" } }],
        }),
      ),
  );

  const announced = events.flatMap((event) => (event.kind === "calling" ? event.calls.map((c) => c.callId) : []));
  const stored = turn.parts.flatMap((part) => (part.type === "call" ? [part.callId] : []));
  assert.deepEqual(announced, ["1.1", "1.2"]);
  assert.deepEqual(stored, announced);
});

test("a tool that threw is a step that failed, not a turn that did", async () => {
  const events = await watched(() =>
    orchestrate({
      message: "crop it",
      generate: saying([call("crop_reference")], [{ text: "That one is gone." }]),
      execute: async () => {
        throw new Error("no such reference");
      },
      tools: () => [{ name: "crop_reference", description: "", parameters: { type: "object" } }],
    }),
  );

  const called = events.find((event) => event.kind === "called");
  assert.ok(called?.kind === "called");
  assert.deepEqual(called.results, [{ callId: "1.1", name: "crop_reference", ok: false }]);
});

test("a summary is a thinking event and the reply is a delta", async () => {
  const events = await watched(() =>
    orchestrate({
      message: "hello",
      generate: saying([
        { text: "They want a mood, not a list.", thought: true },
        { text: "What look are you after?" },
      ]),
    }),
  );

  assert.deepEqual(
    events.map((event) => [event.kind, "text" in event ? event.text : null]),
    [
      ["thinking", "They want a mood, not a list."],
      ["delta", "What look are you after?"],
    ],
  );
});

test("a reply that arrives in fragments is one delta each and one reply", async () => {
  const events: TurnEvent[] = [];
  const turn = await withEvents(
    (event) => events.push(event),
    () =>
      withAgent("orchestrator", () =>
        orchestrate({
          message: "hello",
          generate: saying([{ text: "Tell me " }, { text: "about the " }, { text: "light." }]),
        }),
      ),
  );

  assert.deepEqual(
    events.flatMap((event) => (event.kind === "delta" ? [event.text] : [])),
    ["Tell me ", "about the ", "light."],
  );
  assert.equal(turn.reply, "Tell me about the light.");
});

test("the events of one turn are one sequence, whichever agent made them", async () => {
  const events: TurnEvent[] = [];
  await withEvents(
    (event) => events.push(event),
    () =>
      withAgent("orchestrator", () =>
        orchestrate({
          message: "design me a page",
          generate: saying([call("design_page")], [{ text: "Done." }]),
          execute: () =>
            withAgent("designer", async () => {
              emit({ kind: "thinking", text: "the portrait goes at the top" });
              return { result: { ok: true } };
            }),
          tools: () => [{ name: "design_page", description: "", parameters: { type: "object" } }],
        }),
      ),
  );

  assert.deepEqual(
    events.flatMap((event) =>
      "agent" in event && event.kind !== "delta" ? [[event.seq, event.agent, event.under]] : [],
    ),
    [
      [1, "orchestrator", []],
      [2, "designer", ["orchestrator"]],
      [3, "orchestrator", []],
    ],
  );
});

test("a turn nobody is watching answers exactly as it did before", async () => {
  const script = () =>
    orchestrate({
      message: "what have I got?",
      generate: saying([call("list_references")], [{ text: "Four pictures." }]),
      execute: executing({}),
      tools: () => [{ name: "list_references", description: "", parameters: { type: "object" } }],
    });

  const unwatched = await script();
  const listened = await withEvents(() => {}, () => withAgent("orchestrator", script));

  assert.equal(unwatched.reply, listened.reply);
  assert.equal(unwatched.rounds, listened.rounds);
  assert.equal(unwatched.modelCalls, listened.modelCalls);
  assert.deepEqual(unwatched.parts, listened.parts);
});
