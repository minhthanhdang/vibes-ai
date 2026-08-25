import { test } from "node:test";
import assert from "node:assert/strict";

import { CropperError, cropReference } from "./cropper";
import { spentThrown } from "@/lib/agent/shared/model-cost";
import type { Content } from "@/server/google/vertex";
import { looseShapeOf } from "@/lib/references/reference-version";

/// Agent 3's loop, with the vision call replaced by a list of answers. tech-spec
/// §III.3 asks for validate-and-re-prompt up to three attempts, and each attempt
/// is a photograph read — so what this file is really asserting is how many of
/// them get bought.

type Answer = { box?: unknown; intent?: string; rationale?: string };

/// What one read of the frame costs in this file. A photograph is nearly all of
/// it, which is why `attempts` and `usage` are two different readings of the
/// same loop — one counts the reads, the other says how big they were.
const PER_READ = { promptTokenCount: 1000, candidatesTokenCount: 10, totalTokenCount: 1010 };

function answering(...answers: Answer[]) {
  const asked: Content[][] = [];
  const models: string[] = [];
  const generate = async (model: string, contents: Content[]) => {
    models.push(model);
    /// Copied, because the loop keeps pushing onto the same array.
    asked.push(JSON.parse(JSON.stringify(contents)) as Content[]);
    const answer = answers[asked.length - 1];
    assert.ok(answer, `the cropper asked ${asked.length} times for ${answers.length} answers`);
    return {
      candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }],
      usageMetadata: PER_READ,
    };
  };
  return { asked, models, generate };
}

const ask = (generate: unknown) =>
  cropReference({
    gcsUri: "gs://bucket/frames/one.jpg",
    prompt: "the middle sunflower",
    title: "Sunflowers",
    generate: generate as never,
  });

test("a usable box on the first read costs one call", async () => {
  const { asked, generate } = answering({
    box: [100, 200, 800, 900],
    intent: "the middle sunflower",
    rationale: "it is the one in focus",
  });

  const answer = await ask(generate);
  assert.equal(asked.length, 1);
  assert.equal(answer.attempts, 1);
  assert.deepEqual(answer.box, { ymin: 100, xmin: 200, ymax: 800, xmax: 900 });
  assert.equal(answer.intent, "the middle sunflower");
});

test("a strip is re-prompted with what was wrong with it, and the second read is kept", async () => {
  const { asked, generate } = answering(
    { box: [500, 100, 508, 900], intent: "the stalk", rationale: "" },
    { box: [200, 100, 900, 800], intent: "the middle sunflower", rationale: "" },
  );

  const answer = await ask(generate);
  assert.equal(asked.length, 2);
  assert.equal(answer.attempts, 2);
  assert.deepEqual(answer.box, { ymin: 200, xmin: 100, ymax: 900, xmax: 800 });

  /// The correction is appended to the conversation, so the second read sees the
  /// image, its own last answer, and the sentence about it — a re-prompt that
  /// hid the box would be asking the model which of its readings was wrong.
  const [, second] = asked;
  assert.equal(second.length, 3);
  assert.equal(second[0].role, "user");
  assert.ok(second[0].parts.some((part) => part.fileData));
  assert.equal(second[1].role, "model");
  assert.equal(second[2].role, "user");
  const correction = second[2].parts[0];
  assert.ok(/8\/1000 of the frame's height/.test(correction.text ?? ""));
});

/// The image is in the conversation once. Every attempt re-sends it — that is
/// how the model sees what it is being corrected about — which is exactly why
/// the attempt ceiling is the cost lever it is.
test("the frame is sent once per attempt and never twice within one", async () => {
  const { asked, generate } = answering(
    { box: [0, 0, 4, 4] },
    { box: [10, 10, 14, 14] },
    { box: [100, 100, 900, 900], intent: "the middle sunflower" },
  );

  await ask(generate);
  for (const contents of asked) {
    const frames = contents.flatMap((turn) => turn.parts.filter((part) => part.fileData));
    assert.equal(frames.length, 1);
  }
});

test("three unusable reads and no more — the fourth is not bought", async () => {
  const { asked, generate } = answering(
    { box: [0, 0, 4, 1000] },
    { box: [10, 0, 18, 1000] },
    { box: "the middle one" },
    { box: [100, 100, 900, 900] },
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof CropperError);
    assert.match(error.message, /could not answer with a usable box/);
    return true;
  });
  assert.equal(asked.length, 3);
});

/// A model that repeats the box it was just told was wrong has said everything
/// it has to say about this frame. Its remaining attempt would buy the same
/// answer again, and a photograph read is what it would cost.
test("the same unusable box twice ends it early", async () => {
  const { asked, generate } = answering({ box: [500, 0, 505, 1000] }, { box: [500, 0, 505, 1000] });

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof CropperError);
    assert.match(error.message, /same unusable box twice/);
    return true;
  });
  assert.equal(asked.length, 2);
});

/// "The whole frame is the shot" is the cropper reading the photograph
/// correctly. Re-prompting it would be paying a read to argue with an
/// instruction we wrote — so the loop lets it through and the caller refuses it.
test("the whole frame is answered, not re-prompted", async () => {
  const { asked, generate } = answering({ box: [0, 0, 1000, 1000], intent: "the field" });

  const answer = await ask(generate);
  assert.equal(asked.length, 1);
  assert.deepEqual(answer.box, { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 });
});

/// `attempts` says how many photographs were sent; this says what they came to.
/// A box the model got right first time and one it reached on the third read are
/// the same crop and not the same bill, and the bill is the thing the run row
/// could not previously say.
test("the tokens of every attempt are added up, not read off the last one", async () => {
  const { generate } = answering(
    { box: [500, 0, 505, 1000] },
    { box: [100, 100, 900, 900], intent: "the middle sunflower" },
  );

  const answer = await ask(generate);
  assert.equal(answer.attempts, 2);
  assert.deepEqual(answer.usage, {
    promptTokens: PER_READ.promptTokenCount * 2,
    outputTokens: PER_READ.candidatesTokenCount * 2,
    totalTokens: PER_READ.totalTokenCount * 2,
  });
});

/// The expensive case is the one that answers with nothing, so an error that
/// dropped its own usage would leave the worst afternoons looking like the
/// cheapest ones.
test("a refusal carries out the reads it already paid for", async () => {
  const { generate } = answering(
    { box: [0, 0, 4, 1000] },
    { box: [10, 0, 18, 1000] },
    { box: "the middle one" },
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof CropperError);
    assert.equal(error.usage.totalTokens, PER_READ.totalTokenCount * 3);
    return true;
  });
});

/// The other half of the same row: what those reads cost, and what they cost it
/// *on*. The caller writes `spentThrown(cause)` and nothing else, so a refusal
/// that named no model — or named one this file does not call — would be a
/// failed run priced at the wrong rate or filed with no price at all.
test("a refusal is priced against the model it actually read on", async () => {
  const { models, generate } = answering(
    { box: [0, 0, 4, 1000] },
    { box: [10, 0, 18, 1000] },
    { box: "the middle one" },
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.deepEqual(spentThrown(error), {
      /// The literal and not `MODELS.FLASH`: a repointed alias must not be able
      /// to satisfy the floor this row is priced under (§II).
      model: "gemini-3.7-flash",
      promptTokens: PER_READ.promptTokenCount * 3,
      outputTokens: PER_READ.candidatesTokenCount * 3,
      totalTokens: PER_READ.totalTokenCount * 3,
    });
    /// And it is the model the reads were sent to, not a second name kept beside
    /// it: the two can only agree by accident if they are written twice.
    assert.deepEqual(new Set(models), new Set(["gemini-3.7-flash"]));
    return true;
  });
});

test("a refusal made before any read carries no tokens either", async () => {
  const { generate } = answering({ box: [100, 100, 900, 900] });

  await assert.rejects(
    cropReference({ gcsUri: "gs://bucket/frames/one.jpg", prompt: " ", generate: generate as never }),
    (error: unknown) => {
      assert.ok(error instanceof CropperError);
      assert.equal(error.usage.totalTokens, 0);
      return true;
    },
  );
});

test("a refusal that costs nothing is made before any read", async () => {
  const { asked, generate } = answering({ box: [100, 100, 900, 900] });

  await assert.rejects(
    cropReference({
      gcsUri: "gs://bucket/frames/one.jpg",
      prompt: "   ",
      generate: generate as never,
    }),
    (error: unknown) => error instanceof CropperError,
  );
  assert.equal(asked.length, 0);
});

/// tech-spec §III.3 step 2's third validation — "box aspect within tolerance of
/// the requested ratio" — which until loose shapes existed could never fire: an
/// exact format is reached by opening the box out after the loop, so the model's
/// own framing was never held to it.
const askLoosely = (generate: unknown, id: string, frame: unknown = { width: 1000, height: 1000 }) =>
  cropReference({
    gcsUri: "gs://bucket/frames/one.jpg",
    prompt: "the middle sunflower",
    loose: looseShapeOf(id)!,
    frame: frame as never,
    generate: generate as never,
  });

test("a loose shape is asked for in the words the model frames by", async () => {
  const { asked, generate } = answering({ box: [100, 100, 700, 700], intent: "her", rationale: "" });

  await askLoosely(generate, "square");
  const said = asked[0]![0]!.parts.map((part) => part.text ?? "").join(" ");
  assert.match(said, /roughly square/);
  /// And not as a ratio: the box the model answers with *is* the cut, so telling
  /// it a number it does not have to hit is telling it the wrong thing.
  assert.doesNotMatch(said, /held to/);
});

test("a box that missed the loose shape is re-prompted with what it came out as", async () => {
  const { asked, generate } = answering(
    { box: [400, 100, 600, 900], intent: "her", rationale: "" },
    { box: [100, 100, 700, 700], intent: "her", rationale: "" },
  );

  const answer = await askLoosely(generate, "square");
  assert.equal(answer.attempts, 2);
  assert.deepEqual(answer.box, { ymin: 100, xmin: 100, ymax: 700, xmax: 700 });

  const correction = asked[1]!.at(-1)!.parts[0]!;
  assert.match(correction.text ?? "", /that box is 4\.00:1/);
});

test("a cropper that never reaches the loose shape gives up after three reads", async () => {
  const { asked, generate } = answering(
    { box: [400, 100, 600, 900], intent: "her", rationale: "" },
    { box: [420, 100, 600, 900], intent: "her", rationale: "" },
    { box: [440, 100, 600, 900], intent: "her", rationale: "" },
  );

  await assert.rejects(askLoosely(generate, "square"), (error: unknown) => {
    assert.ok(error instanceof CropperError);
    assert.match(error.message, /roughly square/);
    return true;
  });
  assert.equal(asked.length, 3);
});

/// The shape is a shape of the frame's pixels, so a frame nobody measured cannot
/// be checked. The words still go up; what does not happen is a re-prompt loop
/// against a measurement that does not exist.
test("a frame with no recorded size is asked loosely and not held to it", async () => {
  const { asked, generate } = answering({ box: [400, 100, 600, 900], intent: "her", rationale: "" });

  const answer = await askLoosely(generate, "square", {});
  assert.equal(asked.length, 1);
  assert.equal(answer.attempts, 1);
});

/// The eligibility floor (tech-spec §I, §II) is a claim about what this agent
/// *calls*, not about what `MODELS` declares — `FLASH` was declared and unused
/// for five agents' worth of history, and the spec read as though it were not.
/// Asserted against the literal id rather than the alias, because an alias
/// repointed at a 3.1 model would satisfy every other test in this file.
test("every read of the frame goes to the 3.5-floor model", async () => {
  const { models, generate } = answering(
    { box: [500, 100, 508, 900], intent: "the stalk", rationale: "" },
    { box: [200, 100, 900, 800], intent: "the middle sunflower", rationale: "" },
  );

  const answer = await ask(generate);
  assert.deepEqual(models, ["gemini-3.7-flash", "gemini-3.7-flash"]);
  /// And the model the run row is priced against is the one that did the work.
  assert.equal(answer.model, "gemini-3.7-flash");
});
