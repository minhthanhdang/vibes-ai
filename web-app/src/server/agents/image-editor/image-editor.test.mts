import { test } from "node:test";
import assert from "node:assert/strict";

import { ImageEditorError, editReference } from "./image-editor";
import { spentThrown } from "@/lib/agent/shared/model-cost";
import type { Content } from "@/server/google/vertex";
import { looseShapeOf } from "@/lib/references/reference-version";
import type { EditOp } from "@/lib/edit/edit-ops";
import type { EditPreview } from "@/server/references/edits";

type Answer = { ops?: unknown; intent?: string; rationale?: string };

const PER_READ = { promptTokenCount: 1000, candidatesTokenCount: 10, totalTokenCount: 1010 };

const cropping = (box: unknown, shape?: string) => [{ op: "crop", box, ...(shape && { shape }) }];

const GRADE = {
  op: "grade",
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 30,
  hue: 0,
} as const;

function answering(...answers: Answer[]) {
  const asked: Content[][] = [];
  const models: string[] = [];
  const generate = async (model: string, contents: Content[]) => {
    models.push(model);
    asked.push(JSON.parse(JSON.stringify(contents)) as Content[]);
    const answer = answers[asked.length - 1];
    assert.ok(answer, `the image editor asked ${asked.length} times for ${answers.length} answers`);
    return {
      candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }],
      usageMetadata: PER_READ,
    };
  };
  return { asked, models, generate };
}

const ask = (generate: unknown, rest: Record<string, unknown> = {}) =>
  editReference({
    gcsUri: "gs://bucket/frames/one.jpg",
    prompt: "the middle sunflower",
    title: "Sunflowers",
    generate: generate as never,
    ...rest,
  });

test("a usable box on the first read costs one call", async () => {
  const { asked, generate } = answering({
    ops: cropping([100, 200, 800, 900]),
    intent: "the middle sunflower",
    rationale: "it is the one in focus",
  });

  const answer = await ask(generate);
  assert.equal(asked.length, 1);
  assert.equal(answer.attempts, 1);
  assert.equal(answer.looks, 0);
  assert.deepEqual(answer.box, { ymin: 100, xmin: 200, ymax: 800, xmax: 900 });
  assert.deepEqual(answer.ops, [{ op: "crop", box: [100, 200, 800, 900] }]);
  assert.equal(answer.intent, "the middle sunflower");
});

test("a strip is re-prompted with what was wrong with it, and the second read is kept", async () => {
  const { asked, generate } = answering(
    { ops: cropping([500, 100, 508, 900]), intent: "the stalk", rationale: "" },
    { ops: cropping([200, 100, 900, 800]), intent: "the middle sunflower", rationale: "" },
  );

  const answer = await ask(generate);
  assert.equal(asked.length, 2);
  assert.equal(answer.attempts, 2);
  assert.deepEqual(answer.box, { ymin: 200, xmin: 100, ymax: 900, xmax: 800 });

  const [, second] = asked;
  assert.equal(second.length, 3);
  assert.equal(second[0].role, "user");
  assert.ok(second[0].parts.some((part) => part.fileData));
  assert.equal(second[1].role, "model");
  assert.equal(second[2].role, "user");
  const correction = second[2].parts[0];
  assert.ok(/8\/1000 of the frame's height/.test(correction.text ?? ""));
});

test("the frame is sent once per attempt and never twice within one", async () => {
  const { asked, generate } = answering(
    { ops: cropping([0, 0, 4, 4]) },
    { ops: cropping([10, 10, 14, 14]) },
    { ops: cropping([100, 100, 900, 900]), intent: "the middle sunflower" },
  );

  await ask(generate);
  for (const contents of asked) {
    const frames = contents.flatMap((turn) => turn.parts.filter((part) => part.fileData));
    assert.equal(frames.length, 1);
  }
});

test("three unusable reads and no more — the fourth is not bought", async () => {
  const { asked, generate } = answering(
    { ops: cropping([0, 0, 4, 1000]) },
    { ops: cropping([10, 0, 18, 1000]) },
    { ops: cropping("the middle one") },
    { ops: cropping([100, 100, 900, 900]) },
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof ImageEditorError);
    assert.match(error.message, /could not answer with a usable edit/);
    return true;
  });
  assert.equal(asked.length, 3);
});

test("the same unusable answer twice ends it early", async () => {
  const { asked, generate } = answering(
    { ops: cropping([500, 0, 505, 1000]) },
    { ops: cropping([500, 0, 505, 1000]) },
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof ImageEditorError);
    assert.match(error.message, /same unusable edit twice/);
    return true;
  });
  assert.equal(asked.length, 2);
});

test("the whole frame is answered, not re-prompted", async () => {
  const { asked, generate } = answering({ ops: cropping([0, 0, 1000, 1000]), intent: "the field" });

  const answer = await ask(generate);
  assert.equal(asked.length, 1);
  assert.deepEqual(answer.box, { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 });
});

test("the tokens of every attempt are added up, not read off the last one", async () => {
  const { generate } = answering(
    { ops: cropping([500, 0, 505, 1000]) },
    { ops: cropping([100, 100, 900, 900]), intent: "the middle sunflower" },
  );

  const answer = await ask(generate);
  assert.equal(answer.attempts, 2);
  assert.deepEqual(answer.usage, {
    promptTokens: PER_READ.promptTokenCount * 2,
    outputTokens: PER_READ.candidatesTokenCount * 2,
    totalTokens: PER_READ.totalTokenCount * 2,
  });
});

test("a refusal carries out the reads it already paid for", async () => {
  const { generate } = answering(
    { ops: cropping([0, 0, 4, 1000]) },
    { ops: cropping([10, 0, 18, 1000]) },
    { ops: cropping("the middle one") },
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof ImageEditorError);
    assert.equal(error.usage.totalTokens, PER_READ.totalTokenCount * 3);
    return true;
  });
});

test("a refusal is priced against the model it actually read on", async () => {
  const { models, generate } = answering(
    { ops: cropping([0, 0, 4, 1000]) },
    { ops: cropping([10, 0, 18, 1000]) },
    { ops: cropping("the middle one") },
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.deepEqual(spentThrown(error), {
      model: "gemini-3.7-flash",
      promptTokens: PER_READ.promptTokenCount * 3,
      outputTokens: PER_READ.candidatesTokenCount * 3,
      totalTokens: PER_READ.totalTokenCount * 3,
    });
    assert.deepEqual(new Set(models), new Set(["gemini-3.7-flash"]));
    return true;
  });
});

test("a refusal made before any read carries no tokens either", async () => {
  const { generate } = answering({ ops: cropping([100, 100, 900, 900]) });

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
  const { asked, generate } = answering({ ops: cropping([100, 100, 900, 900]) });

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
  const { asked, generate } = answering({
    ops: cropping([100, 100, 700, 700]),
    intent: "her",
    rationale: "",
  });

  await askLoosely(generate, "square");
  const said = asked[0]![0]!.parts.map((part) => part.text ?? "").join(" ");
  assert.match(said, /roughly square/);
  assert.doesNotMatch(said, /held to/);
});

test("a box that missed the loose shape is re-prompted with what it came out as", async () => {
  const { asked, generate } = answering(
    { ops: cropping([400, 100, 600, 900]), intent: "her", rationale: "" },
    { ops: cropping([100, 100, 700, 700]), intent: "her", rationale: "" },
  );

  const answer = await askLoosely(generate, "square");
  assert.equal(answer.attempts, 2);
  assert.deepEqual(answer.box, { ymin: 100, xmin: 100, ymax: 700, xmax: 700 });

  const correction = asked[1]!.at(-1)!.parts[0]!;
  assert.match(correction.text ?? "", /that box is 4\.00:1/);
});

test("an editor that never reaches the loose shape gives up after three reads", async () => {
  const { asked, generate } = answering(
    { ops: cropping([400, 100, 600, 900]), intent: "her", rationale: "" },
    { ops: cropping([420, 100, 600, 900]), intent: "her", rationale: "" },
    { ops: cropping([440, 100, 600, 900]), intent: "her", rationale: "" },
  );

  await assert.rejects(askLoosely(generate, "square"), (error: unknown) => {
    assert.ok(error instanceof ImageEditorError);
    assert.match(error.message, /roughly square/);
    return true;
  });
  assert.equal(asked.length, 3);
});

test("a frame with no recorded size is asked loosely and not held to it", async () => {
  const { asked, generate } = answering({
    ops: cropping([400, 100, 600, 900]),
    intent: "her",
    rationale: "",
  });

  const answer = await askLoosely(generate, "square", {});
  assert.equal(asked.length, 1);
  assert.equal(answer.attempts, 1);
});

test("every read of the frame goes to the 3.5-floor model", async () => {
  const { models, generate } = answering(
    { ops: cropping([500, 100, 508, 900]), intent: "the stalk", rationale: "" },
    { ops: cropping([200, 100, 900, 800]), intent: "the middle sunflower", rationale: "" },
  );

  const answer = await ask(generate);
  assert.deepEqual(models, ["gemini-3.7-flash", "gemini-3.7-flash"]);
  assert.equal(answer.model, "gemini-3.7-flash");
});

test("a turn and a flip are answered without a box, and the box is the whole frame", async () => {
  const { generate } = answering({
    ops: [{ op: "flip", axis: "horizontal" }],
    intent: "facing the other way",
    rationale: "the light is on the wrong side",
  });

  const answer = await ask(generate, { prompt: "flip it" });
  assert.deepEqual(answer.ops, [{ op: "flip", axis: "horizontal" }]);
  assert.deepEqual(answer.box, { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 });
});

test("only: crop keeps the other three out of the schema and the instruction", async () => {
  const configs: unknown[] = [];
  const generate = async (_model: string, _contents: Content[], config?: unknown) => {
    configs.push(config);
    return {
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ ops: cropping([100, 100, 900, 900]), intent: "a" }) }],
          },
        },
      ],
      usageMetadata: PER_READ,
    };
  };

  await ask(generate, { only: "crop" });
  const config = configs[0] as { systemInstruction: string; responseSchema: { properties: { ops: { items: { properties: Record<string, unknown> } } } } };
  const fields = config.responseSchema.properties.ops.items.properties;
  assert.deepEqual((fields.op as { enum: string[] }).enum, ["crop"]);
  for (const field of ["turn", "axis", "brightness", "warmth"]) {
    assert.ok(!(field in fields), `${field} is still in a crop-only schema`);
  }
  assert.doesNotMatch(config.systemInstruction, /warmth/);
  assert.doesNotMatch(config.systemInstruction, /quarter turn/);
  assert.match(config.systemInstruction, /\[ymin, xmin, ymax, xmax\]/);
});

const previewing = (shown: EditPreview | null = { base64: "AAAA", mimeType: "image/jpeg" }) => {
  const seen: EditOp[][] = [];
  const preview = async (ops: readonly EditOp[]) => {
    seen.push([...ops]);
    return shown;
  };
  return { seen, preview };
};

const graded = (warmth: number) => [{ op: "crop", box: [100, 100, 900, 900] }, { ...GRADE, warmth }];

test("an edit with no grade is never looked at again", async () => {
  const { asked, generate } = answering({ ops: cropping([100, 100, 900, 900]), intent: "a" });
  const { seen, preview } = previewing();

  const answer = await ask(generate, { preview });
  assert.equal(answer.looks, 0);
  assert.equal(asked.length, 1);
  assert.deepEqual(seen, []);
});

test("a grade kept on the first look costs two reads", async () => {
  const { asked, generate } = answering(
    { ops: graded(30), intent: "warmer", rationale: "it is grey" },
    { ops: graded(30), intent: "warmer", rationale: "that is the afternoon back" },
  );
  const { seen, preview } = previewing();

  const answer = await ask(generate, { preview });
  assert.equal(answer.looks, 1);
  assert.equal(asked.length, 2);
  assert.equal(seen.length, 1);
  assert.equal(answer.rationale, "that is the afternoon back");
  assert.deepEqual(answer.ops, [
    { op: "crop", box: [100, 100, 900, 900] },
    { ...GRADE, warmth: 30 },
  ]);
});

test("the preview is of the ops the editor planned, and reaches the model as bytes", async () => {
  const { asked, generate } = answering(
    { ops: graded(30), intent: "warmer" },
    { ops: graded(30), intent: "warmer" },
  );
  const { seen, preview } = previewing();

  await ask(generate, { preview });
  assert.deepEqual(seen[0], [
    { op: "crop", box: [100, 100, 900, 900] },
    { ...GRADE, warmth: 30 },
  ]);

  const look = asked[1]![0]!;
  assert.equal(look.parts.filter((part) => part.inlineData).length, 1);
  assert.equal(look.parts.filter((part) => part.fileData).length, 0);
  assert.equal(look.parts[0]!.inlineData?.data, "AAAA");
  assert.match(look.parts[1]!.text ?? "", /warmed it up/);
});

test("a grade adjusted once and then kept costs three reads and two looks", async () => {
  const { asked, generate } = answering(
    { ops: graded(60), intent: "warmer" },
    { ops: graded(25), intent: "warmer", rationale: "that went orange" },
    { ops: graded(25), intent: "warmer", rationale: "that is right" },
  );
  const { seen, preview } = previewing();

  const answer = await ask(generate, { preview });
  assert.equal(answer.looks, 2);
  assert.equal(asked.length, 3);
  assert.deepEqual(seen[1], answer.ops);
  assert.equal(answer.rationale, "that is right");
  assert.deepEqual(answer.ops[1], { ...GRADE, warmth: 25 });
});

test("the second look is the last, and what it answers is what is filed", async () => {
  const { asked, generate } = answering(
    { ops: graded(60), intent: "warmer" },
    { ops: graded(25), intent: "warmer" },
    { ops: graded(10), intent: "warmer" },
  );
  const { preview } = previewing();

  const answer = await ask(generate, { preview });
  assert.equal(answer.looks, 2);
  assert.equal(asked.length, 3);
  assert.deepEqual(answer.ops[1], { ...GRADE, warmth: 10 });
  assert.match(asked[2]![0]!.parts[1]!.text ?? "", /last look/);
  assert.doesNotMatch(asked[1]![0]!.parts[1]!.text ?? "", /last look/);
});

test("a look that drops the grade is the end of it — there is nothing left to judge", async () => {
  const { asked, generate } = answering(
    { ops: graded(60), intent: "warmer" },
    { ops: cropping([100, 100, 900, 900]), intent: "warmer" },
  );
  const { preview } = previewing();

  const answer = await ask(generate, { preview });
  assert.equal(asked.length, 2);
  assert.equal(answer.looks, 1);
  assert.deepEqual(answer.ops, [{ op: "crop", box: [100, 100, 900, 900] }]);
});

test("a look cannot reopen the crop — the planned box is put back at the head", async () => {
  const { generate } = answering(
    { ops: graded(60), intent: "warmer" },
    { ops: [{ op: "crop", box: [0, 0, 1000, 1000] }, { ...GRADE, warmth: 20 }], intent: "warmer" },
    { ops: [{ op: "crop", box: [0, 0, 1000, 1000] }, { ...GRADE, warmth: 20 }], intent: "warmer" },
  );
  const { preview } = previewing();

  const answer = await ask(generate, { preview });
  assert.deepEqual(answer.ops, [
    { op: "crop", box: [100, 100, 900, 900] },
    { ...GRADE, warmth: 20 },
  ]);
});

test("no previewer means the planned edit stands and nothing is looked at", async () => {
  const { asked, generate } = answering({ ops: graded(60), intent: "warmer" });

  const answer = await ask(generate);
  assert.equal(answer.looks, 0);
  assert.equal(asked.length, 1);
  assert.deepEqual(answer.ops[1], { ...GRADE, warmth: 60 });
});

test("a preview that could not be made loses no edit — it fails open", async () => {
  const { asked, generate } = answering({ ops: graded(60), intent: "warmer" });
  const { preview } = previewing(null);

  const answer = await ask(generate, { preview });
  assert.equal(answer.looks, 0);
  assert.equal(asked.length, 1);
  assert.deepEqual(answer.ops[1], { ...GRADE, warmth: 60 });
});

test("a fault on a look is swallowed rather than argued with, and the plan stands", async () => {
  const { asked, generate } = answering(
    { ops: graded(60), intent: "warmer", rationale: "it is grey" },
    { ops: "leave it as it is", intent: "warmer" },
  );
  const { preview } = previewing();

  const answer = await ask(generate, { preview });
  assert.equal(answer.looks, 1);
  assert.equal(asked.length, 2);
  assert.deepEqual(answer.ops[1], { ...GRADE, warmth: 60 });
  assert.equal(answer.rationale, "it is grey");
});

test("the looks are paid for out of the same purse as the attempts", async () => {
  const { generate } = answering(
    { ops: cropping([500, 0, 505, 1000]) },
    { ops: graded(60), intent: "warmer" },
    { ops: graded(60), intent: "warmer" },
  );
  const { preview } = previewing();

  const answer = await ask(generate, { preview });
  assert.equal(answer.attempts, 2);
  assert.equal(answer.looks, 1);
  assert.equal(answer.usage.totalTokens, PER_READ.totalTokenCount * 3);
});
