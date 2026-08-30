import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TOOL_ROUNDS,
  STUCK_REPLY,
  TURN_TOKEN_CEILING,
  orchestrate,
  orchestratorInstruction,
} from "./orchestrator";
import { TOOL_ROUND_LIMIT } from "@/lib/agent/shared/tool-window";
import type { ChatAttachment, ToolOutcome } from "@/lib/agent/shared/attachments";
import type { Content, GenerateConfig } from "@/server/google/vertex";

type Part = { text: string } | { functionCall: { name: string; args: Record<string, unknown> } };

const PER_ROUND = { promptTokenCount: 2000, candidatesTokenCount: 80, totalTokenCount: 2080 };

type Round = Part[] | { parts?: Part[]; finish: string };

function saying(...rounds: Round[]) {
  const sent: { model: string; contents: Content[]; config: GenerateConfig }[] = [];
  const generate = (async (model: string, contents: Content[], config: GenerateConfig = {}) => {
    sent.push({ model, contents: JSON.parse(JSON.stringify(contents)) as Content[], config });
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

test("the instruction follows the project into the turn, like the declarations", async () => {
  const { sent, generate } = saying([call("generate_image")], [{ text: "I drew you one." }]);
  let drawn = false;

  await orchestrate({
    message: "I need a paper texture behind it",
    brief: () =>
      drawn
        ? "The project holds 1 photograph:\nref-1 · Paper texture · 3:2 · generated"
        : "The project holds no photographs yet.",
    state: () => ({ photographs: drawn ? 1 : 0, crops: 0, boards: 0 }),
    tools: () => [{ name: "generate_image", description: "", parameters: {} }],
    execute: async () => {
      drawn = true;
      return { result: { imageId: "ref-1" } };
    },
    generate,
  });

  const asked = sent.map(({ config }) => String(config.systemInstruction));
  assert.match(asked[0]!, /Nothing has been uploaded to this project yet/);
  assert.ok(!asked[0]!.includes("design_page"), asked[0]);

  assert.ok(!asked[1]!.includes("Nothing has been uploaded"), asked[1]);
  assert.ok(asked[1]!.includes("add_board") && asked[1]!.includes("crop_reference"));
  assert.match(asked[1]!, /ref-1 · Paper texture · 3:2 · generated$/);
});

test("a brief and a state given as values ride every round", async () => {
  const { sent, generate } = saying([call("show_references")], [{ text: "That one." }]);

  await orchestrate({
    message: "show me the hallway",
    brief: "ref-1 · Hallway · 16:9",
    state: { photographs: 1, crops: 0, boards: 0 },
    tools: [{ name: "show_references", description: "", parameters: {} }],
    execute: async () => ({ result: { shown: ["ref-1"] } }),
    generate,
  });

  assert.equal(sent.length, 2);
  for (const { config } of sent) {
    assert.match(String(config.systemInstruction), /ref-1 · Hallway · 16:9$/);
    assert.ok(!String(config.systemInstruction).includes("Nothing has been uploaded"));
  }
});

test("a turn with nothing primed is still an instruction", () => {
  const bare = orchestratorInstruction();
  assert.ok(bare.length > 0);
  assert.equal(bare, orchestratorInstruction(""));
  assert.match(orchestratorInstruction("ref-1 · Hallway"), /The project, as it stands:/);
});

test("what the model emitted goes back verbatim — signature, interim text, missing args", async () => {
  const emission = [
    { text: "Let me look.", thoughtSignature: "sig-text" },
    { functionCall: { name: "list_references" }, thoughtSignature: "sig-call" },
  ] as unknown as Content[][number]["parts"];
  const { sent, generate } = saying(emission as never, [{ text: "Three of them." }]);

  const { calls } = await orchestrate({
    message: "what have I got?",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 3 } }),
    generate,
  });

  assert.deepEqual(sent[1]!.contents.at(-2), { role: "model", parts: emission });
  assert.deepEqual(calls, [{ name: "list_references", args: {} }]);
});

test("the returned parts are the rounds and then the reply", async () => {
  const { generate } = saying(
    [{ text: "Let me look." }, call("list_references")],
    [call("crop_reference", { referenceId: "r1" })],
    [{ text: "The cut failed, but here is what you have." }],
  );
  const answers = [
    async () => ({ result: { total: 3 } }),
    async () => {
      throw new Error("no such reference");
    },
  ];
  let asked = 0;

  const { parts } = await orchestrate({
    message: "list them, then cut the first",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: () => answers[asked++]!(),
    generate,
  });

  assert.deepEqual(parts, [
    { type: "text", text: "Let me look.", wire: { text: "Let me look." } },
    {
      type: "call",
      callId: "1.1",
      name: "list_references",
      args: {},
      wire: { functionCall: { name: "list_references", args: {} } },
    },
    { type: "result", callId: "1.1", name: "list_references", ok: true, response: { total: 3 } },
    {
      type: "call",
      callId: "2.1",
      name: "crop_reference",
      args: { referenceId: "r1" },
      wire: { functionCall: { name: "crop_reference", args: { referenceId: "r1" } } },
    },
    {
      type: "result",
      callId: "2.1",
      name: "crop_reference",
      ok: false,
      response: { error: "no such reference" },
    },
    { type: "text", text: "The cut failed, but here is what you have." },
  ]);
});

test("the recorded answer is the sentence the user was shown, fallbacks included", async () => {
  const { generate } = saying([call("list_references")]);
  const { parts } = await orchestrate({ message: "list", generate });

  assert.deepEqual(parts.at(-1), { type: "text", text: "…" });
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

const asking = () => Array<Round>(MAX_TOOL_ROUNDS).fill([call("list_references")]);

test("a turn buys at most MAX_TOOL_ROUNDS rounds of tools and then answers", async () => {
  const { sent, generate } = saying(...asking(), [{ text: "Here they are." }]);
  let ran = 0;

  const { reply, calls, rounds, modelCalls } = await orchestrate({
    message: "again",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => {
      ran += 1;
      return { result: { total: 1 } };
    },
    generate,
  });

  assert.equal(sent.length, MAX_TOOL_ROUNDS + 1);
  assert.equal(ran, MAX_TOOL_ROUNDS);
  assert.equal(modelCalls, MAX_TOOL_ROUNDS + 1);
  assert.equal(rounds, MAX_TOOL_ROUNDS);
  assert.deepEqual(
    calls.map(({ name }) => name),
    Array(MAX_TOOL_ROUNDS).fill("list_references"),
  );
  assert.equal(reply, "Here they are.");
});

test("a turn long enough to place a background and crop for its slots finishes", async () => {
  const script: Round[] = [
    [call("inspect_board")],
    [call("put_on_canvas")],
    [call("reorder_on_canvas")],
    ...Array<Round>(5).fill([call("crop_reference")]),
    [{ text: "The sketch is behind them and all five are in their slots." }],
  ];
  const { generate } = saying(...script);

  const { reply, rounds } = await orchestrate({
    message: "use the sketch as the background and lay my five into its slots",
    tools: [{ name: "crop_reference", description: "", parameters: {} }],
    execute: async () => ({ result: { referenceId: "cut-1" } }),
    generate,
  });

  assert.equal(rounds, script.length - 1);
  assert.notEqual(reply, STUCK_REPLY);
  assert.match(reply, /all five are in their slots/);
});

test("a turn is stopped by what it has spent, not only by how many rounds it bought", async () => {
  const asked: Content[][] = [];
  const perRound = Math.ceil(TURN_TOKEN_CEILING / 4);
  const generate = (async (_model: string, contents: Content[]) => {
    asked.push(contents);
    return {
      candidates: [{ content: { parts: [call("list_references")] } }],
      usageMetadata: { promptTokenCount: perRound, candidatesTokenCount: 0, totalTokenCount: perRound },
    };
  }) as never;

  const { reply, rounds, usage } = await orchestrate({
    message: "again",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 1 } }),
    generate,
  });

  assert.equal(asked.length, 4);
  assert.equal(rounds, 3);
  assert.ok(rounds < MAX_TOOL_ROUNDS);
  assert.ok(usage.totalTokens >= TURN_TOKEN_CEILING);
  assert.equal(reply, STUCK_REPLY);
});

test("a long turn sends the recent end of its own work, not all of it", async () => {
  const { sent, generate } = saying(...asking(), [{ text: "Done." }]);
  let filed = 0;

  const { rounds, roundsDropped } = await orchestrate({
    message: "crop them all",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { referenceId: `cut-${(filed += 1)}` } }),
    generate,
  });

  assert.equal(rounds, MAX_TOOL_ROUNDS);
  assert.equal(roundsDropped, MAX_TOOL_ROUNDS - TOOL_ROUND_LIMIT);

  const last = sent.at(-1)!.contents;
  assert.equal(last.length, 1 + TOOL_ROUND_LIMIT * 2);
  assert.equal(last[0]!.role, "user");

  const summary = last[0]!.parts.at(-1)!;
  assert.ok(summary.text?.includes("cut-5"));
  assert.ok(summary.text?.includes("Do not make them again"));

  assert.deepEqual(last[0]!.parts[0], { text: "crop them all" });
});

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
  assert.ok(model);
});

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
  const { generate } = saying(...asking(), [call("list_references")]);

  const { reply, attachments } = await orchestrate({
    message: "again",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 1 }, attachments: [reference("a")] }),
    generate,
  });

  assert.equal(reply, STUCK_REPLY);
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
  assert.equal(reply, "…");
});

test("a round that came back with nothing says why, rather than trailing off", async () => {
  const { generate } = saying({ finish: "MAX_TOKENS" });
  const { reply, finish } = await orchestrate({ message: "everything, at once", generate });

  assert.match(reply, /ran out of room/);
  assert.notEqual(reply, "…");
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

test("the retry does not eat a tool round", async () => {
  const { sent, generate } = saying(
    [call("list_references")],
    { finish: "MALFORMED_FUNCTION_CALL" },
    ...asking(),
  );

  const { reply, calls, rounds, modelCalls } = await orchestrate({
    message: "again",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 1 } }),
    generate,
  });

  assert.equal(sent.length, MAX_TOOL_ROUNDS + 2);
  assert.equal(calls.length, MAX_TOOL_ROUNDS);
  assert.equal(reply, STUCK_REPLY);
  assert.equal(rounds, MAX_TOOL_ROUNDS);
  assert.equal(modelCalls, MAX_TOOL_ROUNDS + 2);
});

test("an answer that was refused is not bought twice", async () => {
  const { sent, generate } = saying({ finish: "SAFETY" });
  const { reply } = await orchestrate({ message: "no", generate });

  assert.equal(sent.length, 1);
  assert.match(reply, /could not answer/);
});

test("the instruction leaves out what this project has nothing to call it on", () => {
  const empty = orchestratorInstruction("", {
    photographs: 0,
    crops: 0,
    boards: 0,
  });
  assert.match(empty, /Nothing has been uploaded to this project yet/);
  for (const absent of [
    "show_references",
    "crop_reference",
    "discard_reference",
    "add_board",
    "design_page",
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
      gallery.includes("discard_reference") &&
      gallery.includes("add_board") &&
      gallery.includes("design_page"),
  );
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

test("the cropping section tells the model the cut is filed, not offered", () => {
  const said = orchestratorInstruction("", { photographs: 4, crops: 0, boards: 0 }).replace(
    /\s+/g,
    " ",
  );

  assert.match(said, /It cuts the picture and files the cut/);
  assert.match(said, /the frame it came out of is untouched/);
  assert.match(said, /discard_reference removes a cut nobody wanted/);
  assert.match(said, /Crop when a cut is asked for, on the frame it is about/);

  for (const offered of [
    "It does not cut anything",
    "they take it or leave it",
    "leave the decision with them",
    "never that you have cropped or saved anything",
    "if several would do then ask which",
  ]) {
    assert.ok(!said.includes(offered), `the model is still told “${offered}”`);
  }
});

test("the board half of the cropping section says the swap is already made", () => {
  const said = orchestratorInstruction("", { photographs: 4, crops: 1, boards: 1 }).replace(
    /\s+/g,
    " ",
  );

  assert.match(said, /put in that picture's place there in the same call/);
  assert.match(said, /say the board has changed/);
  assert.match(said, /Nothing else is owed/);
  assert.ok(!said.includes("swap_on_board"), "the model is sent to a tool it has not got");

  for (const offered of ["taking it also puts it", "accepting it is all it needs"]) {
    assert.ok(!said.includes(offered), `the model is still told “${offered}”`);
  }
});

test("the picture-making section stands on every project, the empty one included", () => {
  const shapes = [
    { photographs: 0, crops: 0, boards: 0 },
    { photographs: 4, crops: 0, boards: 0 },
    { photographs: 4, crops: 2, boards: 1 },
  ];
  for (const shape of shapes) {
    const instruction = orchestratorInstruction("", shape);
    assert.match(instruction, /generate_image/, `nothing steers generate_image on ${JSON.stringify(shape)}`);
    assert.match(instruction, /made rather than found/);
  }

  const empty = orchestratorInstruction("", shapes[0]!);
  assert.ok(
    !empty.includes("A photograph of theirs that fits"),
    "the empty project is told to prefer pictures it does not have",
  );
  assert.match(orchestratorInstruction("", shapes[1]!), /A photograph of theirs that fits/);
});

test("a project holding only its own drawings is steered to reuse them, not to prefer theirs", () => {
  const drawn = orchestratorInstruction("", {
    photographs: 1,
    crops: 0,
    boards: 0,
    generated: 1,
  });

  assert.ok(
    !drawn.includes("A photograph of theirs that fits"),
    "a project with no photograph of theirs is told to prefer one",
  );
  assert.match(drawn, /Look at what you have already drawn first/);
  assert.match(drawn, /Reach for the one you have wherever it fits/);
  assert.match(drawn, /call generate_image/);
  assert.match(drawn, /made rather than found/);

  assert.match(
    orchestratorInstruction("", { photographs: 3, crops: 0, boards: 0, generated: 2 }),
    /A photograph of theirs that fits/,
  );
  assert.match(
    orchestratorInstruction("", { photographs: 1, crops: 1, boards: 0, generated: 1 }),
    /A photograph of theirs that fits/,
  );

  assert.match(
    orchestratorInstruction("", { photographs: 1, crops: 0, boards: 0 }),
    /A photograph of theirs that fits/,
  );
});

test("the limits permit drawing a picture and still forbid inventing one", () => {
  const limits = orchestratorInstruction();

  assert.match(limits, /Never invent image URLs/);
  assert.match(limits, /never describe images you have not been given/);
  assert.match(limits, /cannot fetch images/);
  assert.ok(
    !limits.includes("cannot fetch, search or edit images"),
    "the model is still told it cannot make a picture",
  );
});

test("a caller that does not say what the project holds gets the whole instruction", () => {
  const full = orchestratorInstruction();
  for (const named of [
    "list_references",
    "show_references",
    "crop_reference",
    "discard_reference",
    "inspect_board",
    "add_board",
    "design_page",
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
    images: 2,
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

test("an attached page rides in front of the message, on every round of the turn", async () => {
  const { sent, generate } = saying(
    [call("inspect_board", { boardId: "board-7" })],
    [{ text: "the right half is empty" }],
  );

  await orchestrate({
    message: "what is missing?",
    attached: [
      { fileData: { fileUri: "gs://bucket/page.png", mimeType: "image/png" } },
      { text: "The user attached “Act one”…" },
    ],
    generate,
    execute: async () => ({ result: { ok: true } }) as ToolOutcome,
  });

  assert.deepEqual(sent[0]!.contents[0], {
    role: "user",
    parts: [
      { fileData: { fileUri: "gs://bucket/page.png", mimeType: "image/png" } },
      { text: "The user attached “Act one”…" },
      { text: "what is missing?" },
    ],
  });
  assert.deepEqual(sent[1]!.contents[0], sent[0]!.contents[0]);
});

test("every round of the turn goes to the 3.5-floor model", async () => {
  const { sent, generate } = saying(
    [call("list_references")],
    [{ text: "you have two pictures in here" }],
  );

  const turn = await orchestrate({
    message: "what have I got?",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 0 } }),
    generate,
  });

  assert.deepEqual(
    sent.map((round) => round.model),
    ["gemini-3.7-flash", "gemini-3.7-flash"],
  );
  assert.equal(turn.model, "gemini-3.7-flash");
});
