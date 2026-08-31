import { test } from "node:test";
import assert from "node:assert/strict";

import { ImageEditorError, editReference } from "./image-editor";
import { EDITOR_ROUND_LIMIT } from "./loop";
import { spentThrown } from "@/lib/agent/shared/model-cost";
import type { Content, GenerateConfig } from "@/server/google/vertex";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { looseShapeOf } from "@/lib/references/reference-version";
import type { EditOp } from "@/lib/edit/edit-ops";
import type { EditPreview } from "@/server/references/edits";

type Part = { text: string } | { functionCall: { name: string; args: Record<string, unknown> } };

const PER_READ = { promptTokenCount: 1000, candidatesTokenCount: 10, totalTokenCount: 1010 };

const call = (name: string, args: Record<string, unknown> = {}): Part => ({
  functionCall: { name, args },
});

const cropping = (box: unknown): Part[] => [call("crop", { box })];

const STOP: Part[] = [{ text: "that is the edit" }];

const closing = (intent = "the middle sunflower", rationale = "it is the one in focus"): Part[] => [
  { text: JSON.stringify({ intent, rationale }) },
];

function answering(...rounds: Part[][]) {
  const asked: Content[][] = [];
  const models: string[] = [];
  const configs: GenerateConfig[] = [];
  const generate = async (model: string, contents: Content[], config: GenerateConfig = {}) => {
    models.push(model);
    configs.push(config);
    asked.push(JSON.parse(JSON.stringify(contents)) as Content[]);
    const round = rounds[asked.length - 1];
    assert.ok(round, `the image editor asked ${asked.length} times for ${rounds.length} answers`);
    return {
      candidates: [{ content: { parts: round } }],
      usageMetadata: PER_READ,
    };
  };
  return { asked, models, configs, generate };
}

const ask = (generate: unknown, rest: Record<string, unknown> = {}) =>
  editReference({
    gcsUri: "gs://bucket/frames/one.jpg",
    prompt: "the middle sunflower",
    title: "Sunflowers",
    generate: generate as never,
    ...rest,
  });

const answersIn = (contents: readonly Content[]) =>
  contents.flatMap((content) =>
    content.parts.flatMap((part) =>
      part.functionResponse ? [part.functionResponse.response as Record<string, unknown>] : [],
    ),
  );

const errorsIn = (contents: readonly Content[]) =>
  answersIn(contents).flatMap((response) =>
    typeof response.error === "string" ? [response.error] : [],
  );

test("a usable crop on the first round is one round and no pictures", async () => {
  const { asked, generate } = answering(cropping([100, 200, 800, 900]), STOP, closing());

  const answer = await ask(generate);
  assert.equal(asked.length, 3);
  assert.equal(answer.attempts, 1);
  assert.equal(answer.looks, 0);
  assert.deepEqual(answer.box, { ymin: 100, xmin: 200, ymax: 800, xmax: 900 });
  assert.deepEqual(answer.ops, [{ op: "crop", box: [100, 200, 800, 900] }]);
  assert.equal(answer.intent, "the middle sunflower");
  assert.equal(answer.rationale, "it is the one in focus");
});

test("a strip is answered with what was wrong with it, and the second call is kept", async () => {
  const { asked, generate } = answering(
    cropping([500, 100, 508, 900]),
    cropping([200, 100, 900, 800]),
    STOP,
    closing(),
  );

  const answer = await ask(generate);
  assert.equal(answer.attempts, 2);
  assert.deepEqual(answer.box, { ymin: 200, xmin: 100, ymax: 900, xmax: 800 });

  const [, second] = asked;
  assert.equal(second!.length, 3);
  assert.equal(second![0]!.role, "user");
  assert.ok(second![0]!.parts.some((part) => part.fileData));
  assert.equal(second![1]!.role, "model");
  assert.equal(second![2]!.role, "user");
  assert.match(errorsIn(second!)[0] ?? "", /8\/1000 of the frame's height/);
});

test("the frame is sent once per round and never twice within one", async () => {
  const { asked, generate } = answering(
    cropping([0, 0, 4, 4]),
    cropping([10, 10, 14, 14]),
    cropping([100, 100, 900, 900]),
    STOP,
    closing(),
  );

  await ask(generate);
  for (const contents of asked) {
    const frames = contents.flatMap((turn) => turn.parts.filter((part) => part.fileData));
    assert.equal(frames.length, 1);
  }
});

test("a round spent refusing every call is a round spent, and the limit ends it", async () => {
  const { asked, generate } = answering(
    cropping([0, 0, 4, 1000]),
    cropping([10, 0, 18, 1000]),
    cropping([20, 0, 28, 1000]),
    cropping([30, 0, 38, 1000]),
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof ImageEditorError);
    assert.match(error.message, /could not answer with a usable edit/);
    return true;
  });
  assert.equal(asked.length, EDITOR_ROUND_LIMIT);
});

test("the same unusable call twice ends it early", async () => {
  const { asked, generate } = answering(
    cropping([500, 0, 505, 1000]),
    cropping([500, 0, 505, 1000]),
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof ImageEditorError);
    assert.match(error.message, /same unusable edit twice/);
    return true;
  });
  assert.equal(asked.length, 2);
});

test("an editor that calls nothing at all files nothing", async () => {
  const { generate } = answering([{ text: "there is nothing to crop here" }], STOP);

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof ImageEditorError);
    assert.match(error.message, /made no edit/);
    return true;
  });
});

test("the whole frame is a crop, not a refusal", async () => {
  const { asked, generate } = answering(
    cropping([0, 0, 1000, 1000]),
    STOP,
    closing("the field"),
  );

  const answer = await ask(generate);
  assert.equal(asked.length, 3);
  assert.deepEqual(answer.box, { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 });
  assert.equal(answer.intent, "the field");
});

test("the tokens of every round are added up, not read off the last one", async () => {
  const { generate } = answering(
    cropping([500, 0, 505, 1000]),
    cropping([100, 100, 900, 900]),
    STOP,
    closing(),
  );

  const answer = await ask(generate);
  assert.equal(answer.attempts, 2);
  assert.deepEqual(answer.usage, {
    promptTokens: PER_READ.promptTokenCount * 4,
    outputTokens: PER_READ.candidatesTokenCount * 4,
    totalTokens: PER_READ.totalTokenCount * 4,
  });
});

test("a refusal carries out the reads it already paid for", async () => {
  const { generate } = answering(
    cropping([0, 0, 4, 1000]),
    cropping([0, 0, 4, 1000]),
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof ImageEditorError);
    assert.equal(error.usage.totalTokens, PER_READ.totalTokenCount * 2);
    return true;
  });
});

test("a refusal is priced against the model it actually read on", async () => {
  const { models, generate } = answering(
    cropping([0, 0, 4, 1000]),
    cropping([0, 0, 4, 1000]),
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.deepEqual(spentThrown(error), {
      model: "gemini-3.7-flash",
      promptTokens: PER_READ.promptTokenCount * 2,
      outputTokens: PER_READ.candidatesTokenCount * 2,
      totalTokens: PER_READ.totalTokenCount * 2,
    });
    assert.deepEqual(new Set(models), new Set(["gemini-3.7-flash"]));
    return true;
  });
});

test("a refusal made before any read carries no tokens either", async () => {
  const { generate } = answering(cropping([100, 100, 900, 900]));

  await assert.rejects(
    editReference({
      gcsUri: "gs://bucket/frames/one.jpg",
      prompt: " ",
      generate: generate as never,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ImageEditorError);
      assert.equal(error.usage.totalTokens, 0);
      return true;
    },
  );
});

test("a refusal that costs nothing is made before any read", async () => {
  const { asked, generate } = answering(cropping([100, 100, 900, 900]));

  await assert.rejects(
    editReference({
      gcsUri: "gs://bucket/frames/one.jpg",
      prompt: "   ",
      generate: generate as never,
    }),
    (error: unknown) => error instanceof ImageEditorError,
  );
  assert.equal(asked.length, 0);
});

const askLoosely = (generate: unknown, id: string, frame: unknown = { width: 1000, height: 1000 }) =>
  editReference({
    gcsUri: "gs://bucket/frames/one.jpg",
    prompt: "the middle sunflower",
    loose: looseShapeOf(id)!,
    frame: frame as never,
    generate: generate as never,
  });

test("a loose shape is asked for in the words the model frames by", async () => {
  const { asked, generate } = answering(cropping([100, 100, 700, 700]), STOP, closing("her"));

  await askLoosely(generate, "square");
  const said = asked[0]![0]!.parts.map((part) => part.text ?? "").join(" ");
  assert.match(said, /roughly square/);
  assert.doesNotMatch(said, /held to/);
});

test("a box that missed the loose shape is answered with what it came out as", async () => {
  const { asked, generate } = answering(
    cropping([400, 100, 600, 900]),
    cropping([100, 100, 700, 700]),
    STOP,
    closing("her"),
  );

  const answer = await askLoosely(generate, "square");
  assert.equal(answer.attempts, 2);
  assert.deepEqual(answer.box, { ymin: 100, xmin: 100, ymax: 700, xmax: 700 });
  assert.match(errorsIn(asked[1]!)[0] ?? "", /that box is 4\.00:1/);
});

test("an editor that never reaches the loose shape gives up at the round limit", async () => {
  const { asked, generate } = answering(
    cropping([400, 100, 600, 900]),
    cropping([420, 100, 600, 900]),
    cropping([440, 100, 600, 900]),
    cropping([460, 100, 600, 900]),
  );

  await assert.rejects(askLoosely(generate, "square"), (error: unknown) => {
    assert.ok(error instanceof ImageEditorError);
    assert.match(error.message, /roughly square/);
    return true;
  });
  assert.equal(asked.length, EDITOR_ROUND_LIMIT);
});

test("a frame with no recorded size is asked loosely and not held to it", async () => {
  const { asked, generate } = answering(cropping([400, 100, 600, 900]), STOP, closing("her"));

  const answer = await askLoosely(generate, "square", {});
  assert.equal(asked.length, 3);
  assert.equal(answer.attempts, 1);
});

test("every read of the frame goes to the 3.5-floor model", async () => {
  const { models, generate } = answering(
    cropping([500, 100, 508, 900]),
    cropping([200, 100, 900, 800]),
    STOP,
    closing(),
  );

  const answer = await ask(generate);
  assert.deepEqual(new Set(models), new Set(["gemini-3.7-flash"]));
  assert.equal(answer.model, "gemini-3.7-flash");
});

test("a flip alone is an edit, and the box is the whole frame", async () => {
  const { generate } = answering(
    [call("flip", { axis: "horizontal" })],
    STOP,
    closing("facing the other way", "the light is on the wrong side"),
  );

  const answer = await ask(generate, { prompt: "flip it" });
  assert.deepEqual(answer.ops, [{ op: "flip", axis: "horizontal" }]);
  assert.deepEqual(answer.box, { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 });
  assert.equal(answer.rationale, "the light is on the wrong side");
});

test("a second turn in the same round is refused and the first stands", async () => {
  const { asked, generate } = answering(
    [call("turn", { turn: "right" }), call("turn", { turn: "left" })],
    STOP,
    closing("on its feet"),
  );

  const answer = await ask(generate, { prompt: "turn it" });
  assert.deepEqual(answer.ops, [{ op: "turn", turn: "right" }]);
  assert.match(errorsIn(asked[1]!)[0] ?? "", /already turned it right/);
});

test("a grade that turns no knob is not an edit", async () => {
  const { asked, generate } = answering(
    [call("grade", { warmth: 0, contrast: 0 })],
    [call("grade", { warmth: 20 })],
    STOP,
    closing("warmer"),
  );

  const answer = await ask(generate, { prompt: "warm it up" });
  assert.deepEqual(answer.ops, [
    { op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: 20, hue: 0 },
  ]);
  assert.match(errorsIn(asked[1]!)[0] ?? "", /changes nothing/);
});

test("a crop after a pixel edit is refused, and what landed still files", async () => {
  const { asked, generate } = answering(
    [call("grade", { warmth: 20 }), call("crop", { box: [100, 100, 900, 900] })],
    STOP,
    closing("warmer"),
  );

  const answer = await ask(generate, { prompt: "warm it up and crop it" });
  assert.deepEqual(answer.ops, [
    { op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: 20, hue: 0 },
  ]);
  assert.deepEqual(answer.box, { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 });
  assert.match(errorsIn(asked[1]!)[0] ?? "", /first edit or none/);
});

test("only: crop declares the one tool and keeps the other three out of the instruction", async () => {
  const { configs, generate } = answering(cropping([100, 100, 900, 900]), STOP, closing());

  await ask(generate, { only: "crop" });
  const [first] = configs;
  const declared = (first!.tools?.[0]?.functionDeclarations ?? []) as ToolDeclaration[];
  assert.deepEqual(
    declared.map((declaration) => declaration.name),
    ["crop"],
  );
  assert.doesNotMatch(first!.systemInstruction ?? "", /warmth/);
  assert.doesNotMatch(first!.systemInstruction ?? "", /quarter/);
  assert.match(first!.systemInstruction ?? "", /\[ymin, xmin, ymax, xmax\]/);
});

test("all four are declared when nothing narrows them", async () => {
  const { configs, generate } = answering(cropping([100, 100, 900, 900]), STOP, closing());

  await ask(generate);
  const declared = (configs[0]!.tools?.[0]?.functionDeclarations ?? []) as ToolDeclaration[];
  assert.deepEqual(
    declared.map((declaration) => declaration.name),
    ["crop", "turn", "flip", "grade"],
  );
});

const previewing = (shown: EditPreview | null = { base64: "AAAA", mimeType: "image/jpeg" }) => {
  const seen: EditOp[][] = [];
  const preview = async (ops: readonly EditOp[]) => {
    seen.push([...ops]);
    return shown;
  };
  return { seen, preview };
};

test("a round that edited the picture is shown the picture it made", async () => {
  const { asked, generate } = answering(
    [call("crop", { box: [100, 100, 900, 900] }), call("grade", { warmth: 30 })],
    STOP,
    closing("warmer"),
  );
  const { seen, preview } = previewing();

  const answer = await ask(generate, { preview });
  assert.equal(answer.looks, 1);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], answer.ops);

  const shown = asked[1]!.flatMap((content) => content.parts.filter((part) => part.inlineData));
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.inlineData?.data, "AAAA");
});

test("a grade corrected on the look is the one that is filed", async () => {
  const { generate } = answering(
    [call("grade", { warmth: 60 })],
    [call("grade", { warmth: 25 })],
    STOP,
    closing("warmer", "that went orange, so it is back down"),
  );
  const { seen, preview } = previewing();

  const answer = await ask(generate, { preview });
  assert.equal(answer.attempts, 2);
  assert.equal(answer.looks, 2);
  assert.deepEqual(answer.ops, [
    { op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: 25, hue: 0 },
  ]);
  assert.deepEqual(seen[1], answer.ops);
  assert.equal(answer.rationale, "that went orange, so it is back down");
});

test("no previewer means the edit stands and nothing is looked at", async () => {
  const { asked, generate } = answering([call("grade", { warmth: 60 })], STOP, closing("warmer"));

  const answer = await ask(generate);
  assert.equal(answer.looks, 0);
  assert.equal(asked.length, 3);
  assert.deepEqual(answer.ops, [
    { op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: 60, hue: 0 },
  ]);
});

test("a preview that could not be made loses no edit — it fails open", async () => {
  const { generate } = answering([call("grade", { warmth: 60 })], STOP, closing("warmer"));
  const { preview } = previewing(null);

  const answer = await ask(generate, { preview });
  assert.equal(answer.looks, 0);
  assert.deepEqual(answer.ops, [
    { op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: 60, hue: 0 },
  ]);
});

test("the intent of a nudge keeps the box's own words when the editor gives none", async () => {
  const { generate } = answering(cropping([100, 100, 900, 900]), STOP, closing("", "tighter now"));

  const answer = await ask(generate, {
    previous: { cropBox: [0, 0, 1000, 1000], editIntent: "the middle sunflower" },
    prompt: "tighter",
  });
  assert.equal(answer.intent, "the middle sunflower — tighter");
  assert.equal(answer.rationale, "tighter now");
});
