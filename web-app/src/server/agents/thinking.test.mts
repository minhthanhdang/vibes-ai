import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { orchestrate } = await import("./orchestrator");
const { runDesigner } = await import("./designer/loop");
const { forStorage } = await import("@/lib/agent/shared/conversation");
import type { Content, GenerateConfig } from "@/server/google/vertex";
import type { Emitted } from "@/lib/agent/shared/conversation";

/// Stage 5.2 and 5.4: what asking for thought summaries costs, and where the
/// summaries are allowed to go once they arrive.
///
/// The cost is the reason for the gate. A summary is output tokens on a real
/// invoice (`docs/Metering.md` §II), so the two agents anyone tunes ask for one
/// only while a transcript is being written, and requirement 1 — unset means
/// not one line of behaviour changed — is the first case below.
///
/// Where they may go is requirement 8, held here end to end rather than on the
/// projection alone: a summary is a text part like any other, so a turn that
/// forgot to mark it would put the model's private reasoning in the user's
/// reply, in a stored bubble, or both.

type Part =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { functionCall: { name: string; args: Record<string, unknown> } };

function saying(...rounds: Part[][]) {
  const sent: { contents: Content[]; config: GenerateConfig }[] = [];
  const generate = (async (_model: string, contents: Content[], config: GenerateConfig = {}) => {
    sent.push({ contents: JSON.parse(JSON.stringify(contents)) as Content[], config });
    return {
      candidates: [{ content: { parts: rounds[sent.length - 1] ?? [] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    };
  }) as never;
  return { sent, generate };
}

const thinking = (words: string): Part => ({
  text: words,
  thought: true,
  thoughtSignature: "opaque",
});

test("with no transcript being written, neither agent asks for a summary", async () => {
  delete process.env.AGENT_TRANSCRIPT_DIR;

  const turn = saying([{ text: "Tell me about the light you are after." }]);
  await orchestrate({ message: "hello", generate: turn.generate });

  const design = saying([{ text: "I put the portrait at the top." }]);
  await runDesigner({ ask: "design the welcome sign", generate: design.generate });

  /// Absent, not `includeThoughts: false`: the config the SDK is handed must be
  /// the same object it was before this stage existed.
  assert.equal("thinkingConfig" in turn.sent[0]!.config, false);
  assert.equal("thinkingConfig" in design.sent[0]!.config, false);
});

test("with one being written, both agents ask — and agent 8's closing call does not", async () => {
  process.env.AGENT_TRANSCRIPT_DIR = ".transcripts";

  const turn = saying([{ text: "Tell me about the light you are after." }]);
  await orchestrate({ message: "hello", generate: turn.generate });

  /// A round that calls a tool with no executor behind it ends the loop with no
  /// sentence, which is what buys the closing call — the one designer call that
  /// chooses nothing, and so the one that has nothing to explain.
  const design = saying([{ functionCall: { name: "put_on_canvas", args: {} } }], [{ text: "Done." }]);
  await runDesigner({ ask: "design the welcome sign", generate: design.generate });
  delete process.env.AGENT_TRANSCRIPT_DIR;

  assert.deepEqual(turn.sent[0]!.config.thinkingConfig, { includeThoughts: true });
  assert.deepEqual(design.sent[0]!.config.thinkingConfig, { includeThoughts: true });
  assert.equal(design.sent.length, 2);
  assert.equal("thinkingConfig" in design.sent[1]!.config, false);
});

test("a summary is not the reply, is not stored, and is still sent back next round", async () => {
  const { sent, generate } = saying(
    [thinking("The brief says warm, so I should ask about the light."), { functionCall: { name: "list_references", args: {} } }],
    [thinking("Three of them, and none is a window."), { text: "Tell me about the light you are after." }],
  );
  const { reply, parts } = await orchestrate({
    message: "hello",
    tools: [{ name: "list_references", description: "", parameters: {} }],
    execute: async () => ({ result: { total: 3 } }),
    generate,
  });

  /// Requirement 8, the reply: `textOf` drops the thought parts, so the user is
  /// shown the sentence and never the reasoning that led to it.
  assert.equal(reply, "Tell me about the light you are after.");

  /// Requirement 8, the row: `forStorage` drops them too, so no thought becomes
  /// a bubble in the chat column.
  const stored = forStorage(parts as Emitted[]);
  assert.equal(
    stored.some((part) => part.type === "text" && part.text.includes("warm")),
    false,
  );
  assert.deepEqual(
    stored.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    ["Tell me about the light you are after."],
  );

  /// And the other half of the same rule: the API rejects a later round of the
  /// turn for dropping the signature the summary arrived with, so round 2's
  /// contents carry the part exactly as it came. This is what `wire` is for.
  const carried = sent[1]!.contents.flatMap((content) =>
    content.parts.filter((part) => part.thought),
  );
  assert.deepEqual(carried, [
    { text: "The brief says warm, so I should ask about the light.", thought: true, thoughtSignature: "opaque" },
  ]);
});
