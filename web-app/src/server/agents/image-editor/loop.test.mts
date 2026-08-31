import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EDITOR_CLOSING_ASK,
  EDITOR_NOTHING_ASK,
  EDITOR_PICTURE_CEILING_SAID,
  EDITOR_PICTURE_LIMIT,
  EDITOR_ROUND_LIMIT,
  editorRoundsLeftSaid,
  runImageEditor,
} from "./loop";
import { instructionFor } from "./instruction";
import { editorToolset } from "./toolset";
import type { EditOp } from "@/lib/edit/edit-ops";
import type { Content, GenerateConfig, GeneratePart } from "@/server/google/vertex";

type Part = { text: string } | { functionCall: { name: string; args: Record<string, unknown> } };
type Round = Part[] | { parts?: Part[]; finish: string };

const PER_ROUND = { promptTokenCount: 2000, candidatesTokenCount: 80, totalTokenCount: 2080 };

function saying(...rounds: Round[]) {
  const sent: { model: string; contents: Content[]; config: GenerateConfig }[] = [];
  const generate = (async (model: string, contents: Content[], config: GenerateConfig = {}) => {
    sent.push({ model, contents: JSON.parse(JSON.stringify(contents)) as Content[], config });
    const round = rounds[sent.length - 1];
    assert.ok(round, `the editor asked ${sent.length} times for ${rounds.length} answers`);
    const answered = Array.isArray(round) ? { parts: round, finish: undefined } : round;
    return {
      candidates: [
        {
          content: { parts: answered.parts ?? [] },
          ...(answered.finish && { finishReason: answered.finish }),
        },
      ],
      usageMetadata: PER_ROUND,
    };
  }) as never;
  return { sent, generate };
}

const call = (name: string, args: Record<string, unknown> = {}): Part => ({
  functionCall: { name, args },
});

const STOP: Part[] = [{ text: "that is the edit" }];

const closing = (intent = "the middle sunflower", rationale = "it is the one in focus"): Part[] => [
  { text: JSON.stringify({ intent, rationale }) },
];

const ASK: Content = {
  role: "user",
  parts: [
    { fileData: { fileUri: "gs://bucket/frames/one.jpg", mimeType: "image/jpeg" } },
    { text: "The user wants: the middle sunflower" },
  ],
};

const previewing = () => {
  const seen: EditOp[][] = [];
  let at = 0;
  const preview = async (ops: readonly EditOp[]) => {
    seen.push([...ops]);
    at += 1;
    return { base64: `PREVIEW${at}`, mimeType: "image/jpeg" };
  };
  return { seen, preview };
};

const run = (generate: unknown, rest: Parameters<typeof editorToolset>[0] = {}) =>
  runImageEditor({
    ask: ASK,
    instruction: instructionFor(rest.only),
    toolset: editorToolset(rest),
    generate: generate as never,
  });

const responsesIn = (parts: readonly GeneratePart[]) =>
  parts.flatMap((part) => (part.functionResponse?.name ? [part.functionResponse.name] : []));

const picturesIn = (contents: readonly Content[]) =>
  contents.flatMap((content) => content.parts.filter((part) => part.inlineData)).length;

test("one round of calls, the turn that stops, and the closing line", async () => {
  const { sent, generate } = saying([call("crop", { box: [100, 200, 800, 900] })], STOP, closing());
  const answer = await run(generate);

  assert.equal(sent.length, 3);
  assert.equal(answer.rounds, 1);
  assert.equal(answer.modelCalls, 3);
  assert.deepEqual(answer.ops, [{ op: "crop", box: [100, 200, 800, 900] }]);
  assert.equal(answer.intent, "the middle sunflower");
  assert.equal(answer.rationale, "it is the one in focus");
  assert.equal(answer.usage.totalTokens, PER_ROUND.totalTokenCount * 3);
});

test("every call of a round is applied in the order it was made, and answered", async () => {
  const { sent, generate } = saying(
    [call("crop", { box: [100, 100, 900, 900] }), call("turn", { turn: "right" }), call("grade", { warmth: 20 })],
    STOP,
    closing(),
  );
  const answer = await run(generate);

  assert.equal(answer.rounds, 1);
  assert.deepEqual(
    answer.ops.map((op) => op.op),
    ["crop", "turn", "grade"],
  );

  const results = sent[1]!.contents.at(-1)!;
  assert.deepEqual(responsesIn(results.parts), ["crop", "turn", "grade"]);
});

test("the closing ask comes after the round, with no tool offered on it", async () => {
  const { sent, generate } = saying([call("crop", { box: [100, 100, 900, 900] })], STOP, closing());
  await run(generate);

  const asked = sent[2]!;
  assert.equal(asked.contents.at(-1)!.parts[0]!.text, EDITOR_CLOSING_ASK);
  assert.equal(asked.config.tools, undefined);
  assert.equal(asked.config.responseMimeType, "application/json");
  assert.ok(sent[0]!.config.tools);
});

test("a round that changed the picture shows it once, before the last answer", async () => {
  const { seen, preview } = previewing();
  const { sent, generate } = saying(
    [call("crop", { box: [100, 100, 900, 900] }), call("grade", { warmth: 20 })],
    STOP,
    closing(),
  );
  const answer = await run(generate, { preview });

  assert.equal(answer.pictures, 1);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], answer.ops);

  const results = sent[1]!.contents.at(-1)!;
  assert.equal(results.parts.filter((part) => part.inlineData).length, 1);

  const shownAt = results.parts.findIndex((part) => part.inlineData);
  assert.ok(results.parts[shownAt + 1]!.functionResponse);
  assert.ok(results.parts.at(-1)!.functionResponse, "a tool turn may not end with a picture");
});

test("a round where every call was refused shows no picture", async () => {
  const { seen, preview } = previewing();
  const { sent, generate } = saying(
    [call("grade", { warmth: 0 })],
    [call("grade", { warmth: 20 })],
    STOP,
    closing(),
  );
  const answer = await run(generate, { preview });

  assert.equal(answer.rounds, 2);
  assert.equal(answer.pictures, 1);
  assert.equal(picturesIn(sent[1]!.contents), 0);
  assert.equal(seen.length, 1);
});

test("the same refused call twice ends the loop, and nothing is filed", async () => {
  const { sent, generate } = saying(
    [call("crop", { box: [500, 0, 505, 1000] })],
    [call("crop", { box: [500, 0, 505, 1000] })],
  );
  const answer = await run(generate);

  assert.equal(sent.length, 2);
  assert.equal(answer.stopped, "repeat");
  assert.deepEqual(answer.ops, []);
  assert.match(answer.fault ?? "", /strip rather than a shot/);
});

test("no closing line is bought when nothing was applied", async () => {
  const { sent, generate } = saying([{ text: "there is nothing to do here" }], [{ text: "still nothing" }]);
  const answer = await run(generate);

  assert.equal(sent.length, 2);
  assert.deepEqual(answer.ops, []);
  assert.equal(answer.intent, "");
  assert.equal(sent[1]!.contents.at(-1)!.parts[0]!.text, EDITOR_NOTHING_ASK);
});

test("the round limit stops the calls and the closing line is still bought", async () => {
  const rounds = Array.from({ length: EDITOR_ROUND_LIMIT }, (_unused, at) => [
    call("grade", { warmth: 10 + at }),
  ]);
  const { sent, generate } = saying(...rounds, closing("warmer", "it was grey"));

  const answer = await run(generate);

  assert.equal(answer.rounds, EDITOR_ROUND_LIMIT);
  assert.equal(answer.stopped, "rounds");
  assert.equal(sent.length, EDITOR_ROUND_LIMIT + 1);
  assert.deepEqual(answer.ops, [
    { op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: 10 + EDITOR_ROUND_LIMIT - 1, hue: 0 },
  ]);
  assert.equal(answer.rationale, "it was grey");
});

test("the steps left are said before the last one is spent", async () => {
  const { sent, generate } = saying(
    [call("grade", { warmth: 10 })],
    [call("grade", { warmth: 20 })],
    [call("grade", { warmth: 30 })],
    [call("grade", { warmth: 40 })],
    closing(),
  );
  await run(generate);

  const said = (at: number) =>
    sent[at]!.contents.flatMap((content) => content.parts.map((part) => part.text ?? "")).join(" ");
  assert.doesNotMatch(said(1), /more step/);
  assert.match(said(3), /one more step/);
  assert.match(said(4), /all 4 steps are spent/);
  assert.equal(editorRoundsLeftSaid(0).includes(`all ${EDITOR_ROUND_LIMIT} steps`), true);
});

test("a picture a round is all one edit ever looks at", async () => {
  const { seen, preview } = previewing();
  const grades = Array.from({ length: EDITOR_ROUND_LIMIT }, (_unused, at) => [
    call("grade", { warmth: 10 + at }),
  ]);
  const { sent, generate } = saying(...grades, closing());
  const answer = await run(generate, { preview });

  assert.equal(seen.length, EDITOR_ROUND_LIMIT);
  assert.equal(answer.pictures, EDITOR_ROUND_LIMIT);
  assert.ok(answer.pictures <= EDITOR_PICTURE_LIMIT, EDITOR_PICTURE_CEILING_SAID);
  assert.equal(picturesIn(sent.at(-1)!.contents), EDITOR_PICTURE_LIMIT);
});

test("a call that is not declared is answered rather than thrown", async () => {
  const { generate } = saying(
    [call("grade", { warmth: 20 })],
    [call("crop", { box: [100, 100, 900, 900] })],
    STOP,
    closing(),
  );
  const answer = await run(generate, { only: "crop" });

  assert.equal(answer.rounds, 2);
  assert.deepEqual(answer.ops, [{ op: "crop", box: [100, 100, 900, 900] }]);
});

test("a stop that already names the labels is the close, and buys no second call", async () => {
  const { sent, generate } = saying(
    [call("crop", { box: [100, 100, 900, 900] })],
    [{ text: "intent: the middle sunflower\nrationale: it is the one in focus" }],
  );
  const answer = await run(generate);

  assert.equal(sent.length, 2);
  assert.equal(answer.modelCalls, 2);
  assert.equal(answer.intent, "the middle sunflower");
  assert.equal(answer.rationale, "it is the one in focus");
});

test("the labels are read through the markdown the model puts round them", async () => {
  const { generate } = saying(
    [call("crop", { box: [100, 100, 900, 900] })],
    [{ text: "**intent:** the middle sunflower\n\n**rationale:** it is the one in focus" }],
  );
  const answer = await run(generate);

  assert.equal(answer.intent, "the middle sunflower");
  assert.equal(answer.rationale, "it is the one in focus");
});

test("a closing line that is not JSON is kept as the rationale rather than lost", async () => {
  const { generate } = saying([call("crop", { box: [100, 100, 900, 900] })], STOP, [
    { text: "the middle one, tight" },
  ]);
  const answer = await run(generate);

  assert.equal(answer.intent, "");
  assert.equal(answer.rationale, "the middle one, tight");
});

test("a malformed call is retried once before it is given up on", async () => {
  const { sent, generate } = saying(
    { parts: [], finish: "MALFORMED_FUNCTION_CALL" },
    [call("crop", { box: [100, 100, 900, 900] })],
    STOP,
    closing(),
  );
  const answer = await run(generate);

  assert.equal(sent.length, 4);
  assert.equal(answer.rounds, 1);
  assert.deepEqual(answer.ops, [{ op: "crop", box: [100, 100, 900, 900] }]);
});
