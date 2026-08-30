import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const { orchestrate } = await import("@/server/agents/orchestrator/orchestrator");
const { runDesigner } = await import("./designer/loop");
const { forStorage } = await import("@/lib/agent/shared/conversation");
import type { Content, GenerateConfig } from "@/server/google/vertex";
import type { Emitted } from "@/lib/agent/shared/conversation";

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

test("both agents ask for a summary whether or not a transcript is being written", async () => {
  for (const directory of [undefined, ".transcripts"]) {
    if (directory) process.env.AGENT_TRANSCRIPT_DIR = directory;
    else delete process.env.AGENT_TRANSCRIPT_DIR;

    const turn = saying([{ text: "Tell me about the light you are after." }]);
    await orchestrate({ message: "hello", generate: turn.generate });

    const design = saying([{ text: "I put the portrait at the top." }]);
    await runDesigner({ ask: "design the welcome sign", generate: design.generate });

    assert.deepEqual(turn.sent[0]!.config.thinkingConfig, { includeThoughts: true });
    assert.deepEqual(design.sent[0]!.config.thinkingConfig, { includeThoughts: true });
  }
  delete process.env.AGENT_TRANSCRIPT_DIR;
});

test("agent 8's closing call still does not ask, with no transcript in sight", async () => {
  delete process.env.AGENT_TRANSCRIPT_DIR;

  const design = saying([{ functionCall: { name: "put_on_canvas", args: {} } }], [{ text: "Done." }]);
  await runDesigner({ ask: "design the welcome sign", generate: design.generate });

  assert.deepEqual(design.sent[0]!.config.thinkingConfig, { includeThoughts: true });
  assert.equal(design.sent.length, 2);
  assert.equal("thinkingConfig" in design.sent[1]!.config, false);
});

test("the gate is gone from the two agents, not merely left unset", async () => {
  const { TEST, filesNaming, sourceFiles } = await import("@/server/google/source-tree");
  const app = (await sourceFiles("src", "scripts")).filter((path) => !TEST.test(path));
  assert.deepEqual(await filesNaming(/\btranscribing\(/, app), [
    "src/server/agents/shared/transcript.ts",
    "src/server/google/vertex.ts",
  ]);
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

  assert.equal(reply, "Tell me about the light you are after.");

  const stored = forStorage(parts as Emitted[]);
  assert.equal(
    stored.some((part) => part.type === "text" && part.text.includes("warm")),
    false,
  );
  assert.deepEqual(
    stored.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    ["Tell me about the light you are after."],
  );

  const carried = sent[1]!.contents.flatMap((content) =>
    content.parts.filter((part) => part.thought),
  );
  assert.deepEqual(carried, [
    { text: "The brief says warm, so I should ask about the light.", thought: true, thoughtSignature: "opaque" },
  ]);
});
