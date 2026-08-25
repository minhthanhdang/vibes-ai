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

/// Agent 6's routing loop, with the model call replaced by a script. What this
/// asserts is the two things the loop alone decides: how many rounds a turn may
/// buy, and what of a tool's answer reaches the user rather than the model.

type Part = { text: string } | { functionCall: { name: string; args: Record<string, unknown> } };

/// What one round costs here. Flat, because the thing worth asserting is that
/// rounds are *added up* — in the real turn each one is dearer than the last,
/// since every round re-sends the conversation with another tool result on it.
const PER_ROUND = { promptTokenCount: 2000, candidatesTokenCount: 80, totalTokenCount: 2080 };

/// A scripted round: the parts it answers with, or — for the rounds that came
/// back with nothing at all — the reason Vertex gave for stopping.
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

/// `generate_image` is the one tool that can take a project from holding
/// nothing to holding a picture without the user doing anything, and the
/// declarations already follow it — the round after the drawing is the round the
/// picture tools arrive on. The prose has to follow it too: handing a model
/// `show_references` and `add_board` under an instruction saying there is
/// nothing to show, cut or design is worse than either half being stale.
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

/// A caller with nothing to re-read still passes what it has, and it rides every
/// round unchanged rather than being read once and dropped.
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

/// The emission goes back as it arrived. Gemini's parts carry fields this loop
/// does not model — the thought signature above all, which the API rejects a
/// later round of the same turn for omitting — and a call may arrive with no
/// args and a sentence beside it. The typed parts are the record; the wire is
/// the bytes, and the next round carries the bytes.
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

/// What comes back beside the reply is the turn as the store will keep it: the
/// rounds in the order they landed, each answer marked for whether it was one,
/// and then the sentence the user was shown.
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
    /// A thrown tool came back as data (`runSafely`), and the record says it
    /// was not an answer — `ok` is the one reading of the response the row
    /// makes, so a degraded result still says whether the call worked.
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

/// The record is of what was said. A round that only asked for a tool nobody
/// gave the loop an executor for has no text on it, and the user was shown the
/// fallback — so the fallback is what the row keeps, not the empty emission.
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

/// The cap read off the constant rather than written out. It was three and it is
/// a hundred, and a test that spelled the number was a test that had to be edited
/// to agree with the change it was meant to hold.
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

  /// One call more than the cap, every one of them but the last executed: the
  /// call after the last round is the one the loop makes it answer on, so a model
  /// stuck on a tool costs a bounded turn.
  assert.equal(sent.length, MAX_TOOL_ROUNDS + 1);
  assert.equal(ran, MAX_TOOL_ROUNDS);
  /// And both numbers are reported, because they are different numbers: the
  /// bill is the calls, the cap is the rounds.
  assert.equal(modelCalls, MAX_TOOL_ROUNDS + 1);
  assert.equal(rounds, MAX_TOOL_ROUNDS);
  assert.deepEqual(
    calls.map(({ name }) => name),
    Array(MAX_TOOL_ROUNDS).fill("list_references"),
  );
  assert.equal(reply, "Here they are.");
});

/// The cap is no longer the guard, so the number it is set to has to be a number
/// real work can reach the end of. Three could not: the session that prompted
/// this asked for a sketch as a background with five pictures laid into its
/// slots, which is a layout read, a put, a reorder and a crop apiece — and it
/// died on round four telling the user it had run out of steps.
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

/// The bound that replaced the round cap, and the one that is a reading rather
/// than a guess: a turn whose rounds are enormous is stopped by what they cost
/// and not by how many of them there were.
test("a turn is stopped by what it has spent, not only by how many rounds it bought", async () => {
  const asked: Content[][] = [];
  /// A quarter of the ceiling a round, so the fourth round crosses it — far
  /// inside `MAX_TOOL_ROUNDS`, which is the whole point of the assertion.
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
  /// The same exit the round cap takes: the model was mid-call and wrote no
  /// sentence, so without this the user reads "…" under whatever it fetched.
  assert.equal(reply, STUCK_REPLY);
});

/// A hundred rounds each re-sending every round before it is the accident the
/// window exists to stop. What the model is sent on the last round is the recent
/// end of the turn's own work, and a line saying the rest happened.
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
  /// The user's turn, the window's line, and the rounds that fitted — in pairs,
  /// because half a round is a request Vertex refuses.
  assert.equal(last.length, 1 + TOOL_ROUND_LIMIT * 2);
  assert.equal(last[0]!.role, "user");

  /// What round 5 filed is still readable on round 100, which is what stops the
  /// model cropping the same picture twice.
  const summary = last[0]!.parts.at(-1)!;
  assert.ok(summary.text?.includes("cut-5"));
  assert.ok(summary.text?.includes("Do not make them again"));

  /// And the message itself is still in front of it. The picture the user
  /// attached rides in this turn, so a window that could reach it makes the last
  /// round blind to the thing the turn is about.
  assert.deepEqual(last[0]!.parts[0], { text: "crop them all" });
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
  const { generate } = saying(...asking(), [call("list_references")]);

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
/// user was shown "…" and billed for it.
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
/// turn that stumbles once still gets every round the cap allows.
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
  /// The stumble is free of the cap and not free of the bill — which is the
  /// whole reason the two are counted apart.
  assert.equal(rounds, MAX_TOOL_ROUNDS);
  assert.equal(modelCalls, MAX_TOOL_ROUNDS + 2);
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
      /// The two-call routing, which is the whole of what replaced the compose
      /// paragraph: a board comes from one tool and what goes on it from the
      /// other, and a project with no board still has to be told both.
      gallery.includes("add_board") &&
      gallery.includes("design_page"),
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

/// The instruction rides on every round of every turn, and this is the paragraph
/// that inverted rather than changed: "It does not cut anything", "leave the
/// decision with them" and "never that you have cropped or saved anything" were
/// all true of a tool that ended at a box and are all false of one that files a
/// row. Left standing, they are a model reporting the cut it has just made as a
/// decision still waiting on the user.
test("the cropping section tells the model the cut is filed, not offered", () => {
  const said = orchestratorInstruction("", { photographs: 4, crops: 0, boards: 0 }).replace(
    /\s+/g,
    " ",
  );

  assert.match(said, /It cuts the picture and files the cut/);
  assert.match(said, /the frame it came out of is untouched/);
  /// The way out, in the sentence that announces the cut: a cut nobody wanted
  /// now costs a row rather than nothing.
  assert.match(said, /discard_reference removes a cut nobody wanted/);
  /// The routing that survived, now the whole of the last sentence: which frame
  /// to cut, and nothing about stopping to ask.
  assert.match(said, /Crop when a cut is asked for, on the frame it is about/);

  for (const offered of [
    "It does not cut anything",
    "they take it or leave it",
    "leave the decision with them",
    "never that you have cropped or saved anything",
    /// A cut is filed the moment it is made and discard_reference is the way
    /// back, so a turn spent asking which of two crops to make is a turn spent
    /// to be told to make one of them.
    "if several would do then ask which",
  ]) {
    assert.ok(!said.includes(offered), `the model is still told “${offered}”`);
  }
});

/// The board half, gated on there being a board to cut for. Its "do not swap it
/// on afterwards" advice survived the change and its reason did not: the swap
/// used to follow the user accepting the cut, and it is now made in the call.
test("the board half of the cropping section says the swap is already made", () => {
  const said = orchestratorInstruction("", { photographs: 4, crops: 1, boards: 1 }).replace(
    /\s+/g,
    " ",
  );

  assert.match(said, /put in that picture's place there in the same call/);
  assert.match(said, /say the board has changed/);
  assert.match(said, /do not call swap_on_board afterwards/);

  for (const offered of ["taking it also puts it", "accepting it is all it needs"]) {
    assert.ok(!said.includes(offered), `the model is still told “${offered}”`);
  }
});

/// The one section gated on nothing. `generate_image` is declared to every
/// project including the empty one, so the paragraph steering it has to stand
/// there too — the state only decides whether there is anything to prefer over
/// a drawn picture.
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

/// The state the empty project is in one round after it draws: it has pictures,
/// and every one of them came out of this tool. "Prefer theirs" is the empty
/// project's false premise again, one step on — and the steer it is replaced by
/// is the one thing nothing here used to say, since the per-turn ceiling does
/// not carry across turns.
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
  /// The section itself is unmoved: only the sentence under it is chosen.
  assert.match(drawn, /call generate_image/);
  assert.match(drawn, /made rather than found/);

  /// One photograph of theirs beside two drawings is still a project with
  /// something to prefer, and a cut counts as one of theirs unless it was cut
  /// out of a drawing — which is what the count is over.
  assert.match(
    orchestratorInstruction("", { photographs: 3, crops: 0, boards: 0, generated: 2 }),
    /A photograph of theirs that fits/,
  );
  assert.match(
    orchestratorInstruction("", { photographs: 1, crops: 1, boards: 0, generated: 1 }),
    /A photograph of theirs that fits/,
  );

  /// A caller that has not counted the drawings is not claiming there are none.
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
    "swap_on_board",
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

/// tech-spec §V.5: the page the user attached and their own words are one
/// user turn — the picture of the page, the page in words, then the sentence.
/// The other way round is a question about nothing.
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
  /// Still there on the answering round: a model reading a tool result about a
  /// board is still looking at the page it was handed.
  assert.deepEqual(sent[1]!.contents[0], sent[0]!.contents[0]);
});

/// The eligibility floor (tech-spec §I, §II) is a claim about what this agent
/// *calls*, not about what `MODELS` declares — `FLASH` was declared and unused
/// for five agents' worth of history, and the spec read as though it were not.
/// Asserted against the literal id rather than the alias, because an alias
/// repointed at a 3.1 model would satisfy every other test in this file.
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
  /// And the model the run row is priced against is the one that did the work.
  assert.equal(turn.model, "gemini-3.7-flash");
});
