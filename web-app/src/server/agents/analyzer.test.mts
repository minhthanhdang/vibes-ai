import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeReference } from "./analyzer";
import { TAG_VOCABULARY } from "@/lib/analysis/analysis";
import type { Content, GenerateConfig } from "@/server/google/vertex";

/// Agent 2's one call and what it does with the answer. The loop the cropper has
/// is the reason that agent was testable first; this one is a single read, and a
/// single read is where a picture quietly gets described as something it is not —
/// prose where JSON was asked for, a palette the model invented, a tag outside
/// the vocabulary agent 5 groups by. All of them arrive as a normal 200.

type Asked = { models: string[]; contents: Content[][]; configs: (GenerateConfig | undefined)[] };

const USAGE = { promptTokenCount: 1290, candidatesTokenCount: 210, totalTokenCount: 1500 };

function answering(...texts: string[]) {
  const asked: Asked = { models: [], contents: [], configs: [] };
  const generate = async (model: string, contents: Content[], config?: GenerateConfig) => {
    asked.models.push(model);
    asked.contents.push(contents);
    asked.configs.push(config);
    const text = texts[asked.models.length - 1];
    assert.ok(text !== undefined, `the analyzer asked ${asked.models.length} times`);
    return {
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: USAGE,
    };
  };
  return { asked, generate };
}

const ANSWER = {
  title: "Sunflowers at dusk",
  colorPalette: ["#FFCC00", "#ffcc00", "not a colour", "#102030"],
  lighting: ["golden-hour", "a light we do not have a word for"],
  texture: [],
  composition: ["rule-of-thirds"],
  subject: [],
  contrastDepth: [],
  rationale: "  the low sun does the work  ",
};

const read = (generate: unknown, gcsUri = "gs://bucket/references/one.jpg") =>
  analyzeReference({ gcsUri, title: "Sunflowers", generate: generate as never });

test("the picture is read on flash, as the one image part of one user turn", async () => {
  const { asked, generate } = answering(JSON.stringify(ANSWER));

  await read(generate);

  assert.equal(asked.models.length, 1);
  assert.equal(asked.models[0], "gemini-3.7-flash");
  const [turn, ...rest] = asked.contents[0]!;
  assert.deepEqual(rest, []);
  assert.equal(turn!.role, "user");
  assert.deepEqual(turn!.parts[0], {
    fileData: { fileUri: "gs://bucket/references/one.jpg", mimeType: "image/jpeg" },
  });
  assert.match(turn!.parts[1]!.text!, /Sunflowers/);
});

/// The media type is read off the extension, not guessed: a PNG announced as a
/// JPEG is a picture Vertex declines to look at.
test("the media type comes off the uri, and a uri that is not a picture never leaves the process", async () => {
  const { asked, generate } = answering(JSON.stringify(ANSWER));
  await read(generate, "gs://bucket/references/one.png");
  assert.equal(asked.contents[0]![0]!.parts[0]!.fileData!.mimeType, "image/png");

  await assert.rejects(read(generate, "gs://bucket/references/notes.txt"), /unrecognized image type/);
  assert.equal(asked.models.length, 1, "a call went out for something that is not an image");
});

/// Two runs over one photograph that disagree split agent 5's group in half, so
/// the read is asked for as data at a temperature that does not wander, against
/// the same vocabulary the tags are later filtered to.
test("the read is asked for as JSON, against the vocabulary, at a temperature two runs can agree on", async () => {
  const { asked, generate } = answering(JSON.stringify(ANSWER));
  await read(generate);

  const config = asked.configs[0]!;
  assert.equal(config.temperature, 0.2);
  assert.equal(config.responseMimeType, "application/json");
  const schema = config.responseSchema as {
    required: string[];
    properties: Record<string, { items?: { enum?: string[] } }>;
  };
  assert.deepEqual(
    schema.required.slice().sort(),
    ["title", "colorPalette", ...Object.keys(TAG_VOCABULARY), "rationale"].sort(),
  );
  assert.deepEqual(schema.properties.lighting!.items!.enum, [...TAG_VOCABULARY.lighting]);
  assert.match(String(config.systemInstruction), /property analyzer/);
});

/// The model's answer is a proposal, not a record: it is held to the vocabulary
/// and to hex before it becomes a row, because a free-text tag is a group of one.
test("what comes back is normalized before it is a property", async () => {
  const { generate } = answering(JSON.stringify(ANSWER));

  const { properties } = await read(generate);

  assert.deepEqual(properties.colorPalette, ["#ffcc00", "#102030"]);
  assert.deepEqual(properties.lighting, ["golden-hour"]);
  assert.equal(properties.rationale, "the low sun does the work");
  assert.equal(properties.title, "Sunflowers at dusk");
});

/// Structured output does not mean one part: the answer is whatever text the
/// candidate holds, joined in order.
test("an answer split across parts is read whole", async () => {
  const halves = JSON.stringify(ANSWER);
  const generate = async () => ({
    candidates: [
      {
        content: {
          parts: [
            { text: halves.slice(0, 20) },
            { text: halves.slice(20) },
          ],
        },
      },
    ],
    usageMetadata: USAGE,
  });

  const { properties } = await analyzeReference({
    gcsUri: "gs://bucket/references/one.jpg",
    generate: generate as never,
  });
  assert.equal(properties.title, "Sunflowers at dusk");
});

/// Agent 2 is the pipeline's largest bill by volume, and the number on the run
/// row is this one — read off the response rather than counted here.
test("the run row's tokens are the ones the call reported", async () => {
  const { generate } = answering(JSON.stringify(ANSWER));

  const answer = await read(generate);

  assert.equal(answer.model, "gemini-3.7-flash");
  assert.deepEqual(answer.usage, { promptTokens: 1290, outputTokens: 210, totalTokens: 1500 });
});

/// The caller writes the message onto the run row, so the two failures have to
/// read differently: nothing came back at all, or something came back that was
/// not the answer that was asked for.
test("an empty candidate and prose are told apart, and the prose is quoted", async () => {
  await assert.rejects(read(answering("").generate), /analyzer returned no content/);
  await assert.rejects(
    read(answering("I could not describe that image.").generate),
    /analyzer returned non-JSON: I could not describe that image\./,
  );
});
