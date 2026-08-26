import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { assembled, textOf, thoughtsOf, functionCallsIn, usageChunkOf } = await import("./vertex");
const { usageOf } = await import("@/lib/agent/shared/model-cost");
import type { GenerateChunk, GeneratePart } from "./vertex";

/// The two pure halves of the streaming seam. Everything else about
/// `generateContentStream` needs Vertex behind it; these are the parts that
/// decide whether a streamed call and a whole one are the same answer.

const chunk = (parts: GeneratePart[], extra: Partial<GenerateChunk> = {}): GenerateChunk => ({
  candidates: [{ content: { parts } }],
  ...extra,
});

test("the chunks of one call concatenate verbatim, and merge nothing", () => {
  /// The rule the whole design rests on. A merge would have to decide which of
  /// two fragments keeps a `thoughtSignature`, and the API's rule is to return
  /// the parts as they arrived — so the safe assembly does nothing.
  const answer = assembled([
    chunk([{ text: "Tell me ", thought: true, thoughtSignature: "opaque" }]),
    chunk([{ text: "about the " }]),
    chunk([{ text: "light." }]),
  ]);

  assert.deepEqual(answer.candidates?.[0]?.content?.parts, [
    { text: "Tell me ", thought: true, thoughtSignature: "opaque" },
    { text: "about the " },
    { text: "light." },
  ]);
});

test("a fragmented answer reads as the same string a whole one did", () => {
  const parts = assembled([chunk([{ text: "about the " }]), chunk([{ text: "light." }])]).candidates?.[0]
    ?.content?.parts;
  assert.equal(textOf(parts ?? []), "about the light.");
});

test("a thought fragment stays a thought and stays out of the reply", () => {
  const parts =
    assembled([
      chunk([{ text: "they want a mood", thought: true, thoughtSignature: "s1" }]),
      chunk([{ text: "What look are you after?" }]),
    ]).candidates?.[0]?.content?.parts ?? [];

  assert.equal(textOf(parts), "What look are you after?");
  assert.deepEqual(thoughtsOf(parts), ["they want a mood"]);
});

test("a function call arrives whole and survives assembly", () => {
  const parts =
    assembled([
      chunk([{ text: "Let me look. " }]),
      chunk([{ functionCall: { name: "list_references", args: { starred: true } } }]),
    ]).candidates?.[0]?.content?.parts ?? [];

  assert.deepEqual(functionCallsIn(parts), [{ name: "list_references", args: { starred: true } }]);
});

test("a stream that yielded nothing is an answer with no candidates", () => {
  const answer = assembled([]);
  /// Which is what a non-streamed empty emission already reads as, so the round
  /// loop's retry and `emptyReply` both still work on it.
  assert.equal(textOf(answer.candidates?.[0]?.content?.parts ?? []), "");
  assert.equal(answer.candidates, undefined);
});

test("the finish reason comes from the last chunk that carried one", () => {
  const answer = assembled([
    chunk([{ text: "a" }]),
    chunk([{ text: "b" }], { candidates: [{ content: { parts: [{ text: "b" }] }, finishReason: "STOP" }] }),
    /// A trailing chunk with nothing on it must not erase it.
    { candidates: [{ content: { parts: [] } }] },
  ]);
  assert.equal(answer.candidates?.[0]?.finishReason, "STOP");
});

test("a prompt turned away on its way in survives the assembly", () => {
  const answer = assembled([{ promptFeedback: { blockReason: "SAFETY" } }]);
  assert.deepEqual(answer.promptFeedback, { blockReason: "SAFETY" });
});

test("cumulative usage is read once, at its largest, and never summed", () => {
  /// Summing would bill a three-chunk answer three times.
  const readings = [
    { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } },
    { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 } },
    { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 40, totalTokenCount: 50 } },
  ];
  assert.deepEqual(usageChunkOf(readings), readings[2]!.usageMetadata);
  assert.equal(usageOf(assembled(readings)).outputTokens, 40);
});

test("a trailing chunk with no usage on it does not lose the reading", () => {
  const readings = [
    { usageMetadata: { totalTokenCount: 15, candidatesTokenCount: 5 } },
    { usageMetadata: { totalTokenCount: 30, candidatesTokenCount: 20 } },
    {},
  ];
  assert.deepEqual(usageChunkOf(readings), readings[1]!.usageMetadata);
});

test("a call that reported no usage at all reports none", () => {
  assert.equal(usageChunkOf([{}, {}]), undefined);
  assert.equal(usageOf(assembled([chunk([{ text: "a" }])])).outputTokens, 0);
});

test("thinking tokens ride into the output count exactly as they always did", () => {
  const answer = assembled([
    { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 80, totalTokenCount: 200 } },
  ]);
  assert.equal(usageOf(answer).outputTokens, 100);
});
