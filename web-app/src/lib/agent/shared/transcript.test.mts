import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TRANSCRIPT_RESPONSE_LIMIT,
  redactedContents,
  renderRecord,
  sentSaid,
  transcriptStem,
  type TranscriptRecord,
} from "./transcript";
import type { Content } from "@/server/google/vertex";

/// What this half decides on its own: what never reaches a file, what a file is
/// called, and what a round reads like once it is in one.

const png = Buffer.from("not really a png, but a real length").toString("base64");

const record = (over: Partial<TranscriptRecord> = {}): TranscriptRecord => ({
  seq: 3,
  at: "2026-08-24T10:22:31.004Z",
  agent: "designer",
  under: ["orchestrator"],
  model: "gemini-3.7-flash",
  ms: 4_210,
  declarations: ["put_on_canvas", "read_page"],
  contents: [],
  thinking: [],
  text: "",
  calls: [],
  ...over,
});

test("an inline picture is recorded as its media type and a byte count, never its bytes", () => {
  const contents: Content[] = [
    { role: "user", parts: [{ inlineData: { mimeType: "image/png", data: png } }] },
  ];

  const [turn] = redactedContents(contents) as { parts: { inlineData: Record<string, unknown> }[] }[];
  const { inlineData } = turn.parts[0];

  assert.deepEqual(inlineData, {
    mimeType: "image/png",
    bytes: Buffer.from(png, "base64").length,
    elided: true,
  });
  assert.ok(!JSON.stringify(turn).includes(png.slice(0, 24)));
});

test("a fileData uri survives whole — it is a pointer, not payload", () => {
  const fileData = { mimeType: "image/png", fileUri: "gs://bucket/cut-1.png" };
  const [turn] = redactedContents([{ role: "user", parts: [{ fileData }] }]) as {
    parts: { fileData: unknown }[];
  }[];

  assert.deepEqual(turn.parts[0].fileData, fileData);
});

test("a thought signature is recorded by its length alone", () => {
  const [turn] = redactedContents([
    { role: "model", parts: [{ text: "hi", thoughtSignature: "x".repeat(600) }] },
  ]) as { parts: { thoughtSignature: string }[] }[];

  assert.equal(turn.parts[0].thoughtSignature, "<signature, 600 chars>");
});

test("a tool answer inside the limit is kept as it stands", () => {
  const response = { referenceId: "cut-1", nudgeOf: "" };
  const [turn] = redactedContents([
    { role: "user", parts: [{ functionResponse: { name: "crop_reference", response } }] },
  ]) as { parts: { functionResponse: { response: unknown; truncated?: boolean } }[] }[];

  assert.deepEqual(turn.parts[0].functionResponse.response, response);
  assert.equal(turn.parts[0].functionResponse.truncated, undefined);
});

test("a tool answer past the limit is truncated and says so", () => {
  const response = { blurb: "b".repeat(TRANSCRIPT_RESPONSE_LIMIT) };
  const [turn] = redactedContents([
    { role: "user", parts: [{ functionResponse: { name: "read_page", response } }] },
  ]) as { parts: { functionResponse: { response: string; truncated?: boolean } }[] }[];

  const { functionResponse } = turn.parts[0];
  assert.equal(functionResponse.truncated, true);
  assert.equal(functionResponse.response.length, TRANSCRIPT_RESPONSE_LIMIT);
  assert.ok(functionResponse.response.startsWith('{"blurb":"bbb'));
});

test("a stem is filename-safe on every platform", () => {
  const stem = transcriptStem({
    at: "2026-08-24T10:22:31.004Z",
    agent: "designer",
    turnId: "a1b2c3d4",
  });

  assert.equal(stem, "2026-08-24T10-22-31_designer_a1b2c3d4");
  assert.ok(!/[:/\\<>*?"|]/.test(stem));
});

test("a stem strips anything a label or an id smuggled in", () => {
  const stem = transcriptStem({
    at: "2026-08-24T10:22:31.004Z",
    agent: "design/er 8",
    turnId: "../etc",
  });

  assert.ok(!stem.includes("/"));
  assert.equal(stem, "2026-08-24T10-22-31_design-er-8_..-etc");
});

test("a round reads as its thinking, its calls and its reply, with the body folded away", () => {
  const markdown = renderRecord(
    record({
      thinking: ["The page has a headline but nothing anchoring the lower third."],
      text: "I've placed the wide shot along the bottom edge.",
      calls: [{ name: "put_on_canvas", args: { referenceId: "abc123", box: [120, 600, 880, 940] } }],
      systemInstruction: "You are agent 8.",
      contents: redactedContents([
        { role: "user", parts: [{ inlineData: { mimeType: "image/png", data: png } }] },
      ]),
      usage: { promptTokens: 12_000, outputTokens: 400, totalTokens: 12_400 },
    }),
  );

  assert.ok(markdown.startsWith("## round 3 · designer (under orchestrator) · gemini-3.7-flash · 4.2s"));
  assert.ok(markdown.includes("**thinking** — The page has a headline"));
  assert.ok(markdown.includes("put_on_canvas(referenceId=abc123, box=[120,600,880,940])"));
  assert.ok(markdown.includes("**said** — I've placed the wide shot"));
  assert.ok(markdown.includes("<details><summary>sent — 1 content, 1 picture · 2 tools offered"));
  assert.ok(markdown.includes("You are agent 8."));
});

test("no picture ever reaches the markdown", () => {
  const markdown = renderRecord(
    record({
      contents: redactedContents([
        { role: "user", parts: [{ inlineData: { mimeType: "image/png", data: png } }] },
      ]),
    }),
  );

  assert.ok(!markdown.includes("data:"));
  assert.ok(!markdown.includes(png.slice(0, 24)));
  assert.ok(markdown.includes('"elided": true'));
});

test("a round that failed renders the failure in place of the answer", () => {
  const markdown = renderRecord(record({ error: "VertexError: vertex 429 (retryable)" }));

  assert.ok(markdown.includes("**failed** — VertexError: vertex 429 (retryable)"));
  assert.ok(!markdown.includes("**said**"));
});

test("a round that answered with nothing says which reason it stopped for", () => {
  assert.ok(renderRecord(record({ finishReason: "MAX_TOKENS" })).includes("**said nothing** (MAX_TOKENS)"));
});

test("what a request carried is counted off the parts, not the loop", () => {
  assert.equal(sentSaid([]), "0 contents");
  assert.equal(
    sentSaid(
      redactedContents([
        { role: "user", parts: [{ text: "make it warmer" }] },
        {
          role: "model",
          parts: [{ fileData: { fileUri: "gs://b/one.png" } }, { fileData: { fileUri: "gs://b/two.png" } }],
        },
      ]),
    ),
    "2 contents, 2 pictures",
  );
});
