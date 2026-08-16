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

/// A scripted round: the parts it answers with, or — for the rounds that came
/// back with nothing at all — the reason Vertex gave for stopping.
type Round = Part[] | { parts?: Part[]; finish: string };

function saying(...rounds: Round[]) {
  const sent: { contents: Content[]; config: GenerateConfig }[] = [];
  const generate = (async (_model: string, contents: Content[], config: GenerateConfig = {}) => {
    sent.push({ contents: JSON.parse(JSON.stringify(contents)) as Content[], config });
    const round = rounds[sent.length - 1];
    assert.ok(round, `the orchestrator asked ${sent.length} times for ${rounds.length} answers`);
    const answered = Array.isArray(round) ? { parts: round, finish: undefined } : round;
    return {
      candidates: [
        { content: { parts: answered.parts ?? [] }, ...(answered.finish && { finishReason: answered.finish }) },
      ],
      usageMetadata: PER_ROUND,
    };
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

/// Iteration 15, off a real turn: a message asking for two different things came
/// back with no text, no function call and 851 output tokens of thinking. The
/// director was shown "…" and billed for it.
test("a round that came back with nothing says why, rather than trailing off", async () => {
  const { generate } = saying({ finish: "MAX_TOKENS" });
  const { reply, finish } = await orchestrate({ message: "everything, at once", generate });

  assert.match(reply, /ran out of room/);
  assert.notEqual(reply, "…");
  /// Carried out so the turn's row can hold it — a reply that answered nothing
  /// should be readable afterwards as what it was.
  assert.equal(finish, "MAX_TOKENS");
});

test("a malformed tool call is asked once more, and lands", async () => {
  const { sent, generate } = saying({ finish: "MALFORMED_FUNCTION_CALL" }, [
    { text: "Took it off, and here is the cut." },
  ]);
  const { reply } = await orchestrate({
    message: "take it off the board and crop the other one",
    tools: [{ name: "compose_moodboard", description: "", parameters: {} }],
    execute: async () => ({ result: {} }),
    generate,
  });

  assert.equal(sent.length, 2);
  assert.equal(reply, "Took it off, and here is the cut.");
});

test("a malformed call twice over is told plainly rather than asked a third time", async () => {
  const { sent, generate } = saying(
    { finish: "MALFORMED_FUNCTION_CALL" },
    { finish: "MALFORMED_FUNCTION_CALL" },
  );
  const { reply } = await orchestrate({
    message: "two things at once",
    tools: [{ name: "compose_moodboard", description: "", parameters: {} }],
    execute: async () => ({ result: {} }),
    generate,
  });

  assert.equal(sent.length, 2);
  assert.match(reply, /one thing at a time/);
});

/// The retry adds no tool result to the conversation, so it is not a round — a
/// turn that stumbles once still gets the three the cap allows.
test("the retry does not eat a tool round", async () => {
  const asking = [call("list_references")];
  const { sent, generate } = saying(asking, { finish: "MALFORMED_FUNCTION_CALL" }, asking, asking, asking);

  const { reply, calls } = await orchestrate({
    message: "again",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 1 } }),
    generate,
  });

  assert.equal(sent.length, 5);
  assert.equal(calls.length, 3);
  assert.equal(reply, STUCK_REPLY);
});

/// The other empty answers are decisions, not stumbles: asking again unchanged
/// buys the same no at the price of another round.
test("an answer that was refused is not bought twice", async () => {
  const { sent, generate } = saying({ finish: "SAFETY" });
  const { reply } = await orchestrate({ message: "no", generate });

  assert.equal(sent.length, 1);
  assert.match(reply, /could not answer/);
});

test("the instruction leaves out what this project has nothing to call it on", () => {
  /// The instruction is re-sent on every round of every turn, so a paragraph
  /// about a tool this project cannot use costs exactly what the tool's own
  /// declaration costs. The sections are gated on the same three counts.
  const empty = orchestratorInstruction("", {
    photographs: 0,
    crops: 0,
    boards: 0,
  });
  assert.match(empty, /Nothing has been uploaded to this project yet/);
  for (const absent of [
    "show_references",
    "crop_reference",
    "compose_moodboard",
    "inspect_board",
  ]) {
    assert.ok(
      !empty.includes(absent),
      `${absent} is described to a project with no pictures`,
    );
  }

  const gallery = orchestratorInstruction("", {
    photographs: 4,
    crops: 0,
    boards: 0,
  });
  assert.ok(
    gallery.includes("show_references") &&
      gallery.includes("compose_moodboard"),
  );
  /// No board, so nothing that takes a board id and nothing about cutting for
  /// one — the longest section in the file, on the commonest project state.
  for (const absent of [
    "inspect_board",
    "swap_on_board",
    "list_references",
    "boardId",
  ]) {
    assert.ok(
      !gallery.includes(absent),
      `${absent} is described to a project with no boards`,
    );
  }
  assert.ok(
    gallery.length <
      orchestratorInstruction("", { photographs: 4, crops: 2, boards: 1 })
        .length,
  );
});

test("a caller that does not say what the project holds gets the whole instruction", () => {
  const full = orchestratorInstruction();
  for (const named of [
    "list_references",
    "show_references",
    "crop_reference",
    "inspect_board",
    "swap_on_board",
    "compose_moodboard",
  ]) {
    assert.ok(
      full.includes(named),
      `${named} is missing from the unqualified instruction`,
    );
  }
  assert.equal(
    full,
    orchestratorInstruction("", { photographs: 1, crops: 1, boards: 1 }),
  );
});

test("the tools are resolved per round, so a board filed mid-turn can be read on the next", async () => {
  const { sent, generate } = saying(
    [call("compose_moodboard", {})],
    [{ text: "Filed." }],
  );
  let boards = 0;
  await orchestrate({
    message: "make me a board",
    tools: () =>
      boards > 0
        ? [
            { name: "compose_moodboard", description: "", parameters: {} },
            { name: "inspect_board", description: "", parameters: {} },
          ]
        : [{ name: "compose_moodboard", description: "", parameters: {} }],
    execute: async () => {
      boards += 1;
      return { result: { boardId: "board-1" } };
    },
    generate,
  });

  const namesOf = (index: number) =>
    (sent[index]!.config.tools?.[0]?.functionDeclarations ?? []).map(
      (tool) => tool.name,
    );
  assert.deepEqual(namesOf(0), ["compose_moodboard"]);
  assert.deepEqual(namesOf(1), ["compose_moodboard", "inspect_board"]);
});

/// The board's own rule, at the level the chat reads it. The instruction tells
/// the model to read a board before it changes one, so the two-round turn is
/// `inspect_board` and then an edit of the same board — and first-wins drew the
/// strip from the read, which is the board as it was before the change.
test("a board read and then edited in one turn is drawn as it ends up", async () => {
  const { generate } = saying(
    [call("inspect_board", { boardId: "b1" })],
    [call("swap_on_board", { boardId: "b1" })],
    [{ text: "Swapped." }],
  );
  const boardTile = (caption: string): ChatAttachment => ({
    kind: "board",
    boardId: "b1",
    title: "Act one",
    caption,
    thumbUrl: null,
    preview: null,
    lines: [],
    linesOver: 0,
  });
  const answers: ToolOutcome[] = [
    { result: { boardId: "b1" }, attachments: [boardTile("as it was")] },
    { result: { boardId: "b1" }, attachments: [boardTile("after the swap")] },
  ];
  let asked = 0;

  const { attachments } = await orchestrate({
    message: "put the cut on that board",
    tools: [{ name: "inspect_board", description: "", parameters: {} }],
    execute: async () => answers[asked++]!,
    generate,
  });

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]?.caption, "after the swap");
});
