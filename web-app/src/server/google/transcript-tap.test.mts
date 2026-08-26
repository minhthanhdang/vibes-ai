import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SKIP_ENV_VALIDATION = "1";

const { transcribed } = await import("./vertex");
const { readSource } = await import("./source-tree");
const { recordModelCall, transcriptSettled, withTranscript } = await import(
  "@/server/agents/shared/transcript"
);

/// The tap: what a round of Vertex leaves behind, and where it is taken from.
///
/// `generateContent` itself cannot be reached without the SDK behind it, so it
/// is held two ways — `transcribed` is the half worth asserting and is exported
/// for that, and the wiring around it is read off the source, the way
/// `sdk-boundary.test.mts` holds the rule nothing in the type system defends.

const PIXELS = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ROUND = {
  model: "gemini-3.7-flash",
  contents: [
    {
      role: "user" as const,
      parts: [{ text: "cut the sofa out" }, { inlineData: { mimeType: "image/png", data: PIXELS } }],
    },
  ],
  config: {
    systemInstruction: "You are agent 6.",
    tools: [
      {
        functionDeclarations: [
          { name: "crop_reference", description: "", parameters: {} },
          { name: "design_page", description: "", parameters: {} },
        ],
      },
    ],
  },
};

const ANSWER = {
  candidates: [
    {
      content: {
        parts: [
          { text: "The sofa is the only object with a clean edge.", thought: true },
          { text: "Cutting it now." },
          { functionCall: { name: "crop_reference", args: { referenceId: "abc" } } },
          { functionCall: { name: "add_board" } },
        ],
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40 },
};

test("a round is recorded as its instruction, its tool names and its redacted contents", () => {
  const record = transcribed(ROUND.model, ROUND.contents, ROUND.config, 4200, { answer: ANSWER });

  assert.equal(record.model, "gemini-3.7-flash");
  assert.equal(record.ms, 4200);
  assert.equal(record.systemInstruction, "You are agent 6.");
  assert.deepEqual(record.declarations, ["crop_reference", "design_page"]);
  assert.equal(record.finishReason, "STOP");
  assert.equal(record.usage?.promptTokens, 900);

  /// Requirement 6, at the seam where the bytes actually arrive.
  assert.ok(!JSON.stringify(record.contents).includes(PIXELS.slice(0, 24)));
  assert.deepEqual((record.contents[0] as { parts: unknown[] }).parts[1], {
    inlineData: { mimeType: "image/png", bytes: 70, elided: true },
  });
});

test("the thinking and the reply are the same parts, one flag apart", () => {
  const record = transcribed(ROUND.model, ROUND.contents, ROUND.config, 1, { answer: ANSWER });

  assert.deepEqual(record.thinking, ["The sofa is the only object with a clean edge."]);
  assert.equal(record.text, "Cutting it now.");
});

test("a call that arrived with no arguments is recorded as a call with none", () => {
  const record = transcribed(ROUND.model, ROUND.contents, ROUND.config, 1, { answer: ANSWER });

  assert.deepEqual(record.calls, [
    { name: "crop_reference", args: { referenceId: "abc" } },
    { name: "add_board", args: {} },
  ]);
});

test("a call that threw is recorded in place of the answer, and still carries what was sent", () => {
  const record = transcribed(ROUND.model, ROUND.contents, ROUND.config, 700, {
    error: "VertexError: vertex 429 (retryable)",
  });

  assert.equal(record.error, "VertexError: vertex 429 (retryable)");
  assert.equal(record.text, "");
  assert.deepEqual(record.thinking, []);
  assert.deepEqual(record.calls, []);
  assert.equal(record.usage, undefined);
  assert.deepEqual(record.declarations, ["crop_reference", "design_page"]);
});

test("nothing base64 reaches the file the tap's record lands in", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tap-"));
  process.env.AGENT_TRANSCRIPT_DIR = directory;

  const files = await withTranscript("cropper", async () => {
    recordModelCall(transcribed(ROUND.model, ROUND.contents, ROUND.config, 4200, { answer: ANSWER }));
    await transcriptSettled();
    return readdir(directory);
  });
  delete process.env.AGENT_TRANSCRIPT_DIR;

  for (const file of files) {
    const written = await readFile(join(directory, file), "utf8");
    assert.ok(!written.includes(PIXELS.slice(0, 24)), `${file} carries base64`);
    assert.ok(written.includes("cut the sofa out"));
  }
  assert.equal(files.length, 2);
});

/// The two paths through `generateContent`. Read off the source because the
/// function cannot be called without Vertex answering it, and because the
/// failure this guards against — a later edit that returns early, or awaits the
/// write, or drops the throwing path — leaves every other test green.
test("the tap sits on both of the seam's paths, and neither waits for it", async () => {
  const source = await readSource("src/server/google/vertex.ts");
  const seam = source.slice(
    source.indexOf("export async function generateContent("),
    source.indexOf("/// The tap, here and not at the injected"),
  );

  assert.match(seam, /transcribe\(model, contents, config, Date\.now\(\) - started, \{ answer \}\)/);
  assert.match(seam, /transcribe\(model, contents, config, Date\.now\(\) - started, \{ error:/);
  assert.match(seam, /throw cause;/);
  assert.ok(!seam.includes("await transcribe"), "a transcript is not worth a millisecond of a turn");
});

/// And the same two paths through the streaming seam, which every round of
/// agents 6 and 8 now takes. Held separately rather than by widening the slice
/// above, because the failure is worse here: the tap living inside
/// `generateContent` alone would mean a transcript that quietly lost every round
/// of the two agents anyone actually reads transcripts for.
test("the streaming seam is tapped on both its paths too", async () => {
  const source = await readSource("src/server/google/vertex.ts");
  const seam = source.slice(source.indexOf("export async function generateContentStream("));

  assert.match(seam, /transcribe\(model, contents, config, Date\.now\(\) - started, \{ answer \}\)/);
  assert.match(seam, /transcribe\(model, contents, config, Date\.now\(\) - started, \{ error:/);
  assert.match(seam, /throw cause;/);
  assert.ok(!seam.includes("await transcribe"), "a transcript is not worth a millisecond of a turn");
  /// The record is of the assembled answer and not of one chunk: a transcript
  /// round is a model call, and a streamed call is one call.
  assert.match(seam, /const answer = assembled\(chunks\);/);
});
