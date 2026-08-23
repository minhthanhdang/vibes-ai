import { test } from "node:test";
import assert from "node:assert/strict";

import { IMAGE_MAX_ATTEMPTS, ImageGeneratorError, generateImage } from "./image-generator";
import { shapeAsked } from "@/lib/references/reference-version";
import { spentThrown } from "@/lib/agent/shared/model-cost";
import { VertexError, type Content, type GenerateConfig } from "@/server/google/vertex";

/// The generator's loop with the model call replaced by a list of answers.
/// What this file is really asserting is what one ask buys: which canvas the
/// call names, what the prompt carries, and how many attempts a refusal costs.

const PNG_BYTES = Buffer.from("not-really-a-png");

const PER_CALL = { promptTokenCount: 23, candidatesTokenCount: 1120, totalTokenCount: 1517 };

type Answer = {
  parts?: unknown[];
  finishReason?: string;
  finishMessage?: string;
};

const drawn = () => ({
  parts: [
    { text: "here it is" },
    { inlineData: { mimeType: "image/png", data: PNG_BYTES.toString("base64") } },
  ],
});

function answering(...answers: Answer[]) {
  const asked: { model: string; contents: Content[]; config: GenerateConfig }[] = [];
  const generate = async (model: string, contents: Content[], config: GenerateConfig = {}) => {
    asked.push({ model, contents: JSON.parse(JSON.stringify(contents)) as Content[], config });
    const answer = answers[asked.length - 1];
    assert.ok(answer, `the generator asked ${asked.length} times for ${answers.length} answers`);
    const { parts, ...candidate } = answer;
    return {
      candidates: [{ content: parts ? { parts } : {}, ...candidate }],
      usageMetadata: PER_CALL,
    };
  };
  return { asked, generate };
}

const ask = (generate: unknown, description: string, aspect?: string) =>
  generateImage({
    description,
    ...(aspect !== undefined && { shape: shapeAsked(aspect) }),
    generate: generate as never,
  });

const promptOf = (call: { contents: Content[] }) => {
  const part = call.contents[0]!.parts[0]!;
  return part.text ?? "";
};

const imageConfigOf = (call: { config: GenerateConfig }) => call.config.imageConfig;

test("a picture drawn on the first call costs one call and comes back as bytes", async () => {
  const { asked, generate } = answering(drawn());

  const answer = await ask(generate, "a dusk gradient over a calm sea");
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.model, "gemini-3-pro-image");
  assert.equal(answer.attempts, 1);
  assert.equal(answer.mimeType, "image/png");
  assert.deepEqual(Buffer.from(answer.bytes), PNG_BYTES);
  assert.deepEqual(answer.usage, {
    promptTokens: PER_CALL.promptTokenCount,
    outputTokens: PER_CALL.candidatesTokenCount,
    totalTokens: PER_CALL.totalTokenCount,
  });
});

test("the call asks for both modalities, and no canvas when no shape was asked", async () => {
  const { asked, generate } = answering(drawn());

  await ask(generate, "a paper texture");
  const { config } = asked[0]!;
  assert.deepEqual(config.responseModalities, ["TEXT", "IMAGE"]);
  assert.equal(config.imageConfig, undefined);
  assert.equal(promptOf(asked[0]!), "a paper texture");
});

test("a shape the API takes natively is the canvas and stays out of the prompt", async () => {
  const { asked, generate } = answering(drawn());

  await ask(generate, "a dusk gradient", "16:9");
  assert.deepEqual(imageConfigOf(asked[0]!), { aspectRatio: "16:9" });
  assert.equal(promptOf(asked[0]!), "a dusk gradient");
});

test("a ratio the API has no canvas for lands on the nearest one and rides the prompt exactly as asked", async () => {
  const { asked, generate } = answering(drawn());

  await ask(generate, "an empty desert road", "2.39:1");
  assert.deepEqual(imageConfigOf(asked[0]!), { aspectRatio: "21:9" });
  assert.match(promptOf(asked[0]!), /2\.39:1/);
});

test("a loose word gets a representative canvas of its kind, not a ratio in the prompt", async () => {
  const { asked, generate } = answering(drawn());

  await ask(generate, "a wash of colour", "square");
  assert.deepEqual(imageConfigOf(asked[0]!), { aspectRatio: "1:1" });
  assert.equal(promptOf(asked[0]!), "a wash of colour");

  const portrait = answering(drawn());
  await ask(portrait.generate, "a wash of colour", "portrait");
  assert.deepEqual(imageConfigOf(portrait.asked[0]!), { aspectRatio: "2:3" });
});

test("an answer with no image is retried once, and the tokens of both calls are added up", async () => {
  const { asked, generate } = answering(
    { finishReason: "IMAGE_RECITATION", finishMessage: "Unable to show the generated image." },
    drawn(),
  );

  const answer = await ask(generate, "a plain warm grey paper texture");
  assert.equal(asked.length, 2);
  assert.equal(answer.attempts, 2);
  assert.equal(answer.usage.totalTokens, PER_CALL.totalTokenCount * 2);
});

test("two refusals in a row end it, in the model's own sentence, carrying what both cost", async () => {
  const blocked = {
    finishReason: "IMAGE_RECITATION",
    finishMessage: "Unable to show the generated image. Try rephrasing the prompt.",
  };
  const { asked, generate } = answering(blocked, blocked);

  await assert.rejects(ask(generate, "a plain grey square"), (error: unknown) => {
    assert.ok(error instanceof ImageGeneratorError);
    assert.match(error.message, /would not draw that/);
    assert.match(error.message, /Try rephrasing the prompt/);
    assert.equal(error.usage.totalTokens, PER_CALL.totalTokenCount * 2);
    return true;
  });
  assert.equal(asked.length, IMAGE_MAX_ATTEMPTS);
});

/// The generator is the one agent that is not on the text tier, so a caller
/// naming a model of its own would price drawings at reading rates. The failed
/// row is priced off the throw alone, and the throw says which model drew.
test("a refusal is priced against the image model, not the text tier", async () => {
  const blocked = {
    finishReason: "IMAGE_RECITATION",
    finishMessage: "Unable to show the generated image. Try rephrasing the prompt.",
  };
  const { asked, generate } = answering(blocked, blocked);

  await assert.rejects(ask(generate, "a plain grey square"), (error: unknown) => {
    assert.deepEqual(spentThrown(error), {
      /// The literal and not `MODELS.IMAGE`: the row has to name the model that
      /// drew even if the alias is repointed.
      model: "gemini-3-pro-image",
      promptTokens: PER_CALL.promptTokenCount * 2,
      outputTokens: PER_CALL.candidatesTokenCount * 2,
      totalTokens: PER_CALL.totalTokenCount * 2,
    });
    assert.deepEqual(new Set(asked.map((call) => call.model)), new Set(["gemini-3-pro-image"]));
    return true;
  });
});

test("a text-only answer is a refusal in the model's words", async () => {
  const explained = { parts: [{ text: "I can't create images of that." }] };
  const { generate } = answering(explained, explained);

  await assert.rejects(ask(generate, "something the model declines"), (error: unknown) => {
    assert.ok(error instanceof ImageGeneratorError);
    assert.match(error.message, /I can't create images of that\./);
    return true;
  });
});

test("a blank description is refused before any call", async () => {
  const { asked, generate } = answering(drawn());

  await assert.rejects(ask(generate, "   "), (error: unknown) => {
    assert.ok(error instanceof ImageGeneratorError);
    assert.equal(error.usage.totalTokens, 0);
    return true;
  });
  assert.equal(asked.length, 0);
});

/// The call not landing at all. Vertex answers a busy image model with an HTML
/// page (infra.md §X), which is a diagnostic and not something the orchestrator
/// can repeat to a user — so the loop turns it into a sentence and keeps the
/// original for the run row.
test("a throttled burst comes back as a sentence about a busy service, not as the page", async () => {
  const asked: unknown[] = [];
  const generate = (async () => {
    asked.push(1);
    throw new VertexError(404, "<html><title>Error 404 (Not Found)</title></html>", true);
  }) as never;

  await assert.rejects(ask(generate, "a warm grey paper texture"), (error: unknown) => {
    assert.ok(error instanceof ImageGeneratorError);
    assert.match(error.message, /busy and did not answer/);
    assert.doesNotMatch(error.message, /html/i);
    assert.match(String(error.detail), /^vertex 404 \(retryable\)/);
    return true;
  });
  /// The transport has already backed off four times; the loop's second attempt
  /// is for a model that answered without a picture, not for one that did not
  /// answer.
  assert.equal(asked.length, 1);
});

test("a request the service refuses outright says so without offering another go", async () => {
  const { asked, generate } = answering({ parts: [{ text: "let me think about that" }] });
  const failing = (async (...args: Parameters<typeof generate>) =>
    asked.length === 0
      ? generate(...args)
      : Promise.reject(
          new VertexError(400, '{"error":{"message":"bad request"}}', false),
        )) as never;

  await assert.rejects(ask(failing, "a dusk gradient"), (error: unknown) => {
    assert.ok(error instanceof ImageGeneratorError);
    assert.match(error.message, /could not be reached/);
    assert.doesNotMatch(error.message, /try again/);
    /// The first attempt was paid for, so the tokens ride the refusal.
    assert.equal(error.usage.totalTokens, PER_CALL.totalTokenCount);
    assert.match(String(error.detail), /bad request/);
    return true;
  });
});

/// A block decided on the description alone. It arrives in place of a candidate
/// rather than beside one, which is why the loop's usual reading of an answer
/// with no picture finds nothing to quote — and why a second attempt is a second
/// bill for the same answer.
test("a description turned away on its way in is not sent a second time", async () => {
  const asked: unknown[] = [];
  const generate = (async () => {
    asked.push(1);
    return { promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, usageMetadata: PER_CALL };
  }) as never;

  await assert.rejects(ask(generate, "something the service will not read"), (error: unknown) => {
    assert.ok(error instanceof ImageGeneratorError);
    assert.match(error.message, /turned the description away/);
    assert.match(error.message, /PROHIBITED_CONTENT/);
    assert.match(error.message, /different words/);
    assert.doesNotMatch(error.message, /returned no answer/);
    assert.equal(error.usage.totalTokens, PER_CALL.totalTokenCount);
    return true;
  });
  assert.equal(asked.length, 1);
});

test("the service's own sentence about a turned-away description is preferred to its code", async () => {
  const generate = (async () => ({
    promptFeedback: {
      blockReason: "OTHER",
      blockReasonMessage: "  The prompt names a public figure.  ",
    },
    usageMetadata: PER_CALL,
  })) as never;

  await assert.rejects(ask(generate, "a portrait of someone real"), (error: unknown) => {
    assert.match((error as Error).message, /The prompt names a public figure\./);
    assert.doesNotMatch((error as Error).message, /OTHER/);
    return true;
  });
});
