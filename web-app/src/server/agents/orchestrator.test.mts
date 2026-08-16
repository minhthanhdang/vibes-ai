import { test } from "node:test";
import assert from "node:assert/strict";

import { STUCK_REPLY, orchestrate, orchestratorInstruction } from "./orchestrator";
import type { ChatAttachment, ToolOutcome } from "@/lib/agent-tools";
import type { Content, GenerateConfig } from "@/server/google/vertex";

/// Agent 6's routing loop, with the model call replaced by a script. What this
/// asserts is the two things the loop alone decides: how many rounds a turn may
/// buy, and what of a tool's answer reaches the director rather than the model.

type Part = { text: string } | { functionCall: { name: string; args: Record<string, unknown> } };

/// What one round costs here. Flat, because the thing worth asserting is that
/// rounds are *added up* — in the real turn each one is dearer than the last,
/// since every round re-sends the conversation with another tool result on it.
const PER_ROUND = { promptTokenCount: 2000, candidatesTokenCount: 80, totalTokenCount: 2080 };

function saying(...rounds: Part[][]) {
  const sent: { contents: Content[]; config: GenerateConfig }[] = [];
  const generate = (async (_model: string, contents: Content[], config: GenerateConfig = {}) => {
    sent.push({ contents: JSON.parse(JSON.stringify(contents)) as Content[], config });
    const parts = rounds[sent.length - 1];
    assert.ok(parts, `the orchestrator asked ${sent.length} times for ${rounds.length} answers`);
    return { candidates: [{ content: { parts } }], usageMetadata: PER_ROUND };
  }) as never;
  return { sent, generate };
}

const reference = (id: string): ChatAttachment => ({
  kind: "reference",
  referenceId: id,
  frameId: null,
  title: id,
  caption: id,
  thumbUrl: `/api/references/${id}/image`,
});

const call = (name: string, args: Record<string, unknown> = {}): Part => ({
  functionCall: { name, args },
});

test("a reply with no tool call is the answer, and costs one round", async () => {
  const { sent, generate } = saying([{ text: "Tell me about the light you are after." }]);
  const { reply, calls, attachments } = await orchestrate({ message: "hello", generate });

  assert.equal(reply, "Tell me about the light you are after.");
  assert.deepEqual(calls, []);
  assert.deepEqual(attachments, []);
  assert.equal(sent.length, 1);
  /// An empty declarations array is not the same as no tools — Vertex rejects
  /// it — so the key is left out entirely when there are none.
  assert.equal("tools" in sent[0]!.config, false);
});

test("history and the new message arrive in order, the tools on every round", async () => {
  const { sent, generate } = saying([call("list_references")], [{ text: "Three of them." }]);
  const declarations = [{ name: "list_references", description: "", parameters: {} }];

  await orchestrate({
    message: "what have I got?",
    history: [
      { role: "user", text: "hi" },
      { role: "model", text: "hello" },
    ],
    tools: declarations,
    execute: async () => ({ result: { total: 3 } }),
    generate,
  });

  assert.deepEqual(sent[0]!.contents, [
    { role: "user", parts: [{ text: "hi" }] },
    { role: "model", parts: [{ text: "hello" }] },
    { role: "user", parts: [{ text: "what have I got?" }] },
  ]);
  assert.deepEqual(sent[1]!.config.tools, [{ functionDeclarations: declarations }]);
});

/// The project is primed into the instruction rather than fetched by a round.
/// It has to be on *every* round, not only the first: the instruction is re-sent
/// each time, and a model that had the list on round one and not on round two
/// would resolve the ids it had just been given against nothing.
test("the project's brief rides on the instruction, on every round", async () => {
  const { sent, generate } = saying([call("show_references")], [{ text: "That one." }]);

  await orchestrate({
    message: "show me the hallway",
    brief: "The project holds 1 photograph:\nref-1 · Hallway · 16:9",
    tools: [{ name: "show_references", description: "", parameters: {} }],
    execute: async () => ({ result: { shown: ["ref-1"] } }),
    generate,
  });

  for (const { config } of sent) {
    assert.match(String(config.systemInstruction), /ref-1 · Hallway · 16:9$/);
  }
});

test("a turn with nothing primed is still an instruction", () => {
  const bare = orchestratorInstruction();
  assert.ok(bare.length > 0);
  assert.equal(bare, orchestratorInstruction(""));
  assert.match(orchestratorInstruction("ref-1 · Hallway"), /The project, as it stands:/);
});

test("a tool's answer goes back as a functionResponse under its own name", async () => {
  const { sent, generate } = saying([call("list_references", { includeCrops: true })], [{ text: "done" }]);
  await orchestrate({
    message: "list them",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 2 } }),
    generate,
  });

  const [model, answer] = sent[1]!.contents.slice(-2);
  assert.equal(model!.role, "model");
  assert.deepEqual(answer, {
    role: "user",
    parts: [{ functionResponse: { name: "list_references", response: { total: 2 } } }],
  });
});

test("attachments are gathered across rounds, each picture once", async () => {
  const { generate } = saying(
    [call("show_references", { referenceIds: ["a"] })],
    [call("show_references", { referenceIds: ["a", "b"] })],
    [{ text: "Those two." }],
  );
  const answers: ToolOutcome[] = [
    { result: { shown: ["a"] }, attachments: [reference("a")] },
    { result: { shown: ["a", "b"] }, attachments: [reference("a"), reference("b")] },
  ];
  let asked = 0;

  const { attachments, calls } = await orchestrate({
    message: "show me",
    tools: [{ name: "show_references", description: "", parameters: {} }],
    execute: async () => answers[asked++]!,
    generate,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(
    attachments.map((attachment) => attachment.kind === "reference" && attachment.referenceId),
    ["a", "b"],
  );
});

test("a turn buys at most MAX_TOOL_ROUNDS rounds of tools and then answers", async () => {
  const asking = [call("list_references")];
  const { sent, generate } = saying(asking, asking, asking, [{ text: "Here they are." }]);
  let ran = 0;

  const { reply, calls } = await orchestrate({
    message: "again",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => {
      ran += 1;
      return { result: { total: 1 } };
    },
    generate,
  });

  /// Four calls, three of them executed: the fourth round is the one the loop
  /// makes it answer on, so a model stuck on a tool costs a bounded turn.
  assert.equal(sent.length, 4);
  assert.equal(ran, 3);
  assert.deepEqual(calls.map(({ name }) => name), Array(3).fill("list_references"));
  assert.equal(reply, "Here they are.");
});

/// `MAX_TOOL_ROUNDS` is a ceiling on calls, which is a guess at a bill. This is
/// the reading of it: the turn's own tokens, summed over every round it bought,
/// and the number the run row records.
test("the turn's tokens are every round's, added up", async () => {
  const asking = [call("list_references")];
  const { generate } = saying(asking, asking, [{ text: "Here they are." }]);

  const { usage, model } = await orchestrate({
    message: "again",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 1 } }),
    generate,
  });

  assert.equal(usage.totalTokens, PER_ROUND.totalTokenCount * 3);
  assert.equal(usage.outputTokens, PER_ROUND.candidatesTokenCount * 3);
  /// Named on the way out because a count has to be priced against something,
  /// and the model ids here are preview ids that will be renamed.
  assert.ok(model);
});

/// The tools it calls write run rows of their own. Adding theirs here as well
/// would bill one crop twice, and the crop is the expensive one.
test("a tool's own spend is not counted as the orchestrator's", async () => {
  const { generate } = saying([call("crop_reference")], [{ text: "Have a look." }]);

  const { usage } = await orchestrate({
    message: "crop it",
    tools: [{ name: "crop_reference", description: "", parameters: {} }],
    execute: async () => ({ result: { keeps: "the middle sunflower" } }),
    generate,
  });

  assert.equal(usage.totalTokens, PER_ROUND.totalTokenCount * 2);
});

test("a model still calling tools when the loop stops says so rather than '…'", async () => {
  const asking = [call("list_references")];
  const { generate } = saying(asking, asking, asking, asking);

  const { reply, attachments } = await orchestrate({
    message: "again",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 1 }, attachments: [reference("a")] }),
    generate,
  });

  assert.equal(reply, STUCK_REPLY);
  /// What the rounds did buy is still shown: the pictures were fetched, and a
  /// turn that ran out of steps is not a turn that found nothing.
  assert.equal(attachments.length, 1);
});

test("a tool that throws goes back to the model as data, not as a 500", async () => {
  const { sent, generate } = saying([call("crop_reference")], [{ text: "I could not cut that." }]);
  const { reply } = await orchestrate({
    message: "crop it",
    tools: [{ name: "crop_reference", description: "", parameters: {} }],
    execute: async () => {
      throw new Error("that project has no references yet");
    },
    generate,
  });

  assert.deepEqual(sent[1]!.contents.at(-1), {
    role: "user",
    parts: [
      {
        functionResponse: {
          name: "crop_reference",
          response: { error: "that project has no references yet" },
        },
      },
    ],
  });
  assert.equal(reply, "I could not cut that.");
});

test("tool calls are not executed when there is nothing to execute them with", async () => {
  const { sent, generate } = saying([call("list_references")]);
  const { reply, calls } = await orchestrate({ message: "list", generate });

  assert.equal(sent.length, 1);
  assert.deepEqual(calls, []);
  /// No text part on a round that only asked for a tool, and the reply is still
  /// something a chat bubble can hold.
  assert.equal(reply, "…");
});
